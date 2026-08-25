// src/lib/proxmox/client.ts
import { Agent, request } from "undici"

import { extractHostFromUrl, extractPortFromUrl, replaceHostInUrl } from "./urlUtils"
import { getNodeIps, setNodeIps, getFailoverLock, setFailoverLock, incrementFailures, resetFailures, getFailureCount, FAILURE_THRESHOLD } from "../cache/nodeIpCache"
import { invalidateConnectionCache } from "../connections/getConnection"
import { safeLog } from "../log/sanitize"

// Connect timeout: 5s max for TCP handshake. Undici's default (10-30s) is too
// high — when a node is down, every request blocks until the OS TCP timeout.
// Our AbortSignal does NOT abort during undici's connect phase, so this is the
// only reliable way to fail fast on unreachable nodes.
const CONNECT_TIMEOUT = 5_000

/**
 * Reads a positive millisecond budget from the environment, falling back when
 * the variable is absent or not a usable number.
 */
function readTimeoutEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback

  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[pve] Ignoring invalid ${name}="${raw}", using ${fallback}ms instead`)
    return fallback
  }

  return parsed
}

/**
 * Default per-request budget, sized for the fast endpoints this client polls
 * most often (/cluster/resources, /nodes, /cluster/status).
 */
export const PVE_DEFAULT_TIMEOUT_MS = readTimeoutEnv("PVE_TIMEOUT_MS", 8_000)

/**
 * Budget for reads that are slow by nature, where PVE enumerates every
 * configured backend before answering. /nodes/{node}/storage walks all declared
 * storages, so a datacenter with many PBS targets legitimately needs 20s or
 * more. Callers opt in explicitly, the default stays short for polling.
 */
export const PVE_SLOW_READ_TIMEOUT_MS = readTimeoutEnv("PVE_SLOW_READ_TIMEOUT_MS", 30_000)

/** Short budget for liveness probes: primary recovery and failover candidates. */
const PVE_PROBE_TIMEOUT_MS = 5_000

// `allowH2: false` on every Agent: undici 8 enables HTTP/2 via ALPN by default,
// pveproxy and the other hypervisor APIs were only ever exercised over HTTP/1.1.
let defaultAgent: Agent | null = null
export function getDefaultAgent(): Agent {
  if (!defaultAgent) {
    defaultAgent = new Agent({ connect: { timeout: CONNECT_TIMEOUT }, allowH2: false })
  }
  return defaultAgent
}

let insecureAgent: Agent | null = null
export function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false, timeout: CONNECT_TIMEOUT }, allowH2: false })
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
  const msg = String(err.message || "")
  const errCode = String((err as any).code || "")
  const cause = (err as any).cause
  const causeCode = String(cause?.code || cause?.message || "")
  return codes.some(c => msg.includes(c) || errCode.includes(c) || causeCode.includes(c))
}

/**
 * An answer we received and rejected: a non-2xx status, or a body we could not
 * parse. The host replied, so this is never a reachability problem.
 *
 * It carries its own type because the message embeds the raw PVE body, and the
 * predicates below match error codes as substrings: a 500 whose body quotes
 * ECONNREFUSED (a broken PBS or NFS backend, exactly the setting of issue #742)
 * would otherwise be read as an unreachable host and trip the failover.
 */
export class PveApplicationError extends Error {
  readonly statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = "PveApplicationError"
    this.statusCode = statusCode
  }
}

/**
 * Connect-phase timeout: the TCP handshake never completed, so the host is as
 * unreachable as it would be on ECONNREFUSED. Undici raises this on its own
 * connect timeout, and our AbortSignal does not fire during that phase, which
 * is what makes it cleanly separable from a response timeout.
 */
function isConnectTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === "ConnectTimeoutError") return true
  const codes = ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT"]
  const msg = String(err.message || "")
  const errCode = String((err as any).code || "")
  const cause = (err as any).cause
  const causeCode = String(cause?.code || cause?.message || "")
  return codes.some(c => msg.includes(c) || errCode.includes(c) || causeCode.includes(c))
}

/**
 * Response timeout: the host accepted the connection but did not answer inside
 * the budget. The completed handshake is direct evidence that the host is
 * REACHABLE, so a slow answer must not on its own be reported as a dead node.
 */
function isResponseTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const cause = (err as any).cause
  return err.name === "TimeoutError" || cause?.name === "TimeoutError"
}

/**
 * The caller's own signal fired, so the consumer of this request went away
 * (navigation, closed HTTP connection). This says nothing about node health.
 */
function isCallerAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const cause = (err as any).cause
  return err.name === "AbortError" || cause?.name === "AbortError"
}

export type PveErrorClass =
  | "hard-network"
  | "connect-timeout"
  | "response-timeout"
  | "caller-abort"
  | "application"

/**
 * Sorts a failed request into the one class that decides whether the failover
 * circuit breaker should count it. Order matters: a caller abort and a connect
 * timeout are both checked before the broader response-timeout test.
 */
/**
 * Whether a failed attempt is evidence that the host is unreachable, and may
 * therefore count towards the failover threshold.
 *
 * A connect timeout means the handshake never completed, so the host is as
 * unreachable as it would be on ECONNREFUSED. A response timeout means the
 * opposite: the host accepted the connection, so it is alive and slow. We still
 * count the latter on the default budget, otherwise a genuinely wedged node
 * would never fail over, but never when the caller asked for a longer budget:
 * requesting 30s and spending them is a slow storage, not an outage (#742).
 *
 * `replaySafe` is false for a request that is not idempotent (POST/PUT/DELETE).
 * A slow answer there is the one case where the host provably received the
 * request and kept working on it after we stopped waiting, as PVE does for a
 * memory hotplug (#743), so failing over would apply the same write a second
 * time on another node. A write is therefore never failover evidence on a slow
 * answer, whatever the budget.
 */
export function isFailoverWorthy(
  cls: PveErrorClass,
  hasLongBudget: boolean,
  replaySafe = true,
): boolean {
  switch (cls) {
    case "hard-network":
    case "connect-timeout":
      return true
    case "response-timeout":
      return replaySafe && !hasLongBudget
    default:
      return false
  }
}

export function classifyPveError(err: unknown): PveErrorClass {
  // First: an answer we rejected ourselves. Checked before the substring based
  // predicates so a remote body can never be mistaken for a transport failure.
  if (err instanceof PveApplicationError) return "application"
  if (isCallerAbortError(err)) return "caller-abort"
  if (isConnectTimeoutError(err)) return "connect-timeout"
  if (isHardNetworkError(err)) return "hard-network"
  if (isResponseTimeoutError(err)) return "response-timeout"
  return "application"
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
  console.log(`[failover] Cached failover URL for connection ${safeLog(connId)}: ${safeLog(url)}`)
}

function clearFailoverUrl(connId: string): void {
  getFailoverStore().delete(connId)
}

/** @deprecated No longer persists — kept for reference */
async function updateConnectionBaseUrl(connId: string, newUrl: string): Promise<void> {
  try {
    setFailoverUrl(connId, newUrl)
  } catch (e) {
    console.error(`[failover] Failed to update connection ${safeLog(connId)} baseUrl:`, e)
  }
}

export async function pveFetch<T>(
  opts: ProxmoxClientOptions,
  path: string,
  init: RequestInit = {},
  fetchOpts: { timeoutMs?: number; slowRead?: boolean } = {}
): Promise<T> {
  if (!opts?.baseUrl) throw new Error("pveFetch: missing baseUrl")
  if (!opts?.apiToken) throw new Error("pveFetch: missing apiToken")

  // slowRead lets a caller opt into the long budget by intent, so the number
  // stays owned here instead of being imported at every call site.
  const primaryTimeoutMs =
    fetchOpts.timeoutMs ?? (fetchOpts.slowRead ? PVE_SLOW_READ_TIMEOUT_MS : PVE_DEFAULT_TIMEOUT_MS)

  // A caller that asked for more than the default is telling us this endpoint is
  // slow on purpose. Timing out on such a budget is a slow answer, not a dead
  // node, so it must not push the connection towards a failover.
  const hasLongBudget = primaryTimeoutMs > PVE_DEFAULT_TIMEOUT_MS

  const method = String(init.method || "GET").toUpperCase()

  // Only a read may be replayed on another node. PVE keeps applying a write we
  // stopped waiting for, so a failover would apply it twice (#743).
  const replaySafe = method === "GET" || method === "HEAD" || method === "OPTIONS"

  const isUnreachableEvidence = (err: unknown) =>
    isFailoverWorthy(classifyPveError(err), hasLongBudget, replaySafe)

  const dispatcher = opts.insecureDev
    ? getInsecureAgent()
    : getDefaultAgent()

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
  async function doRequest(baseUrl: string, timeoutMs = PVE_DEFAULT_TIMEOUT_MS, ignoreCallerSignal = false): Promise<T> {
    const url = `${baseUrl.replace(/\/$/, "")}/api2/json${path}`

    // init.signal is a CANCELLATION channel, never a budget: the signals are
    // combined, so the effective deadline is the SHORTER of the two and a
    // caller signal can only shorten this request, never lengthen it. To grant
    // more time, pass fetchOpts.timeoutMs instead.
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
      throw new PveApplicationError(`PVE ${res.statusCode} ${path}: ${text}`, res.statusCode)
    }

    let json: any

    try {
      // PVE (Perl JSON) encodes NaN/Infinity as bare words which are invalid JSON.
      // Replace them with null before parsing.
      const sanitized = text.replace(/\bNaN\b/g, 'null').replace(/\b-?Infinity\b/g, 'null')
      json = JSON.parse(sanitized)
    } catch {
      throw new PveApplicationError(`PVE invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`, res.statusCode)
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
        const result = await doRequest(opts.baseUrl, PVE_PROBE_TIMEOUT_MS)
        // Primary is back! Clear failover cache and reset failures
        clearFailoverUrl(opts.id)
        resetFailures(opts.id)
        console.log(`[failover] Primary node recovered for connection ${safeLog(opts.id)}, clearing failover cache`)
        return result
      } catch (probeErr) {
        // Primary still down, reset timer and use failover
        refreshFailoverTimestamp(opts.id)
        console.log(`[failover] Primary still down for connection ${safeLog(opts.id)}, staying on failover`)
      }
    }

    // OPEN: use cached failover
    try {
      const result = await doRequest(cachedFailoverUrl, primaryTimeoutMs)
      return result
    } catch (cachedErr) {
      if (!isUnreachableEvidence(cachedErr)) {
        // Either an HTTP error (4xx, 5xx) or a slow answer on a long budget:
        // the failover node IS reachable, only this specific call failed.
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
      const result = await doRequest(opts.baseUrl, primaryTimeoutMs)
      if (opts.id) resetFailures(opts.id)
      return result
    } catch (err) {
      primaryErr = err
      if (opts.behindProxy) throw err
      if (!opts.id) throw err

      // The host looks unreachable: check whether failover is possible
      if (isUnreachableEvidence(err)) {
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
          console.warn(`[failover] Connection ${safeLog(opts.id)} failure ${getFailureCount(opts.id)}/${FAILURE_THRESHOLD} for ${safeLog(path)} (${classifyPveError(err)})`)
          throw err
        }
        console.log(`[failover] Connection ${safeLog(opts.id)} reached failure threshold, initiating failover...`)
      } else {
        // Application error, caller cancellation, or a slow answer on a budget
        // the caller chose: none of these mean the node is down.
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
      // Same arguments as the post-scan replay below: keep the caller's budget
      // and ignore a caller signal that the dead primary may already have tripped.
      if (newUrl) return doRequest(newUrl, primaryTimeoutMs, true)
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
      console.error(`[failover] No node IPs available for connection ${safeLog(connId)}. Visit Inventory or re-save the connection to discover nodes.`)
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
          await doRequest(candidateUrl, PVE_PROBE_TIMEOUT_MS, true)
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
      return doRequest(newUrl, primaryTimeoutMs, true)
    }

    // All nodes failed
    throw new Error(`PVE connection ${connId}: all cluster nodes unreachable (tried ${cached.ips.length} nodes). Original error: ${(err as Error).message}`)
  }
}
