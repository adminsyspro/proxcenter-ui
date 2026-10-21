/**
 * Per-host Ceph `noout` for a node entering maintenance (ui#1164).
 *
 * Pure helpers shared by the noout route and the flags route: reading the
 * OSD tree of PVE for one node, the per-host flags Ceph reports in its health
 * detail, the verdict of `ceph osd ok-to-stop`, and the choice of the node a
 * command runs on. Nothing here touches the network.
 */

import { assertNodeName } from "@/lib/ssh/validate"

export interface NodeOsd {
  id: number
  /** `up` or `down`, as the OSD tree reports it. */
  status: string
  in: boolean
}

export interface NodeOsdTree {
  /** Name of the CRUSH host bucket holding the node's OSDs, null when none matches. */
  crushHost: string | null
  osds: NodeOsd[]
  /** Cluster-wide OSD flags (`flags` of the OSD tree), lower-case. */
  globalFlags: string[]
}

export interface OsdFlagsDetail {
  /** CRUSH host -> flags set on it, e.g. { pve3: ['noout'] }. */
  hosts: Record<string, string[]>
  /** `osd.<id>` -> flags set on that OSD alone. */
  osds: Record<string, string[]>
  /** Device class -> flags set on it. */
  deviceClasses: Record<string, string[]>
}

export interface OkToStopVerdict {
  ok: boolean
  osds: number[]
  numOkPgs: number
  numNotOkPgs: number
}

export interface CephHealthSummary {
  status: string
  checks: { code: string; severity: string; message: string }[]
}

/** The flags `ceph osd set-group` accepts. */
export const CEPH_GROUP_FLAGS = ["noup", "nodown", "noin", "noout"] as const
export type CephGroupFlag = (typeof CEPH_GROUP_FLAGS)[number]

export function isCephGroupFlag(value: unknown): value is CephGroupFlag {
  return typeof value === "string" && (CEPH_GROUP_FLAGS as readonly string[]).includes(value)
}

/**
 * Whether a CRUSH host bucket is the one of a PVE node. The bucket is normally
 * named after the node; a cluster that named its hosts with their FQDN still
 * matches on the first label.
 */
export function crushHostMatchesNode(bucketName: unknown, node: string): boolean {
  if (typeof bucketName !== "string" || !bucketName) return false
  const name = bucketName.toLowerCase()
  const wanted = node.toLowerCase()
  return name === wanted || name.split(".")[0] === wanted || wanted.split(".")[0] === name
}

function osdsOf(bucket: any): NodeOsd[] {
  const out: NodeOsd[] = []
  const walk = (items: any[]) => {
    for (const item of items || []) {
      if (item?.type === "osd" || /^osd\.\d+$/.test(String(item?.name || ""))) {
        const id = Number(item?.id ?? String(item?.name || "").replace(/^osd\./, ""))
        if (Number.isInteger(id) && id >= 0) {
          out.push({
            id,
            status: String(item?.status || "").toLowerCase() || "unknown",
            in: item?.in === 1 || item?.in === true || item?.in === "1",
          })
        }
      }
      if (Array.isArray(item?.children)) walk(item.children)
    }
  }
  walk(bucket?.children || [])
  // One OSD can sit under two buckets in exotic CRUSH maps: keep it once.
  const seen = new Set<number>()
  return out.filter(o => (seen.has(o.id) ? false : (seen.add(o.id), true))).sort((a, b) => a.id - b.id)
}

/**
 * The CRUSH host bucket of a node and the OSDs under it, read from the
 * nested tree `GET /nodes/{node}/ceph/osd` returns ({ flags, root: {children} }).
 */
export function findNodeOsds(tree: unknown, node: string): NodeOsdTree {
  const t = tree as any
  const globalFlags = String(t?.flags || "")
    .split(",")
    .map((f: string) => f.trim().toLowerCase())
    .filter(Boolean)
  let crushHost: string | null = null
  let osds: NodeOsd[] = []

  const walk = (items: any[]) => {
    for (const item of items || []) {
      if (crushHost) return
      if (item?.type === "host" && crushHostMatchesNode(item?.name, node)) {
        crushHost = String(item.name)
        osds = osdsOf(item)
        return
      }
      if (Array.isArray(item?.children)) walk(item.children)
    }
  }
  const roots = Array.isArray(t?.root) ? t.root : Array.isArray(t?.root?.children) ? t.root.children : []
  walk(roots)

  return { crushHost, osds, globalFlags }
}

/**
 * The per-host, per-OSD and per-device-class flags out of the OSD_FLAGS
 * health check. Ceph words each line `<crush type> <name> has flags <f1>,<f2>`,
 * `osd.<id> has flags ...` or `device class '<name>' has flags ...`.
 */
export function parseOsdFlagsDetail(health: unknown): OsdFlagsDetail {
  const out: OsdFlagsDetail = { hosts: {}, osds: {}, deviceClasses: {} }
  const detail = (health as any)?.checks?.OSD_FLAGS?.detail
  if (!Array.isArray(detail)) return out
  const splitFlags = (raw: string) =>
    raw.split(",").map(f => f.trim().toLowerCase()).filter(Boolean)

  for (const entry of detail) {
    const message = String(entry?.message ?? entry ?? "").trim()
    let m = /^osd\.(\d+) has flags (.+)$/i.exec(message)
    if (m) {
      out.osds[`osd.${m[1]}`] = splitFlags(m[2])
      continue
    }
    m = /^device class '([^']+)' has flags (.+)$/i.exec(message)
    if (m) {
      out.deviceClasses[m[1]] = splitFlags(m[2])
      continue
    }
    m = /^host (\S+) has flags (.+)$/i.exec(message)
    if (m) out.hosts[m[1]] = splitFlags(m[2])
  }
  return out
}

/** The flags set on the CRUSH host of a node, or none. */
export function hostFlagsOf(detail: OsdFlagsDetail, crushHost: string | null): string[] {
  if (!crushHost) return []
  const exact = detail.hosts[crushHost]
  if (exact) return exact
  const key = Object.keys(detail.hosts).find(h => crushHostMatchesNode(h, crushHost))
  return key ? detail.hosts[key] : []
}

/**
 * The verdict of `ceph osd ok-to-stop <ids> -f json`. The command prints its
 * JSON on stdout whatever the exit code (16 when unsafe), so the caller runs
 * it with `; true` and hands the stdout here. Null when no JSON came back.
 */
export function parseOkToStop(output: string | undefined | null): OkToStopVerdict | null {
  if (!output) return null
  const start = output.indexOf("{")
  const end = output.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  let parsed: any
  try {
    parsed = JSON.parse(output.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed?.ok_to_stop !== "boolean") return null
  return {
    ok: parsed.ok_to_stop,
    osds: Array.isArray(parsed.osds) ? parsed.osds.map(Number).filter(Number.isInteger) : [],
    numOkPgs: Number(parsed.num_ok_pgs) || 0,
    numNotOkPgs: Number(parsed.num_not_ok_pgs) || 0,
  }
}

/**
 * The node a cluster-wide Ceph command runs on: the target node while it is
 * online, else the first online node of `/cluster/status`, so a flag can
 * still be removed while the node it protected has not come back yet.
 */
export function pickOnlineNode(clusterStatus: unknown, node: string): string | null {
  const rows = Array.isArray(clusterStatus) ? clusterStatus : []
  const online = rows
    .filter((r: any) => r?.type === "node" && (r.online === 1 || r.online === true) && typeof r.name === "string")
    .map((r: any) => r.name as string)
  if (online.length === 0) return null
  return online.find(n => n === node) ?? online[0]
}

/** Status and check messages of a Ceph health block, for display. */
export function summarizeCephHealth(health: unknown): CephHealthSummary {
  const h = health as any
  const checks = Object.entries((h?.checks || {}) as Record<string, any>).map(([code, check]) => ({
    code,
    severity: String(check?.severity || ""),
    message: String(check?.summary?.message || check?.message || code),
  }))
  return { status: String(h?.status || "UNKNOWN"), checks }
}

/** `ceph osd ok-to-stop` for a set of OSDs; its exit code is swallowed on purpose. */
export function okToStopCommand(osdIds: number[]): string {
  const ids = osdIds.filter(id => Number.isInteger(id) && id >= 0).map(String)
  return `ceph osd ok-to-stop ${ids.join(" ")} -f json 2>/dev/null; true`
}

/**
 * `ceph osd set-group` / `unset-group` for one CRUSH host. The host is held to
 * the hostname grammar before it reaches a shell, like a node name.
 */
export function groupFlagCommand(flag: CephGroupFlag, crushHost: string, enable: boolean): string {
  const host = assertNodeName(crushHost)
  return `ceph osd ${enable ? "set-group" : "unset-group"} ${flag} ${host}`
}
