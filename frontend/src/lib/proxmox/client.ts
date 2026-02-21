// src/lib/proxmox/client.ts
import { Agent, request } from "undici"

import { extractHostFromUrl, replaceHostInUrl } from "./urlUtils"
import { getNodeIps, getFailoverLock, setFailoverLock } from "../cache/nodeIpCache"
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
  id?: string
}

/** Check whether an error is a network-level failure (connection refused, timeout, etc.) */
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const codes = ["ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "UND_ERR_CONNECT_TIMEOUT"]
  const msg = err.message || ""
  const cause = (err as any).cause
  const causeCode = cause?.code || cause?.message || ""
  return codes.some(c => msg.includes(c) || causeCode.includes(c))
}

/** Update the connection's baseUrl in the database after a successful failover */
async function updateConnectionBaseUrl(connId: string, newUrl: string): Promise<void> {
  try {
    // Dynamic import to avoid circular deps
    const { prisma } = await import("../db/prisma")
    await prisma.connection.update({
      where: { id: connId },
      data: { baseUrl: newUrl },
    })
    invalidateConnectionCache(connId)
    console.log(`[failover] Updated connection ${connId} baseUrl to ${newUrl}`)
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
  async function doRequest(baseUrl: string): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, "")}/api2/json${path}`

    const res = await request(url, {
      method,
      headers,
      body,
      dispatcher,
      signal: init.signal ?? undefined,
    })

    const text = await res.body.text()

    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`PVE ${res.statusCode} ${path}: ${text}`)
    }

    let json: any

    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`PVE invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`)
    }

    return json.data as T
  }

  // Try primary baseUrl first
  try {
    return await doRequest(opts.baseUrl)
  } catch (err) {
    // Only attempt failover for network errors when we have a connection ID
    if (!opts.id || !isNetworkError(err)) throw err

    const connId = opts.id

    // Check if another request is already performing failover
    const existingLock = getFailoverLock(connId)
    if (existingLock) {
      const newUrl = await existingLock
      if (newUrl) return doRequest(newUrl)
      throw err // other failover also failed
    }

    // Look up cached node IPs
    const cached = getNodeIps(connId)
    if (!cached || cached.ips.length === 0) throw err

    const currentHost = extractHostFromUrl(opts.baseUrl)

    // Create failover promise and set lock
    const failoverPromise = (async (): Promise<string | null> => {
      for (const ip of cached.ips) {
        if (ip === currentHost) continue
        const candidateUrl = replaceHostInUrl(opts.baseUrl, ip)
        try {
          // Test the candidate with a lightweight call
          await doRequest(candidateUrl)
          // Success — persist the new baseUrl
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
    if (newUrl) return doRequest(newUrl)

    // All nodes failed
    throw new Error(`PVE connection ${connId}: all cluster nodes unreachable (tried ${cached.ips.length} nodes). Original error: ${(err as Error).message}`)
  }
}
