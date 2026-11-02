import { isIP } from "node:net"

import { prisma } from "@/lib/db/prisma"

import type { ExporterFailure } from "./exporterFailure"

export type { ExporterFailure } from "./exporterFailure"

/*
   Per-OSD I/O counters read from the ceph-exporter that listens on each Ceph
   node (Prometheus text on :9926 by default). The target address ALWAYS comes
   from PVE (`/cluster/status`, type node, field ip), never from the request,
   so the route cannot be aimed at an arbitrary host. The addresses are cached
   in memory for 5 minutes: a reading costs no PVE call.
*/

export const DEFAULT_EXPORTER_PORT = 9926
export const EXPORTER_TIMEOUT_MS = 3000
export const EXPORTER_MAX_BYTES = 5 * 1024 * 1024
export const NODE_IP_TTL_MS = 5 * 60 * 1000

const NODE_IP_CACHE_MAX = 200

export type OsdCounters = {
  op_r: number
  op_w: number
  op_r_out_bytes: number
  op_w_in_bytes: number
}

const METRICS = {
  ceph_osd_op_r: "op_r",
  ceph_osd_op_w: "op_w",
  ceph_osd_op_r_out_bytes: "op_r_out_bytes",
  ceph_osd_op_w_in_bytes: "op_w_in_bytes",
} as const satisfies Record<string, keyof OsdCounters>

/**
 * The cumulative counters of every OSD in a Prometheus text exposition, keyed
 * by OSD id. An OSD missing one of the four counters is left out.
 */
export function parseAllOsdCounters(text: string): Map<number, OsdCounters> {
  const partial = new Map<number, Partial<OsdCounters>>()
  for (const line of text.split("\n")) {
    if (!line.startsWith("ceph_osd_op_")) continue
    const brace = line.indexOf("{")
    const close = line.indexOf("}", brace)
    if (brace < 0 || close < 0) continue
    const key = METRICS[line.slice(0, brace) as keyof typeof METRICS]
    if (!key) continue
    const m = /(?:^|,)ceph_daemon="osd\.(\d{1,9})"/.exec(line.slice(brace + 1, close))
    if (!m) continue
    const value = Number(line.slice(close + 1).trim().split(/\s+/)[0])
    if (!Number.isFinite(value)) continue
    const id = Number(m[1])
    const entry = partial.get(id) ?? {}
    entry[key] = value
    partial.set(id, entry)
  }
  const out = new Map<number, OsdCounters>()
  for (const [id, c] of partial) {
    if (c.op_r !== undefined && c.op_w !== undefined && c.op_r_out_bytes !== undefined && c.op_w_in_bytes !== undefined) {
      out.set(id, { op_r: c.op_r, op_w: c.op_w, op_r_out_bytes: c.op_r_out_bytes, op_w_in_bytes: c.op_w_in_bytes })
    }
  }
  return out
}

/** The counters of one OSD, or null when the exporter does not report all four for it. */
export function parseOsdCounters(text: string, osd: number): OsdCounters | null {
  return parseAllOsdCounters(text).get(osd) ?? null
}

/** The dotted IPv4 behind an IPv4-mapped IPv6 literal (::ffff:a.b.c.d or ::ffff:xxxx:xxxx), else null. */
function unmapIPv4(low: string): string | null {
  const dotted = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(low)
  if (dotted) return dotted[1]
  const hex = /^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(low)
  if (!hex) return null
  const hi = Number.parseInt(hex[1], 16)
  const lo = Number.parseInt(hex[2], 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

function isScrapableIPv4(value: string): boolean {
  const [a, b] = value.split(".").map(Number)
  return !(a === 0 || a === 127 || (a === 169 && b === 254) || a >= 224)
}

/** A usable unicast address: IPv4 or IPv6 literal, not unspecified, loopback, link-local or multicast (an IPv4-mapped IPv6 is judged as its IPv4). */
export function isScrapableIp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const v = isIP(value)
  if (v === 0) return false
  if (v === 4) return isScrapableIPv4(value)
  const low = value.toLowerCase()
  const mapped = unmapIPv4(low)
  if (mapped) return isIP(mapped) === 4 && isScrapableIPv4(mapped)
  return !(low === "::" || low === "::1" || low.startsWith("fe80:") || low.startsWith("ff"))
}

/** Node name to address, from the entries of PVE `/cluster/status`. */
export function nodeIpsFromClusterStatus(status: unknown): Map<string, string> {
  const ips = new Map<string, string>()
  if (!Array.isArray(status)) return ips
  for (const e of status) {
    if (e?.type === "node" && typeof e.name === "string" && isScrapableIp(e.ip)) ips.set(e.name, e.ip)
  }
  return ips
}

const nodeIpCache = new Map<string, { at: number; ips: Map<string, string> }>()
const nodeIpInflight = new Map<string, Promise<Map<string, string>>>()

/**
 * Cached node addresses of a connection; `load` runs only when the entry is
 * missing or older than 5 minutes, and concurrent callers on a cold cache
 * share ONE load.
 */
export async function getNodeIps(
  connectionId: string,
  load: () => Promise<unknown>,
  now: number = Date.now(),
): Promise<Map<string, string>> {
  const hit = nodeIpCache.get(connectionId)
  if (hit && now - hit.at < NODE_IP_TTL_MS) return hit.ips
  const pending = nodeIpInflight.get(connectionId)
  if (pending !== undefined) return pending
  // A purge (clearNodeIpCache) during the read drops this promise from the map: the read then
  // neither fills the cache with addresses of the old configuration nor removes a newer read.
  // load() runs now (the executor is synchronous); a synchronous throw becomes a rejection awaited below,
  // after the promise is registered.
  const loading = new Promise<unknown>(resolve => resolve(load()))
  // Token of this read: compared with the registered entry once the read settles.
  const self: { promise?: Promise<Map<string, string>> } = {}
  const promise: Promise<Map<string, string>> = (async () => {
    try {
      const ips = nodeIpsFromClusterStatus(await loading)
      if (nodeIpInflight.get(connectionId) === self.promise) {
        if (nodeIpCache.size >= NODE_IP_CACHE_MAX) nodeIpCache.delete(nodeIpCache.keys().next().value as string)
        nodeIpCache.set(connectionId, { at: now, ips })
      }
      return ips
    } finally {
      if (nodeIpInflight.get(connectionId) === self.promise) nodeIpInflight.delete(connectionId)
    }
  })()
  self.promise = promise
  nodeIpInflight.set(connectionId, promise)
  return promise
}

/** Forget the cached addresses of one connection (edited or deleted), or all of them. */
export function clearNodeIpCache(connectionId?: string): void {
  if (connectionId === undefined) {
    nodeIpCache.clear()
    nodeIpInflight.clear()
  } else {
    nodeIpCache.delete(connectionId)
    nodeIpInflight.delete(connectionId)
  }
}

/** Exporter port of a connection. Falls back to 9926 while the column is not migrated yet or holds a bad value. */
export async function getExporterPort(connectionId: string): Promise<number> {
  try {
    const rows = await prisma.$queryRaw<{ port: number | null }[]>`SELECT "cephExporterPort" AS port FROM "Connection" WHERE "id" = ${connectionId}`
    const port = Number(rows?.[0]?.port)
    return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_EXPORTER_PORT
  } catch {
    return DEFAULT_EXPORTER_PORT
  }
}

/** A failed reading with its reason. The message is a fixed text: no raw network error (address, port) goes through it. */
export class ExporterError extends Error {
  readonly failure: ExporterFailure

  constructor(failure: ExporterFailure, message = `exporter ${failure}`) {
    super(message)
    this.name = "ExporterError"
    this.failure = failure
  }
}

const REFUSED_CODES = new Set(["ECONNREFUSED", "ECONNRESET"])
const TIMEOUT_CODES = new Set(["ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"])

/** The codes of an undici error: `cause.code`, and those of the attempts of an AggregateError cause (dual stack). */
function causeCodes(e: unknown): string[] {
  const cause = (e as { cause?: { code?: unknown; errors?: unknown } } | null)?.cause
  if (!cause || typeof cause !== "object") return []
  const codes = [cause.code]
  if (Array.isArray(cause.errors)) for (const inner of cause.errors) codes.push((inner as { code?: unknown } | null)?.code)
  return codes.filter((c): c is string => typeof c === "string")
}

/**
 * Why a fetch of the exporter failed, from the shape of the error (undici: `TypeError('fetch failed')` with a
 * `cause.code`; `AbortSignal.timeout`: a `TimeoutError`). Pure: nothing of the error text is kept.
 */
export function classifyExporterError(e: unknown): ExporterFailure {
  if (e instanceof ExporterError) return e.failure
  const name = (e as { name?: unknown } | null)?.name
  if (name === "TimeoutError" || name === "AbortError") return "timeout"
  const codes = causeCodes(e)
  // Mixed attempts (dual stack: one address refused, another timed out): refused wins, at least one address answered.
  if (codes.some(c => REFUSED_CODES.has(c))) return "refused"
  if (codes.some(c => TIMEOUT_CODES.has(c))) return "timeout"
  return "invalid"
}

/** GET http://ip:port/metrics, 3 s, no redirect, body capped at 5 MB. Throws an ExporterError on any failure. */
export async function fetchExporterMetrics(ip: string, port: number): Promise<string> {
  const host = isIP(ip) === 6 ? `[${ip}]` : ip
  let res: Response
  try {
    res = await fetch(`http://${host}:${port}/metrics`, {
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(EXPORTER_TIMEOUT_MS),
    })
  } catch (e) {
    throw new ExporterError(classifyExporterError(e))
  }
  if (res.status !== 200 || !res.body) throw new ExporterError("invalid", "exporter answered " + res.status)
  const declared = Number(res.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > EXPORTER_MAX_BYTES) {
    await res.body.cancel().catch(() => {})
    throw new ExporterError("invalid", "exporter body too large")
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > EXPORTER_MAX_BYTES) {
        await reader.cancel().catch(() => {})
        throw new ExporterError("invalid", "exporter body too large")
      }
      chunks.push(value)
    }
  } catch (e) {
    // The node did answer: a reset while the body is read is not "nothing listens", only a timeout keeps its meaning.
    throw e instanceof ExporterError ? e : new ExporterError(classifyExporterError(e) === "timeout" ? "timeout" : "invalid")
  }
  return Buffer.concat(chunks).toString("utf8")
}
