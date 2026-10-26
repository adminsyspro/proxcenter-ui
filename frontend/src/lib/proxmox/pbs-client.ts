// src/lib/proxmox/pbs-client.ts
import { Agent, request } from "undici"

import { readTimeoutEnv } from "../http/timeoutEnv"

// Connect timeout: 5s max for the TCP and TLS handshake, as for PVE. Our
// AbortSignal does not abort during undici's connect phase, so this is what
// makes an unreachable PBS fail fast.
const CONNECT_TIMEOUT = 5_000

/**
 * Default per-request budget. Without one, undici waits 300s for the headers
 * of a PBS that accepted the connection but never answers, which keeps every
 * page that lists PBS data (inventory included) past the 60s proxy timeout.
 */
export const PBS_DEFAULT_TIMEOUT_MS = readTimeoutEnv("PBS_TIMEOUT_MS", 15_000, "pbs")

/**
 * Budget for reads that are slow by nature, where PBS walks the datastore:
 * snapshot lists, catalogs, disk and tape inventories. Callers opt in
 * explicitly; it stays under the 60s proxy timeout.
 */
export const PBS_SLOW_READ_TIMEOUT_MS = readTimeoutEnv("PBS_SLOW_READ_TIMEOUT_MS", 45_000, "pbs")

// `allowH2: false`: PBS calls were only ever exercised over HTTP/1.1.
let defaultAgent: Agent | null = null
let insecureAgent: Agent | null = null

/** The dispatcher of a PBS connection, shared by every request to it. */
export function getPbsAgent(insecureDev?: boolean): Agent {
  if (insecureDev) {
    insecureAgent ??= new Agent({ connect: { rejectUnauthorized: false, timeout: CONNECT_TIMEOUT }, allowH2: false })
    return insecureAgent
  }
  defaultAgent ??= new Agent({ connect: { timeout: CONNECT_TIMEOUT }, allowH2: false })
  return defaultAgent
}

export type PbsClientOptions = {
  baseUrl: string
  apiToken: string  // Format attendu: user@realm!tokenid:secret (avec :)
  insecureDev?: boolean
}

/**
 * Client pour Proxmox Backup Server
 * L'API PBS utilise PBSAPIToken avec le format user@realm!tokenid:secret
 * (différent de PVE qui utilise = au lieu de :)
 *
 * init.signal is a cancellation channel, never a budget: it is combined with
 * the request budget, so it can only shorten a request. To grant more time,
 * pass fetchOpts.slowRead or fetchOpts.timeoutMs.
 */
export async function pbsFetch<T>(
  opts: PbsClientOptions,
  path: string,
  init: RequestInit = {},
  fetchOpts: { timeoutMs?: number; slowRead?: boolean } = {}
): Promise<T> {
  if (!opts?.baseUrl) throw new Error("pbsFetch: missing baseUrl")
  if (!opts?.apiToken) throw new Error("pbsFetch: missing apiToken")

  const url = `${opts.baseUrl.replace(/\/$/, "")}/api2/json${path}`

  const method = String(init.method || "GET").toUpperCase()

  // Headers - PBS utilise PBSAPIToken (pas PVEAPIToken)
  // et le format est user@realm!tokenid:secret (avec : pas =)
  const headers: Record<string, string> = {
    Authorization: `PBSAPIToken=${opts.apiToken}`,
    ...(init.headers as any),
  }

  // Body
  let body: any = undefined

  if (init.body !== undefined && init.body !== null) {
    body =
      typeof init.body === "string" || init.body instanceof Uint8Array
        ? init.body
        : JSON.stringify(init.body)

    if (!headers["Content-Type"]) headers["Content-Type"] = "application/json"
  }

  const timeoutMs =
    fetchOpts.timeoutMs ?? (fetchOpts.slowRead ? PBS_SLOW_READ_TIMEOUT_MS : PBS_DEFAULT_TIMEOUT_MS)
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal

  let res: Awaited<ReturnType<typeof request>>
  let text: string

  try {
    res = await request(url, {
      method,
      headers,
      body,
      dispatcher: getPbsAgent(opts.insecureDev),
      signal,
    })
    text = await res.body.text()
  } catch (err) {
    // Name the budget that fired, so a slow PBS reads differently from a
    // caller that went away.
    if (timeoutSignal.aborted && !init.signal?.aborted) {
      throw new Error(`PBS timeout after ${timeoutMs}ms ${path}`, { cause: err })
    }
    throw err
  }

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`PBS ${res.statusCode} ${path}: ${text}`)
  }

  let json: any

  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`PBS invalid JSON (${res.statusCode}): ${text.slice(0, 200)}`)
  }

  return json.data as T
}
