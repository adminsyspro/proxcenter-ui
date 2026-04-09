// src/lib/proxmox/client.ts
import { Agent, request } from "undici"

import { extractHostFromUrl, extractPortFromUrl, replaceHostInUrl } from "./urlUtils"
import { getNodeIps, setNodeIps, getFailoverLock, setFailoverLock } from "../cache/nodeIpCache"
import { invalidateConnectionCache } from "../connections/getConnection"

let insecureAgent: Agent | null = null
export function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false } })
  }
  return insecureAgent
}

export type ProxmoxClientOptions = {
  baseUrl: string
  apiToken: string
  insecureDev?: boolean
  behindProxy?: boolean
  id?: string
}

/** Check whether an error is a network-level failure (connection refused, timeout, etc.) */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  // AbortSignal.timeout() throws a DOMException with name "TimeoutError"
  if (err.name === "TimeoutError") return true
  const codes = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"]
  const msg = err.message || ""
  const cause = (err as any).cause
  const causeCode = cause?.code || cause?.message || ""
  return codes.some(c => msg.includes(c) || causeCode.includes(c))
}

/**
 * In-memory cache for failover URLs.
 * We do NOT persist failover URLs to the database — this preserves the
 * user-configured baseUrl (which may use DNS + valid SSL certs).
 * The console proxy and other features rely on the original baseUrl.
 */
const failoverUrlCache = new Map<string, string>()

function getFailoverUrl(connId: string): string | null {
  return failoverUrlCache.get(connId) || null
}

function setFailoverUrl(connId: string, url: string): void {
  failoverUrlCache.set(connId, url)
  console.log(`[failover] Cached failover URL for connection ${connId}: ${url}`)
}

function clearFailoverUrl(connId: string): void {
  failoverUrlCache.delete(connId)
}

/** @deprecated No longer persists — kept for reference */
async function updateConnectionBaseUrl(connId: string, newUrl: string): Promise<void> {
  try {
    setFailoverUrl(connId, newUrl)
  } catch (e) {
    console.error(`[failover] Failed to update connection ${connId} baseUrl:`, e)
  }
}

export async function pveFetch<T>(
  opts: ProxmoxClientOptions,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!opts?.baseUrl) throw new Error("pveFetch: missing baseUrl")
  if (!opts?.apiToken) throw new Error("pveFetch: missing apiToken")

  const dispatcher = opts.insecureDev
    ? getInsecureAgent()
    : undefined

  const method = String(init.method || "GET").toUpperCase()

  // Headers
  const headers: Record<string, string> = {
    Authorization: `PVEAPIToken=${opts.apiToken}`,
    ...(init.headers as any),
  }

  // Body
  let body: any = undefined

  if (init.body !== undefined && init.body !== null) {
    if (init.body instanceof URLSearchParams) {
      body = init.body.toString()
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded"
    } else {
      body =
        typeof init.body === "string" || init.body instanceof Uint8Array
          ? init.body
          : JSON.stringify(init.body)
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/json"
    }
  }

  /** Core request logic against a specific baseUrl */
  async function doRequest(baseUrl: string, timeoutMs = 15_000, ignoreCallerSignal = false): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, "")}/api2/json${path}`

    // Use caller signal if provided, otherwise create a timeout signal.
    // Combine both when caller provides its own signal.
    // During failover, ignoreCallerSignal=true to avoid the caller's already-aborted
    // signal from instantly killing failover candidates.
    const callerSignal = (!ignoreCallerSignal && init.signal) ? init.signal : undefined
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, timeoutSignal])
      : timeoutSignal

    const res = await request(url, {
      method,
      headers,
      body,
      dispatcher,
      signal,
    })

    const text = await res.body.text()

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`PVE ${res.statusCode} ${path}: ${text}`)
    }

    let json: any

    try {
      // PVE (Perl JSON) encodes NaN/Infinity as bare words which are invalid JSON.
      // Replace them with null before parsing.
      const sanitized = text.replace(/\bNaN\b/g, 'null').replace(/\b-?Infinity\b/g, 'null')
      json = JSON.parse(sanitized)
    } catch {
      throw new Error(`PVE invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`)
    }

    return json.data as T
  }

  // When a failover URL is cached, try it first — the original baseUrl is likely
  // still down and waiting for its TCP timeout would stall the UI for seconds.
  const cachedFailoverUrl = opts.id ? getFailoverUrl(opts.id) : null

  if (cachedFailoverUrl) {
    try {
      return await doRequest(cachedFailoverUrl)
    } catch (cachedErr) {
      // Cached failover failed — try the original (maybe it recovered)
      // Use ignoreCallerSignal=true because the caller's signal may have fired
      // while waiting for the cached URL to timeout.
      clearFailoverUrl(opts.id!)
      try {
        const result = await doRequest(opts.baseUrl, 10_000, true)
        return result
      } catch {
        // Both failed — fall through to full failover
      }
      if (opts.behindProxy) throw cachedErr
      if (!isNetworkError(cachedErr)) throw cachedErr
    }
  }

  // No cached failover — try primary baseUrl first
  let primaryErr: unknown
  if (!cachedFailoverUrl) {
    try {
      const result = await doRequest(opts.baseUrl)
      return result
    } catch (err) {
      primaryErr = err
      // Skip failover entirely when behind a reverse proxy (IPs are not reachable)
      if (opts.behindProxy) throw err
      // Only attempt failover for network errors when we have a connection ID
      if (!opts.id || !isNetworkError(err)) throw err
    }
  }

  {
    const err = primaryErr || new Error("all cached failover nodes failed")

    const connId = opts.id!

    // Check if another request is already performing failover
    const existingLock = getFailoverLock(connId)
    if (existingLock !== null) {
      const newUrl = await existingLock
      if (newUrl) return doRequest(newUrl)
      throw err // other failover also failed
    }

    // Look up cached node IPs, fall back to DB if cache is empty
    let cached = getNodeIps(connId)

    if (!cached || cached.ips.length === 0) {
      try {
        const { prisma } = await import("../db/prisma")
        const hosts = await prisma.managedHost.findMany({
          where: { connectionId: connId, enabled: true, ip: { not: null } },
          select: { ip: true },
        })
        const dbIps = hosts.map(h => h.ip!).filter(Boolean)

        if (dbIps.length > 0) {
          const port = extractPortFromUrl(opts.baseUrl)
          const protocol = new URL(opts.baseUrl).protocol.replaceAll(":", "")
          setNodeIps(connId, dbIps, port, protocol)
          cached = { ips: dbIps, port, protocol }
        }
      } catch {
        // DB unavailable — continue without failover
      }
    }

    if (!cached || cached.ips.length === 0) throw err

    const currentHost = extractHostFromUrl(opts.baseUrl)

    // Create failover promise and set lock
    // ignoreCallerSignal=true: the caller's AbortSignal may already be aborted
    // (e.g. poller's 8s timeout fired while waiting for the dead primary).
    // Failover candidates must use their own fresh timeout to succeed.
    const failoverPromise = (async (): Promise<string | null> => {
      for (const ip of cached.ips) {
        if (ip === currentHost) continue
        const candidateUrl = replaceHostInUrl(opts.baseUrl, ip)
        try {
          await doRequest(candidateUrl, 5_000, true)
          await updateConnectionBaseUrl(connId, candidateUrl)
          return candidateUrl
        } catch {
          // This node is also down, try next
        }
      }
      return null
    })()

    setFailoverLock(connId, failoverPromise)

    const newUrl = await failoverPromise
    if (newUrl) return doRequest(newUrl, 15_000, true)

    // All nodes failed
    throw new Error(`PVE connection ${connId}: all cluster nodes unreachable (tried ${cached.ips.length} nodes). Original error: ${(err as Error).message}`)
  }
}
