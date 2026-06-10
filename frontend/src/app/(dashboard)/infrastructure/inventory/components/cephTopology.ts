// Pure composition logic for the Ceph CRUSH topology view. No JSX, no React —
// kept separate so it is unit-tested and measured by SonarCloud.

export type CrushNode = {
  id: number
  name: string
  type: string
  status?: string
  usedBytes: number
  totalBytes: number
  usedPct: number
  osd?: { up: boolean; in: boolean; deviceClass: string }
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

function osdIndex(list: AnyRec[]): Map<number, AnyRec> {
  const m = new Map<number, AnyRec>()
  for (const o of list) if (typeof o?.id === "number") m.set(o.id, o)
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

function enrich(node: AnyRec, osds: Map<number, AnyRec>, hosts: Map<string, any>): CrushNode {
  const base: CrushNode = {
    id: node.id, name: node.name, type: node.type, status: node.status,
    usedBytes: 0, totalBytes: 0, usedPct: 0,
  }
  if (node.type === "osd" || (!node.children && typeof node.id === "number" && node.id >= 0)) {
    const o = osds.get(node.id)
    if (o) {
      base.usedBytes = o.usedBytes || 0
      base.totalBytes = o.totalBytes || 0
      base.usedPct = typeof o.usedPct === "number" ? o.usedPct : 0
      base.osd = { up: !!o.up, in: !!o.in, deviceClass: o.deviceClass || "unknown" }
      base.status = base.status || (o.up ? "up" : "down")
    }
    return base
  }
  const children = (node.children ?? []).map((c: AnyRec) => enrich(c, osds, hosts))
  base.children = children
  base.usedBytes = children.reduce((s, c) => s + c.usedBytes, 0)
  base.totalBytes = children.reduce((s, c) => s + c.totalBytes, 0)
  base.usedPct = base.totalBytes > 0 ? Math.round((base.usedBytes / base.totalBytes) * 1000) / 10 : 0
  if (node.type === "host") base.daemons = hosts.get(node.name) ?? { mon: false, monLeader: false, mgr: false, mds: false }
  return base
}

export function buildCrushTopology(data: AnyRec): CephTopology {
  const crushTree: AnyRec[] = Array.isArray(data?.crushTree) ? data.crushTree : []
  const osds = osdIndex(data?.osds?.list ?? [])
  const hosts = hostDaemonIndex(data ?? {})
  const tree = crushTree.map((n) => enrich(n, osds, hosts))

  const rules: AnyRec[] = Array.isArray(data?.crushRules) ? data.crushRules : []
  const ruleById = new Map<number, AnyRec>()
  for (const r of rules) if (typeof r?.id === "number") ruleById.set(r.id, r)
  const poolRules: PoolRuleRow[] = (data?.pools?.list ?? []).map((p: AnyRec) => {
    const rule = ruleById.get(p.crushRule)
    const take = rule?.steps?.find((s: AnyRec) => s?.op === "take")
    return {
      pool: p.name,
      ruleName: rule?.name ?? String(p.crushRule ?? ""),
      target: take?.item_name ?? "",
      size: `${p.size ?? "?"}/${p.minSize ?? "?"}`,
      usedPct: typeof p.percentUsed === "number" ? p.percentUsed : 0,
    }
  })

  return { tree, poolRules }
}

export function capacityColor(pct: number): "success" | "warning" | "error" {
  if (pct > 85) return "error"
  if (pct >= 70) return "warning"
  return "success"
}
