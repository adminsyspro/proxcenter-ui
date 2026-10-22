/**
 * Ceph service management of a node (ui#1164 follow-up): the names PVE
 * accepts for `POST /nodes/{node}/ceph/{start|stop|restart}`, the bodies of
 * `POST .../ceph/osd`, `.../ceph/mon/{id}` and `.../ceph/mgr/{id}`, and the
 * disks `GET .../disks/list` offers as OSD or DB/WAL candidates. Pure
 * helpers: nothing here touches the network.
 */

export const CEPH_SERVICE_ACTIONS = ["start", "stop", "restart"] as const
export type CephServiceAction = (typeof CEPH_SERVICE_ACTIONS)[number]

export const CEPH_SERVICE_TYPES = ["mon", "mds", "osd", "mgr"] as const
export type CephServiceType = (typeof CEPH_SERVICE_TYPES)[number]

/**
 * PVE accepts `(ceph|mon|mds|osd|mgr)(\.<id>)?` (measured on PVE 9.2), where a
 * bare `osd` or `ceph` means every daemon of that kind on the node. Only one
 * daemon at a time is accepted here: a whole-node stop would skip the
 * per-OSD ok-to-stop precheck, and the tab never asks for it.
 */
const SERVICE_RE = /^(mon|mds|osd|mgr)\.([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)$/
/** The id part alone, for the mon and mgr PVE creates under the node's name. */
const DAEMON_ID_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/
const SERVICE_MAX_LENGTH = 200

export interface CephServiceName {
  type: CephServiceType
  /** `2` of `osd.2`, `pve1` of `mon.pve1`. */
  id: string
}

export function isCephServiceAction(value: unknown): value is CephServiceAction {
  return typeof value === "string" && (CEPH_SERVICE_ACTIONS as readonly string[]).includes(value)
}

/** The parsed service name, or null when PVE would refuse it. */
export function parseCephService(value: unknown): CephServiceName | null {
  if (typeof value !== "string" || value.length > SERVICE_MAX_LENGTH) return null
  const m = SERVICE_RE.exec(value)
  if (!m) return null
  return { type: m[1] as CephServiceType, id: m[2] }
}

/** The numeric id of an `osd.N` service, null for anything else. */
export function osdIdOf(service: CephServiceName | null): number | null {
  if (!service || service.type !== "osd" || !/^\d+$/.test(service.id)) return null
  return Number(service.id)
}

/** Whether a node name can be the id of the mon or mgr PVE creates on it. */
export function isDaemonId(value: unknown): value is string {
  return typeof value === "string" && DAEMON_ID_RE.test(value)
}

export type ParsedBody<T> = { ok: true; params: T } | { ok: false; error: string }

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === ""
}

export interface CreateMonParams {
  "mon-address"?: string
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const IPV6_RE = /^[0-9a-fA-F:]{2,39}$/

function isIpAddress(value: string): boolean {
  return IPV4_RE.test(value) || (value.includes(":") && IPV6_RE.test(value))
}

/** The body of `POST /nodes/{node}/ceph/mon/{id}`: an optional list of IPs. */
export function parseCreateMonBody(body: unknown): ParsedBody<CreateMonParams> {
  const b = (body ?? {}) as Record<string, unknown>
  const raw = b["mon-address"] ?? b.monAddress
  if (isBlank(raw)) return { ok: true, params: {} }
  if (typeof raw !== "string") return { ok: false, error: "Invalid monitor address" }
  const addresses = raw.split(",").map(a => a.trim()).filter(Boolean)
  if (addresses.length === 0) return { ok: true, params: {} }
  if (!addresses.every(isIpAddress)) return { ok: false, error: "Monitor address must be one or more IP addresses, comma separated" }
  return { ok: true, params: { "mon-address": addresses.join(",") } }
}
