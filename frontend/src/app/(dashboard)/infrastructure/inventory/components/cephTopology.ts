// Pure composition logic for the Ceph CRUSH topology view. No JSX, no React —
// kept separate so it is unit-tested and measured by SonarCloud.

export type OsdDetail = {
  up: boolean
  in: boolean
  deviceClass: string
  reweight?: number
  pgs?: number
  version?: string | null
  applyLatencyMs?: number
  commitLatencyMs?: number
  host?: string
}

export type CrushNode = {
  id: string | number
  name: string
  type: string
  status?: string
  usedBytes: number
  totalBytes: number
  usedPct: number
  // descendant aggregates (osd leaves count themselves)
  osdCount: number
  osdUp: number
  hostCount: number
  classes: string[]
  osd?: OsdDetail
  daemons?: { mon: boolean; monLeader: boolean; mgr: boolean; mds: boolean }
  children?: CrushNode[]
}

export type PoolRuleRow = {
  pool: string
  ruleName: string
  target: string
  size: string
  usedPct: number
}

export type CephTopology = { tree: CrushNode[]; poolRules: PoolRuleRow[] }

type AnyRec = Record<string, any>

const round1 = (n: number) => Math.round(n * 10) / 10

// PVE returns ids as strings ("2") for OSDs and crush rules but numbers for
// buckets (-1). Always key/look up by String() so the merges actually match.
function osdIndex(list: AnyRec[]): Map<string, AnyRec> {
  const m = new Map<string, AnyRec>()
  for (const o of list) if (o?.id !== undefined && o?.id !== null) m.set(String(o.id), o)
  return m
}

// id -> bucket/osd name, over the whole crush tree (used to resolve a pool's
// crush root id to a readable target name).
function bucketNameIndex(nodes: AnyRec[], m: Map<string, string> = new Map()): Map<string, string> {
  for (const n of nodes ?? []) {
    if (n?.id !== undefined && n?.id !== null) m.set(String(n.id), n.name)
    if (Array.isArray(n?.children)) bucketNameIndex(n.children, m)
  }
  return m
}

function hostDaemonIndex(data: AnyRec): Map<string, { mon: boolean; monLeader: boolean; mgr: boolean; mds: boolean }> {
  const m = new Map<string, { mon: boolean; monLeader: boolean; mgr: boolean; mds: boolean }>()
  const get = (host: string) => {
    if (!m.has(host)) m.set(host, { mon: false, monLeader: false, mgr: false, mds: false })
    return m.get(host)!
  }
  for (const mon of data?.monitors?.list ?? []) {
    if (!mon?.host) continue
    const d = get(mon.host)
    d.mon = true
    if (mon.leader) d.monLeader = true
  }
  for (const mds of data?.mds?.list ?? []) if (mds?.host) get(mds.host).mds = true
  const mgrs = data?.managers
  if (mgrs?.active?.host) get(mgrs.active.host).mgr = true
  for (const s of mgrs?.standbys ?? []) if (s?.host) get(s.host).mgr = true
  return m
}

function enrich(node: AnyRec, osds: Map<string, AnyRec>, hosts: Map<string, any>): CrushNode {
  const base: CrushNode = {
    id: node.id, name: node.name, type: node.type, status: node.status,
    usedBytes: 0, totalBytes: 0, usedPct: 0, osdCount: 0, osdUp: 0, hostCount: 0, classes: [],
  }
  if (node.type === "osd" || (!node.children && Number(node.id) >= 0)) {
    const o = osds.get(String(node.id))
    if (o) {
      base.totalBytes = o.totalBytes || 0
      base.usedPct = round1(typeof o.usedPct === "number" ? o.usedPct : 0)
      // The route's osds.list usedBytes is unreliable (derived from a kb_used
      // field PVE doesn't return, so 0); fall back to deriving it from the
      // trustworthy percent_used so bucket roll-ups are correct.
      base.usedBytes = o.usedBytes || Math.round((base.totalBytes * base.usedPct) / 100)
      base.osd = {
        up: !!o.up, in: !!o.in, deviceClass: o.deviceClass || "unknown",
        reweight: o.reweight, pgs: o.pgs, version: o.version ?? null,
        applyLatencyMs: o.applyLatencyMs, commitLatencyMs: o.commitLatencyMs, host: o.host,
      }
      base.status = base.status || (o.up ? "up" : "down")
      base.osdCount = 1
      base.osdUp = o.up ? 1 : 0
      base.classes = base.osd.deviceClass ? [base.osd.deviceClass] : []
    }
    return base
  }
  const children: CrushNode[] = (node.children ?? []).map((c: AnyRec) => enrich(c, osds, hosts))
  base.children = children
  base.usedBytes = children.reduce((s, c) => s + c.usedBytes, 0)
  base.totalBytes = children.reduce((s, c) => s + c.totalBytes, 0)
  base.usedPct = base.totalBytes > 0 ? round1((base.usedBytes / base.totalBytes) * 100) : 0
  base.osdCount = children.reduce((s, c) => s + c.osdCount, 0)
  base.osdUp = children.reduce((s, c) => s + c.osdUp, 0)
  base.hostCount = node.type === "host" ? 1 : children.reduce((s, c) => s + c.hostCount, 0)
  base.classes = [...new Set(children.flatMap((c) => c.classes))].sort((a, b) => a.localeCompare(b))
  if (node.type === "host") base.daemons = hosts.get(node.name) ?? { mon: false, monLeader: false, mgr: false, mds: false }
  return base
}

export function buildCrushTopology(data: AnyRec): CephTopology {
  const crushTree: AnyRec[] = Array.isArray(data?.crushTree) ? data.crushTree : []
  const osds = osdIndex(data?.osds?.list ?? [])
  const hosts = hostDaemonIndex(data ?? {})
  const tree = crushTree.map((n) => enrich(n, osds, hosts))

  const bucketNames = bucketNameIndex(crushTree)
  const rules: AnyRec[] = Array.isArray(data?.crushRules) ? data.crushRules : []
  const ruleById = new Map<string, AnyRec>()
  for (const r of rules) if (r?.id !== undefined && r?.id !== null) ruleById.set(String(r.id), r)

  const poolRules: PoolRuleRow[] = (data?.pools?.list ?? []).map((p: AnyRec) => {
    const rule = ruleById.get(String(p.crushRule))
    const take = rule?.steps?.find((s: AnyRec) => s?.op === "take")
    // Prefer the pool's own crush_rule_name; the rules endpoint is often bare.
    const ruleName = p.crushRuleName || rule?.name || String(p.crushRule ?? "")
    // Target = the rule's take-step bucket/class when available, else the pool's
    // crush root id resolved to a bucket name (e.g. "default").
    const rootName = (p.crushRootId !== undefined && p.crushRootId !== null) ? bucketNames.get(String(p.crushRootId)) : undefined
    return {
      pool: p.name,
      ruleName,
      target: take?.item_name ?? rootName ?? "",
      size: `${p.size ?? "?"}/${p.minSize ?? "?"}`,
      usedPct: round1(typeof p.percentUsed === "number" ? p.percentUsed : 0),
    }
  })

  return { tree, poolRules }
}

export function capacityColor(pct: number): "success" | "warning" | "error" {
  if (pct > 85) return "error"
  if (pct >= 70) return "warning"
  return "success"
}
