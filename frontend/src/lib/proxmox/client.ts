// src/lib/proxmox/client.ts
import { Agent, request } from "undici"

import { extractHostFromUrl, extractPortFromUrl, replaceHostInUrl } from "./urlUtils"
import { getNodeIps, setNodeIps, getFailoverLock, setFailoverLock, incrementFailures, resetFailures, getFailureCount, FAILURE_THRESHOLD } from "../cache/nodeIpCache"
import { invalidateConnectionCache } from "../connections/getConnection"

// Connect timeout: 5s max for TCP handshake. Undici's default (10-30s) is too
// high — when a node is down, every request blocks until the OS TCP timeout.
// Our AbortSignal does NOT abort during undici's connect phase, so this is the
// only reliable way to fail fast on unreachable nodes.
const CONNECT_TIMEOUT = 5_000

let defaultAgent: Agent | null = null
export function getDefaultAgent(): Agent {
  if (!defaultAgent) {
    defaultAgent = new Agent({ connect: { timeout: CONNECT_TIMEOUT } })
  }
  return defaultAgent
}

let insecureAgent: Agent | null = null
export function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false, timeout: CONNECT_TIMEOUT } })
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

/** Hard network failures that indicate the host is truly unreachable */
function isHardNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const codes = ["ECONNREFUSED", "EHOSTUNREACH", "ECONNRESET", "ENETUNREACH", "ENOTFOUND"]
  const msg = err.message || ""
  const errCode = (err as any).code || ""
  const cause = (err as any).cause
  const causeCode = cause?.code || cause?.message || ""
  return codes.some(c => msg.includes(c) || errCode.includes(c) || causeCode.includes(c))
}

/** Timeout errors - node may just be slow, not dead */
function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === "TimeoutError" || err.name === "ConnectTimeoutError") return true
  const codes = ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]
  const msg = err.message || ""
  const errCode = (err as any).code || ""
  const cause = (err as any).cause
  const causeCode = cause?.code || cause?.message || ""
  return codes.some(c => msg.includes(c) || errCode.includes(c) || causeCode.includes(c))
}

/** Any network-level error (hard + timeout) */
function isNetworkError(err: unknown): boolean {
  return isHardNetworkError(err) || isTimeoutError(err)
}

/**
 * In-memory cache for failover URLs with circuit breaker timestamps.
 * Stored in globalThis to survive Next.js hot-reload in dev mode.
 * We do NOT persist to database — this preserves the user-configured
 * baseUrl (which may use DNS + valid SSL certs).
 *
 * Circuit breaker states:
 *  - CLOSED: no cached failover, normal operation (try primary)
 *  - OPEN: cached failover exists, age < HALF_OPEN_INTERVAL_MS (use failover directly)
 *  - HALF_OPEN: cached failover exists, age >= HALF_OPEN_INTERVAL_MS (probe primary first)
 */
type FailoverEntry = {
  url: string
  cachedAt: number  // Date.now() when failover was cached
}

const FAILOVER_CACHE_KEY = "__proxcenter_failover_url_cache__" as const
const HALF_OPEN_INTERVAL_MS = 60_000  // 60 seconds before retrying primary

function getFailoverStore(): Map<string, FailoverEntry> {
  if (!(globalThis as any)[FAILOVER_CACHE_KEY]) {
    ;(globalThis as any)[FAILOVER_CACHE_KEY] = new Map<string, FailoverEntry>()
  }
  return (globalThis as any)[FAILOVER_CACHE_KEY]
}

function getFailoverUrl(connId: string): string | null {
  const entry = getFailoverStore().get(connId)
  return entry?.url || null
}

function isHalfOpen(connId: string): boolean {
  const entry = getFailoverStore().get(connId)
  if (!entry) return false
  return (Date.now() - entry.cachedAt) >= HALF_OPEN_INTERVAL_MS
}

function refreshFailoverTimestamp(connId: string): void {
  const entry = getFailoverStore().get(connId)
  if (entry) {
    entry.cachedAt = Date.now()
  }
}

function setFailoverUrl(connId: string, url: string): void {
  getFailoverStore().set(connId, { url, cachedAt: Date.now() })
  console.log(`[failover] Cached failover URL for connection ${connId}: ${url}`)
}

function clearFailoverUrl(connId: string): void {
  getFailoverStore().delete(connId)
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
    : getDefaultAgent()

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
  async function doRequest(baseUrl: string, timeoutMs = 8_000, ignoreCallerSignal = false): Promise<T> {
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

  // Circuit breaker: when a failover URL is cached, periodically probe the
  // primary to detect recovery.  States:
  //  - OPEN (< 60s since failover): use failover directly
  //  - HALF_OPEN (>= 60s): probe primary with short timeout first
  //  - CLOSED (no cache): normal flow below
  const cachedFailoverUrl = opts.id ? getFailoverUrl(opts.id) : null

  if (cachedFailoverUrl) {
    // HALF_OPEN: enough time has passed, probe the primary
    if (opts.id && isHalfOpen(opts.id)) {
      try {
        const result = await doRequest(opts.baseUrl, 5_000)  // shorter timeout for probe
        // Primary is back! Clear failover cache and reset failures
        clearFailoverUrl(opts.id)
        resetFailures(opts.id)
        console.log(`[failover] Primary node recovered for connection ${opts.id}, clearing failover cache`)
        return result
      } catch (probeErr) {
        // Primary still down, reset timer and use failover
        refreshFailoverTimestamp(opts.id)
        console.log(`[failover] Primary still down for connection ${opts.id}, staying on failover`)
      }
    }

    // OPEN: use cached failover
    try {
      const result = await doRequest(cachedFailoverUrl)
      return result
    } catch (cachedErr) {
      if (!isNetworkError(cachedErr)) {
        // HTTP error (4xx, 5xx) — the failover node IS reachable, this
        // specific PVE API call just failed (e.g. node offline RRD data).
        // Keep the cache intact so other requests still use the failover.
        throw cachedErr
      }
      // Network error — the failover node itself is unreachable.
      // Clear cache and go directly to failover scan for a new node.
      clearFailoverUrl(opts.id!)
      if (opts.behindProxy) throw cachedErr
      // Fall through to failover scan below
    }
  }

  // No cached failover — try primary baseUrl first
  let primaryErr: unknown
  if (!cachedFailoverUrl) {
    try {
      const result = await doRequest(opts.baseUrl)
      if (opts.id) resetFailures(opts.id)
      return result
    } catch (err) {
      primaryErr = err
      if (opts.behindProxy) throw err
      if (!opts.id) throw err

      // Network error (hard or timeout): check if failover is possible
      if (isNetworkError(err)) {
        // Quick check: are there any failover candidates?
        // If not (standalone node), fail fast instead of counting toward threshold.
        const currentHost = extractHostFromUrl(opts.baseUrl)
        const cached = getNodeIps(opts.id)
        const hasAlternatives = cached && cached.ips.some(ip => ip !== currentHost)

        if (!hasAlternatives) {
          // No cached alternatives — check DB as last resort
          let dbAlternatives = false
          try {
            const { prisma } = await import("../db/prisma")
            const altCount = await prisma.managedHost.count({
              where: { connectionId: opts.id, enabled: true, ip: { not: null, notIn: [currentHost] } },
            })
            dbAlternatives = altCount > 0
          } catch {}

          if (!dbAlternatives) {
            // Standalone node or no alternatives — fail immediately
            throw err
          }
        }

        const shouldFailover = incrementFailures(opts.id)
        if (!shouldFailover) {
          console.warn(`[failover] Connection ${opts.id} failure ${getFailureCount(opts.id)}/${FAILURE_THRESHOLD} for ${path} (${isTimeoutError(err) ? 'timeout' : 'hard error'})`)
          throw err
        }
        console.log(`[failover] Connection ${opts.id} reached failure threshold, initiating failover...`)
      } else {
        // Non-network error (HTTP 500, parse error, etc.) - don't failover
        throw err
      }
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

    if (!cached || cached.ips.length === 0) {
      console.error(`[failover] No node IPs available for connection ${connId}. Visit Inventory or re-save the connection to discover nodes.`)
      throw err
    }

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
    if (newUrl) {
      // Don't reset failures — keep counter high so parallel requests
      // that miss the cache immediately trigger failover instead of
      // waiting for the threshold again.
      return doRequest(newUrl, 8_000, true)
    }

    // All nodes failed
    throw new Error(`PVE connection ${connId}: all cluster nodes unreachable (tried ${cached.ips.length} nodes). Original error: ${(err as Error).message}`)
  }
}
