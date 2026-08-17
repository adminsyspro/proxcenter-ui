/**
 * Ceph tools for the agentic assistant (#459).
 *
 * Two read-only lookups: the cluster-wide Ceph picture (health, capacity,
 * pools, device classes) and the OSD inventory with its latency spread. They
 * answer the questions the snapshot cannot: how many OSDs sit on each host,
 * what the worst disk latency is, how many NVMe devices the estate holds, and
 * what could be improved.
 *
 * The CRUSH roll-up is NOT reimplemented here. `buildCrushTopology` is the
 * pure, unit-tested derivation the inventory UI already uses; it is fed the
 * same normalised payload shape `/api/v1/connections/[id]/ceph` builds, which
 * is why `gatherCephPayload` below mirrors that route field for field.
 */

import { getConnectionById, type PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import {
  buildCrushTopology,
  type CephTopology,
  type CrushNode,
} from '@/app/(dashboard)/infrastructure/inventory/components/cephTopology'

import {
  argEnum,
  argNumber,
  argString,
  resolveConnection,
  ToolScopeError,
  type AiTool,
  type AiToolContext,
  type ResolvedConnection,
} from './types'

type AnyRec = Record<string, any>

const BYTES_PER_GB = 1024 * 1024 * 1024
const BYTES_PER_TIB = 1024 * 1024 * 1024 * 1024

/** Ceph's own default `nearfull_ratio`, in percent. */
const NEARFULL_PCT = 85

/** How many points above the cluster mean counts as an imbalanced OSD. */
const IMBALANCE_POINTS = 15

/** How far `pg_num` may drift from `pg_num_target` before it is worth saying. */
const PG_DRIFT_RATIO = 0.25

/** Names listed inline in an observation before it switches to a count. */
const OBSERVATION_LIST_CAP = 8

const round1 = (n: number) => Math.round(n * 10) / 10

const gb = (bytes: number) => (bytes > 0 ? round1(bytes / BYTES_PER_GB) : 0)

function num(value: unknown): number | undefined {
  const n = Number(value)

  return Number.isFinite(n) ? n : undefined
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/**
 * A pool's `percent_used` comes back as a 0..1 fraction while an OSD's comes
 * back as a 0..100 percentage. Same normalisation as the inventory pool table,
 * so the assistant and the UI never quote different numbers.
 */
const poolPct = (raw: number) => round1(raw > 1 ? raw : raw * 100)

/** Proxmox reports booleans as 1/0, "1"/"0", true/false or a status string. */
function flag(value: unknown): boolean {
  if (value === true || value === 1 || value === '1') return true

  const s = String(value ?? '').toLowerCase()

  return s === 'true' || s === 'up' || s === 'in'
}

function capNames(names: string[]): string {
  if (names.length <= OBSERVATION_LIST_CAP) return names.join(', ')

  return `${names.slice(0, OBSERVATION_LIST_CAP).join(', ')} and ${names.length - OBSERVATION_LIST_CAP} more`
}

/* ------------------------------------------------------------------ */
/* Normalised payload                                                 */
/* ------------------------------------------------------------------ */

type NormalisedOsd = {
  id: number
  name: string
  host: string
  status: string
  up: boolean
  in: boolean
  deviceClass: string
  totalBytes: number
  usedBytes: number
  usedPct: number
  /** Absent when Proxmox did not report it, never coerced to 0. */
  applyLatencyMs?: number
  commitLatencyMs?: number
  reweight?: number
  pgs?: number
  version?: string | null
}

type NormalisedPool = {
  name: string
  size: number
  minSize: number
  pgNum: number
  pgNumTarget: number
  pgAutoscaleMode: string
  application: string
  crushRule: number
  crushRuleName: string | null
  crushRootId: number | null
  usedBytes: number
  maxAvailBytes: number
  /** 0..100, normalised from the fraction PVE reports. */
  percentUsed: number
  /**
   * Null when Proxmox did not report a count, which is the usual case: the
   * `/ceph/pool` list carries no object count. It must NOT be defaulted to 0,
   * or every pool on every cluster looks empty and the assistant states a
   * measured zero it never measured. Same trap as `usedBytes` on an OSD.
   */
  objects: number | null
}

type HealthIssue = { name: string; severity: string; summary: string }

/**
 * The shape `buildCrushTopology` consumes, plus everything the two tools
 * report. Key names inside `osds`, `pools`, `monitors`, `mds` and `managers`
 * are dictated by that function and must not be renamed.
 */
type CephPayload = {
  health: { status: string; issues: HealthIssue[] }
  capacity: {
    totalGb: number
    usedGb: number
    availableGb: number
    usedPct: number
    effectiveAvailableGb: number
  }
  performance: {
    readBytesSec: number
    writeBytesSec: number
    readOpsSec: number
    writeOpsSec: number
  }
  pgs: { total: number; byState: Record<string, number> }
  osdCounts: { total: number; up: number; in: number; down: number; out: number }
  osds: { list: NormalisedOsd[] }
  monitors: { total: number; inQuorum: number; leader: string | null; list: AnyRec[] }
  managers: { active: { name: string; host: string } | null; standbys: { name: string; host: string }[] }
  pools: { list: NormalisedPool[] }
  mds: { list: AnyRec[] }
  crushTree: AnyRec[]
  crushRules: AnyRec[]
}

/** Depth-first walk of the CRUSH tree, collecting every OSD leaf. */
function flattenOsds(items: AnyRec[]): AnyRec[] {
  const out: AnyRec[] = []

  for (const item of items ?? []) {
    if (item?.type === 'osd' || (item?.id !== undefined && typeof item.id === 'number' && item.id >= 0)) {
      out.push(item)
    }

    if (Array.isArray(item?.children)) out.push(...flattenOsds(item.children))
  }

  return out
}

/** The same walk, but keeping root -> datacenter -> host -> osd nesting. */
function extractCrushTree(items: AnyRec[]): AnyRec[] {
  return (items ?? []).map(item => {
    const node: AnyRec = {
      id: item.id,
      name: item.name,
      type: item.type || (typeof item.id === 'number' && item.id >= 0 ? 'osd' : 'unknown'),
    }

    if (item.status) node.status = item.status
    if (Array.isArray(item.children)) node.children = extractCrushTree(item.children)

    return node
  })
}

/** `/ceph/osd` is a flat array on some releases and a CRUSH tree on others. */
function osdRoots(osdList: unknown): AnyRec[] {
  if (Array.isArray(osdList)) {
    if (osdList.length > 0 && (osdList[0] as AnyRec)?.children) return osdList as AnyRec[]
    if (osdList.length > 0 && (osdList[0] as AnyRec)?.root?.children) return (osdList[0] as AnyRec).root.children

    return []
  }

  if (osdList && typeof osdList === 'object' && (osdList as AnyRec).root?.children) {
    return (osdList as AnyRec).root.children
  }

  return []
}

/**
 * Host buckets rebuilt from each OSD's `host` field.
 *
 * PVE normally answers `/ceph/osd` with a full CRUSH tree, but some payloads
 * come back flat or without a host level, and then the shared roll-up has no
 * hierarchy to aggregate and the per-host OSD counts come back empty. A
 * synthetic host level keeps that question answerable.
 */
function synthesiseHostTree(osds: NormalisedOsd[]): AnyRec[] {
  const byHost = new Map<string, AnyRec[]>()

  for (const osd of osds) {
    const children = byHost.get(osd.host) ?? []

    children.push({ id: osd.id, name: osd.name, type: 'osd' })
    byHost.set(osd.host, children)
  }

  return [...byHost].map(([host, children]) => ({ id: `host-${host}`, name: host, type: 'host', children }))
}

function normaliseOsd(raw: AnyRec): NormalisedOsd {
  const statusStr = String(raw.status ?? '').toLowerCase()
  const up = flag(raw.up) || statusStr.includes('up')
  const isIn = flag(raw.in) || (num(raw.reweight) ?? 0) > 0

  const totalBytes = (num(raw.crush_weight) ?? 0) * BYTES_PER_TIB
  const usedPct = num(raw.percent_used) ?? 0
  const reportedUsed = (num(raw.kb_used) ?? 0) * 1024

  return {
    id: Number(raw.id),
    name: raw.name || `osd.${raw.id}`,
    host: raw.host || raw.crush_location?.host || 'unknown',
    status: raw.status || (up ? 'up' : 'down'),
    up,
    in: isIn,
    // `device_class` missing must stay unknown: defaulting it to nvme (as the
    // per-node ceph route does) silently mislabels SSD and HDD clusters.
    deviceClass: raw.device_class || raw.class || 'unknown',
    totalBytes,
    // `kb_used` is not part of the PVE payload, so a raw used figure is almost
    // always 0. `percent_used` is trustworthy, so derive from it rather than
    // reporting a bogus zero.
    usedBytes: reportedUsed > 0 ? reportedUsed : Math.round((totalBytes * usedPct) / 100),
    usedPct,
    applyLatencyMs: num(raw.apply_latency_ms),
    commitLatencyMs: num(raw.commit_latency_ms),
    reweight: num(raw.reweight),
    pgs: num(raw.pgs) ?? num(raw.num_pgs),
    version: raw.ceph_version_short || raw.version || null,
  }
}

function settled<T>(result: PromiseSettledResult<T>, fallback: T): T {
  return result.status === 'fulfilled' && result.value ? result.value : fallback
}

/**
 * Every Ceph read for one cluster, in one round trip fan-out.
 *
 * Returns null when the node answers no Ceph status at all, which is how a
 * cluster without Ceph presents itself (the endpoints 501 or return nothing).
 */
async function gatherCephPayload(conn: PveConn, nodeName: string): Promise<CephPayload | null> {
  const base = `/nodes/${encodeURIComponent(nodeName)}/ceph`

  const [statusR, osdR, monR, poolR, mdsR, rulesR, fsR] = await Promise.allSettled([
    pveFetch<AnyRec>(conn, `${base}/status`),
    pveFetch<AnyRec[]>(conn, `${base}/osd`),
    pveFetch<AnyRec[]>(conn, `${base}/mon`),
    pveFetch<AnyRec[]>(conn, `${base}/pool`),
    pveFetch<AnyRec[]>(conn, `${base}/mds`),
    pveFetch<AnyRec[]>(conn, `${base}/rules`),
    pveFetch<AnyRec[]>(conn, `${base}/fs`),
  ])

  const status = settled<AnyRec | null>(statusR, null)

  if (!status) return null

  const osdList = settled<AnyRec[]>(osdR, [])
  const monList = settled<AnyRec[]>(monR, [])
  const poolList = settled<AnyRec[]>(poolR, [])
  const mdsList = settled<AnyRec[]>(mdsR, [])
  const rulesList = settled<AnyRec[]>(rulesR, [])
  const fsList = settled<AnyRec[]>(fsR, [])

  /* Health */
  const checks: AnyRec = status.health?.checks || {}
  const issues: HealthIssue[] = Object.entries(checks).map(([name, data]) => ({
    name,
    severity: (data as AnyRec)?.severity || 'UNKNOWN',
    summary: (data as AnyRec)?.summary?.message || name,
  }))

  /* Capacity. The plain fields are RAW physical capacity, which is what the
   * OSD totals add up to; `effectiveAvailableGb` divides the free space by the
   * mean pool replication factor to give usable space. */
  const pgmap: AnyRec = status.pgmap || {}
  const rawTotal = num(pgmap.bytes_total) ?? 0
  const rawUsed = num(pgmap.bytes_used) ?? 0
  const rawAvail = num(pgmap.bytes_avail) ?? 0

  // Data and metadata pools of a CephFS, so an RBD pool can be told apart.
  const cephFsPools = new Set<string>()

  for (const fs of Array.isArray(fsList) ? fsList : []) {
    if (fs?.data_pool) cephFsPools.add(fs.data_pool)
    if (fs?.metadata_pool) cephFsPools.add(fs.metadata_pool)
  }

  const pools: NormalisedPool[] = (Array.isArray(poolList) ? poolList : []).map(pool => {
    const stats: AnyRec = pool.statistics || pool.stats || {}
    const name = pool.pool_name || pool.name || `pool-${pool.pool}`
    const pgNum = num(pool.pg_num) ?? 0

    return {
      name,
      size: num(pool.size) ?? 3,
      minSize: num(pool.min_size) ?? 2,
      pgNum,
      pgNumTarget: num(pool.pg_num_target) ?? pgNum,
      pgAutoscaleMode: pool.pg_autoscale_mode || 'unknown',
      application: cephFsPools.has(name) ? 'cephfs' : 'rbd',
      crushRule: num(pool.crush_rule) ?? 0,
      crushRuleName: pool.crush_rule_name || null,
      crushRootId: num(pool.autoscale_status?.crush_root_id) ?? null,
      usedBytes: num(stats.bytes_used) ?? num(pool.bytes_used) ?? 0,
      maxAvailBytes: num(stats.max_avail) ?? num(pool.max_avail) ?? 0,
      percentUsed: poolPct(num(pool.percent_used) ?? 0),
      objects: num(stats.objects) ?? num(pool.objects) ?? null,
    }
  })

  const avgReplication = pools.length > 0
    ? pools.reduce((sum, p) => sum + (p.size || 3), 0) / pools.length
    : 3

  /* OSDs */
  const roots = osdRoots(osdList)
  const flatOsds = roots.length > 0
    ? flattenOsds(roots)
    : (Array.isArray(osdList) ? osdList : [])

  const osds = flatOsds
    // A negative id is a CRUSH bucket, never an OSD.
    .filter(osd => osd?.id !== undefined && !(typeof osd.id === 'number' && osd.id < 0))
    .map(normaliseOsd)
    .sort((a, b) => a.id - b.id)

  const osdmap: AnyRec = status.osdmap?.osdmap || status.osdmap || {}
  const osdTotal = num(osdmap.num_osds) ?? osds.length
  const osdUp = num(osdmap.num_up_osds) ?? osds.filter(o => o.up).length
  const osdIn = num(osdmap.num_in_osds) ?? osds.filter(o => o.in).length

  /* Monitors and managers */
  const quorum: string[] = Array.isArray(status.quorum_names) ? status.quorum_names : []
  const monmap: AnyRec = status.monmap || {}
  const monTotal = num(monmap.num_mons)
    ?? (Array.isArray(monmap.mons) ? monmap.mons.length : undefined)
    ?? (Array.isArray(monList) ? monList.length : 0)

  const monitors = (Array.isArray(monList) ? monList : []).map(mon => ({
    name: mon.name,
    host: mon.host || String(mon.addr ?? '').split(':')[0] || 'unknown',
    inQuorum: quorum.includes(mon.name),
    leader: quorum[0] === mon.name,
  }))

  // mgr daemon names are hostnames, possibly FQDN: the host is what precedes
  // the first dot, and `buildCrushTopology` keys its daemon badges on it.
  const mgrmap: AnyRec = status.mgrmap || {}
  const mgrHost = (n: unknown) => String(n ?? '').split('.')[0]
  const standbyEntries = Array.isArray(mgrmap.standbys) ? mgrmap.standbys : []

  const mds = (Array.isArray(mdsList) ? mdsList : []).map(entry => ({
    name: entry.name,
    host: entry.host || String(entry.addr ?? '').split(':')[0] || 'unknown',
    state: entry.state || 'unknown',
  }))

  const crushRules = (Array.isArray(rulesList) ? rulesList : []).map(rule => ({
    id: rule.rule_id ?? rule.ruleset ?? rule.id ?? 0,
    name: rule.rule_name ?? rule.name ?? '',
    steps: (rule.steps || []).map((step: AnyRec) => ({
      op: step.op || '',
      item_name: step.item_name || '',
    })),
  }))

  const byState: Record<string, number> = {}

  for (const entry of Array.isArray(pgmap.pgs_by_state) ? pgmap.pgs_by_state : []) {
    if (entry?.state_name) byState[entry.state_name] = num(entry.count) ?? 0
  }

  return {
    health: { status: status.health?.status || 'UNKNOWN', issues },
    capacity: {
      totalGb: gb(rawTotal),
      usedGb: gb(rawUsed),
      availableGb: gb(rawAvail),
      usedPct: rawTotal > 0 ? round1((rawUsed / rawTotal) * 100) : 0,
      effectiveAvailableGb: gb(rawAvail > 0 ? rawAvail / avgReplication : 0),
    },
    performance: {
      readBytesSec: num(pgmap.read_bytes_sec) ?? 0,
      writeBytesSec: num(pgmap.write_bytes_sec) ?? 0,
      readOpsSec: num(pgmap.read_op_per_sec) ?? 0,
      writeOpsSec: num(pgmap.write_op_per_sec) ?? 0,
    },
    pgs: { total: num(pgmap.num_pgs) ?? 0, byState },
    osdCounts: {
      total: osdTotal,
      up: osdUp,
      in: osdIn,
      down: Math.max(0, osdTotal - osdUp),
      out: Math.max(0, osdTotal - osdIn),
    },
    osds: { list: osds },
    monitors: {
      total: monTotal,
      inQuorum: quorum.length,
      leader: quorum[0] ?? null,
      list: monitors,
    },
    managers: {
      active: mgrmap.active_name
        ? { name: mgrmap.active_name, host: mgrHost(mgrmap.active_name) }
        : null,
      standbys: standbyEntries.map((s: AnyRec) => {
        const name = s?.name ?? String(s)

        return { name, host: mgrHost(name) }
      }),
    },
    pools: { list: pools },
    mds: { list: mds },
    crushTree: extractCrushTree(roots),
    crushRules,
  }
}

/* ------------------------------------------------------------------ */
/* Perimeter                                                          */
/* ------------------------------------------------------------------ */

/**
 * The node Ceph is queried through: the first ONLINE member of the resolved
 * cluster, as the connection-level ceph route picks it. Never `nodes[0]`
 * blindly, a cluster whose first node is down must still answer.
 */
function pickQueryNode(ctx: AiToolContext, connId: string): string {
  const nodes = ctx.snapshot.nodes.filter(n => n.connId === connId)

  if (nodes.length === 0) {
    throw new ToolScopeError('No Proxmox host is visible to you in this cluster.')
  }

  return (nodes.find(n => n.status === 'online') ?? nodes[0]).name
}

type LoadedCeph = { nodeQueried: string; payload: CephPayload; topology: CephTopology }

async function loadCeph(ctx: AiToolContext, connection: ResolvedConnection): Promise<LoadedCeph | null> {
  const nodeQueried = pickQueryNode(ctx, connection.id)
  const conn = await getConnectionById(connection.id, ctx.tenantId)
  const payload = await gatherCephPayload(conn, nodeQueried)

  if (!payload) return null

  let topology = buildCrushTopology(payload)

  // A CRUSH tree without a host level (some PVE payloads) would leave the
  // per-host roll-up empty, so feed the same derivation a synthesised one.
  if (payload.osds.list.length > 0 && collectBuckets(topology.tree, 'host').length === 0) {
    topology = buildCrushTopology({ ...payload, crushTree: synthesiseHostTree(payload.osds.list) })
  }

  return { nodeQueried, payload, topology }
}

/** Every bucket of a given CRUSH type, at any depth. */
function collectBuckets(nodes: CrushNode[], type: string, out: CrushNode[] = []): CrushNode[] {
  for (const node of nodes ?? []) {
    if (node.type === type) out.push(node)
    if (node.children) collectBuckets(node.children, type, out)
  }

  return out
}

/* ------------------------------------------------------------------ */
/* Observations                                                       */
/* ------------------------------------------------------------------ */

function poolObservations(pools: NormalisedPool[]): string[] {
  const obs: string[] = []

  for (const p of pools) {
    if (p.size < 3) {
      obs.push(`Pool "${p.name}" runs with size=${p.size}, so it keeps fewer than 3 replicas.`)
    }

    if (p.minSize < 2) {
      obs.push(`Pool "${p.name}" runs with min_size=${p.minSize}.`)
    }

    if (p.pgAutoscaleMode !== 'on') {
      obs.push(`Pool "${p.name}" has pg_autoscale_mode=${p.pgAutoscaleMode}.`)
    }

    if (
      p.pgNumTarget > 0
      && p.pgNum !== p.pgNumTarget
      && Math.abs(p.pgNum - p.pgNumTarget) / p.pgNumTarget >= PG_DRIFT_RATIO
    ) {
      obs.push(`Pool "${p.name}" has pg_num=${p.pgNum} against pg_num_target=${p.pgNumTarget}.`)
    }

    if (p.objects === 0) {
      obs.push(`Pool "${p.name}" holds 0 objects while occupying ${p.pgNum} PGs.`)
    }

    if (p.percentUsed >= NEARFULL_PCT) {
      obs.push(`Pool "${p.name}" is ${round1(p.percentUsed)}% used.`)
    }
  }

  return obs
}

function osdObservations(osds: NormalisedOsd[], counts: CephPayload['osdCounts']): string[] {
  const obs: string[] = []

  // Mean over OSDs that actually carry data: an out or empty OSD reports ~0%
  // and would drag the mean down, manufacturing false imbalance everywhere.
  const carrying = osds.filter(o => o.up && o.in && o.totalBytes > 0)

  if (carrying.length > 1) {
    const mean = carrying.reduce((sum, o) => sum + o.usedPct, 0) / carrying.length
    const skewed = carrying.filter(o => o.usedPct - mean > IMBALANCE_POINTS)

    if (skewed.length > 0) {
      obs.push(
        `Cluster mean OSD usage is ${round1(mean)}%, and these OSDs sit more than ${IMBALANCE_POINTS} points above it: `
        + `${capNames(skewed.map(o => `osd.${o.id} on ${o.host} at ${round1(o.usedPct)}%`))}.`
      )
    }
  }

  const sized = osds.filter(o => o.totalBytes > 0)
  const fullest = sized.length > 0
    ? sized.reduce((worst, o) => (o.usedPct > worst.usedPct ? o : worst), sized[0])
    : null

  if (fullest && fullest.usedPct >= NEARFULL_PCT) {
    obs.push(
      `osd.${fullest.id} on ${fullest.host} is ${round1(fullest.usedPct)}% used, `
      + `at or past the Ceph default nearfull_ratio of ${NEARFULL_PCT}%.`
    )
  }

  const down = osds.filter(o => !o.up)
  const out = osds.filter(o => o.up && !o.in)

  if (down.length > 0) {
    obs.push(`${down.length} OSD(s) are down: ${capNames(down.map(o => `osd.${o.id} on ${o.host}`))}.`)
  } else if (counts.down > 0) {
    obs.push(`The OSD map reports ${counts.down} OSD(s) down out of ${counts.total}.`)
  }

  if (out.length > 0) {
    obs.push(`${out.length} OSD(s) are up but out of the cluster: ${capNames(out.map(o => `osd.${o.id} on ${o.host}`))}.`)
  }

  const reweighted = osds.filter(o => isNum(o.reweight) && o.reweight < 1)

  if (reweighted.length > 0) {
    obs.push(
      'These OSDs carry a reweight below 1: '
      + `${capNames(reweighted.map(o => `osd.${o.id} on ${o.host} at reweight=${o.reweight}`))}.`
    )
  }

  return obs
}

/**
 * Mechanical, measured findings. Every entry states the number it was derived
 * from, and no entry is emitted unless its condition actually holds: the model
 * turns these into advice, this function never does.
 */
function buildObservations(payload: CephPayload, topology: CephTopology): string[] {
  const obs: string[] = []

  if (payload.health.status !== 'HEALTH_OK') {
    obs.push(`Ceph health is ${payload.health.status} with ${payload.health.issues.length} check(s) raised.`)
  }

  for (const issue of payload.health.issues) {
    if (/full/i.test(issue.name)) {
      obs.push(`Ceph raises the capacity check ${issue.name}: ${issue.summary}.`)
    }
  }

  obs.push(...poolObservations(payload.pools.list))
  obs.push(...osdObservations(payload.osds.list, payload.osdCounts))

  // A host bucket that mixes device classes cannot be targeted by a
  // class-scoped CRUSH rule without splitting it.
  for (const host of collectBuckets(topology.tree, 'host')) {
    if (host.classes.length > 1) {
      obs.push(`CRUSH host bucket "${host.name}" mixes device classes ${host.classes.join(', ')} across ${host.osdCount} OSDs.`)
    }
  }

  const mons = payload.monitors.total

  // Every finding states its number. The prompt tells the model to name each
  // finding with its figure, so a finding without one puts it in a bind: it
  // either drops the finding or invents a value.
  if (mons === 1) {
    obs.push('The cluster runs 1 monitor, so it tolerates 0 monitor loss.')
  } else if (mons > 0 && mons % 2 === 0) {
    obs.push(`The cluster runs ${mons} monitors, an even number, so it tolerates the loss of only ${mons / 2 - 1}.`)
  }

  if (mons > 0 && payload.monitors.inQuorum < mons) {
    obs.push(`${payload.monitors.inQuorum} of ${mons} monitors are in quorum.`)
  }

  if (!payload.managers.active) {
    obs.push('0 active Ceph manager is reported.')
  } else if (payload.managers.standbys.length === 0) {
    obs.push('1 Ceph manager is active and 0 standby manager is reported.')
  }

  const dirty = Object.entries(payload.pgs.byState).filter(([state]) => state !== 'active+clean')

  if (dirty.length > 0) {
    obs.push(`PGs in a state other than active+clean: ${dirty.map(([state, count]) => `${count} ${state}`).join(', ')}.`)
  }

  return obs
}

/* ------------------------------------------------------------------ */
/* Tool 1: get_ceph_status                                            */
/* ------------------------------------------------------------------ */

export const getCephStatusTool: AiTool = {
  name: 'get_ceph_status',
  description:
    'Ceph health, capacity, pools, monitors, and how many OSDs of each device class (nvme, ssd, hdd) the cluster has. '
    + 'Use focus=\'improvements\' for "are there any improvements to make?", "is anything wrong?" or "what should I fix?": '
    + 'it returns a short list of measured findings and nothing else, and you must then report every finding it contains. '
    + 'Use focus=\'capacity\' for "how much space is left?", focus=\'devices\' for "how many NVMe devices are there?", '
    + 'and omit focus for a general "how is Ceph doing?". '
    + "Example: focus='improvements'",
  parameters: {
    type: 'object',
    properties: {
      cluster: {
        type: 'string',
        description: 'Cluster name or id. Optional when a single cluster is visible.',
      },
      focus: {
        type: 'string',
        description:
          'Which view to return. \'improvements\' returns only the findings worth acting on, which is what a question about improvements or problems needs.',
        enum: ['all', 'improvements', 'capacity', 'devices'],
        default: 'all',
      },
    },
  },
  execute: async (args, ctx) => {
    const connection = resolveConnection(ctx, argString(args, 'cluster'))
    const focus = argEnum(args, 'focus', ['all', 'improvements', 'capacity', 'devices'] as const, 'all')
    const loaded = await loadCeph(ctx, connection)

    if (!loaded) return { hasCeph: false, cluster: connection.name }

    const { nodeQueried, payload, topology } = loaded

    const deviceClassCounts: Record<string, number> = {}

    for (const osd of payload.osds.list) {
      deviceClassCounts[osd.deviceClass] = (deviceClassCounts[osd.deviceClass] ?? 0) + 1
    }

    const ruleNameByPool = new Map(topology.poolRules.map(r => [r.pool, r.ruleName]))
    const observations = buildObservations(payload, topology)

    /*
     * Narrow views exist because the full payload defeats a small model. Asked
     * "are there improvements to make?", qwen2.5:7b first transcribed all ten
     * sections and then, once the prompt discouraged that, answered that
     * improvements existed without naming one. Handing it the findings alone
     * removes the sorting problem instead of arguing with it in the prompt.
     */
    if (focus === 'improvements') {
      return {
        hasCeph: true,
        cluster: connection.name,
        healthStatus: payload.health.status,
        findingCount: observations.length,
        findings: observations,
        // An empty list is an answer, and one the model states badly if left to
        // infer it from `findings: []`.
        allClear: observations.length === 0,
      }
    }

    if (focus === 'capacity') {
      return {
        hasCeph: true,
        cluster: connection.name,
        capacity: payload.capacity,
        pools: payload.pools.list.map(p => ({
          name: p.name,
          usedGb: gb(p.usedBytes),
          maxAvailGb: gb(p.maxAvailBytes),
          percentUsed: round1(p.percentUsed),
        })),
      }
    }

    if (focus === 'devices') {
      return {
        hasCeph: true,
        cluster: connection.name,
        deviceClassCounts,
        osdTotal: payload.osdCounts.total,
        osdUp: payload.osdCounts.up,
      }
    }

    return {
      hasCeph: true,
      cluster: connection.name,
      nodeQueried,
      // First on purpose. A 7B model weighs the head of a payload most, and
      // with this last it transcribed health, capacity, pools and monitors in
      // order and never reached the answer to "what can be improved?".
      observations,
      health: payload.health,
      capacity: payload.capacity,
      performance: payload.performance,
      pgs: payload.pgs,
      osdCounts: payload.osdCounts,
      monitors: {
        total: payload.monitors.total,
        inQuorum: payload.monitors.inQuorum,
        leader: payload.monitors.leader,
      },
      managers: {
        active: payload.managers.active?.name ?? null,
        standbys: payload.managers.standbys.map(s => s.name),
      },
      pools: payload.pools.list.map(p => ({
        name: p.name,
        size: p.size,
        minSize: p.minSize,
        pgNum: p.pgNum,
        pgAutoscaleMode: p.pgAutoscaleMode,
        application: p.application,
        crushRuleName: p.crushRuleName ?? ruleNameByPool.get(p.name) ?? null,
        usedGb: gb(p.usedBytes),
        maxAvailGb: gb(p.maxAvailBytes),
        percentUsed: round1(p.percentUsed),
        objects: p.objects,
      })),
      deviceClassCounts,
    }
  },
}

/* ------------------------------------------------------------------ */
/* Tool 2: list_ceph_osds                                             */
/* ------------------------------------------------------------------ */

type GroupBy = 'host' | 'device_class' | 'none'
type SortBy = 'latency' | 'usage' | 'id'

const GROUP_BY: readonly GroupBy[] = ['host', 'device_class', 'none']
const SORT_BY: readonly SortBy[] = ['latency', 'usage', 'id']

/** Sort weight, always descending, so `id` negates to come out ascending. */
function sortWeight(osd: NormalisedOsd, sortBy: SortBy): number {
  if (sortBy === 'usage') return osd.usedPct
  if (sortBy === 'id') return -osd.id

  // A down OSD reports 0 ms, which is not low latency: park it at the end
  // rather than letting it look like the healthiest disk in the cluster.
  if (!osd.up) return -1

  return osd.applyLatencyMs ?? osd.commitLatencyMs ?? -1
}

const groupKey = (osd: NormalisedOsd, groupBy: GroupBy) =>
  groupBy === 'device_class' ? osd.deviceClass : osd.host

/**
 * Sort by the metric, then pull each group's rows together. Groups come out in
 * the order their worst member appeared, so truncating with `limit` keeps the
 * rows the question was about.
 */
function orderOsds(osds: NormalisedOsd[], groupBy: GroupBy, sortBy: SortBy): NormalisedOsd[] {
  const sorted = [...osds].sort((a, b) => sortWeight(b, sortBy) - sortWeight(a, sortBy))

  if (groupBy === 'none') return sorted

  const rank = new Map<string, number>()

  for (const osd of sorted) {
    const key = groupKey(osd, groupBy)

    if (!rank.has(key)) rank.set(key, rank.size)
  }

  return sorted.sort((a, b) => rank.get(groupKey(a, groupBy))! - rank.get(groupKey(b, groupBy))!)
}

function latencyStats(osds: NormalisedOsd[]) {
  // Trap: a down OSD reports 0 ms. Counting it would report a perfect cluster
  // precisely when disks are missing.
  const measured = osds.filter(o => o.up && (isNum(o.applyLatencyMs) || isNum(o.commitLatencyMs)))
  const applyValues = measured.map(o => o.applyLatencyMs).filter(isNum)
  const commitValues = measured.map(o => o.commitLatencyMs).filter(isNum)

  const avg = (values: number[]) =>
    values.length > 0 ? round1(values.reduce((s, v) => s + v, 0) / values.length) : null
  const max = (values: number[]) => (values.length > 0 ? Math.max(...values) : null)

  const score = (osd: NormalisedOsd) => osd.applyLatencyMs ?? osd.commitLatencyMs ?? -1
  const worst = measured.length > 0
    ? measured.reduce((acc, o) => (score(o) > score(acc) ? o : acc), measured[0])
    : null

  return {
    measuredOsds: measured.length,
    avgApplyMs: avg(applyValues),
    avgCommitMs: avg(commitValues),
    maxApplyMs: max(applyValues),
    maxCommitMs: max(commitValues),
    worstOsd: worst
      ? {
        id: worst.id,
        host: worst.host,
        deviceClass: worst.deviceClass,
        applyMs: worst.applyLatencyMs ?? null,
        commitMs: worst.commitLatencyMs ?? null,
      }
      : null,
  }
}

export const listCephOsdsTool: AiTool = {
  name: 'list_ceph_osds',
  description:
    'Ceph OSD inventory: how many OSDs each host carries, their device class, usage, and disk latency. '
    + 'Answers "how many OSDs are on each host?", "what is the highest disk latency seen?" and "which OSD is the slowest or the fullest?". '
    + 'Latency figures exclude OSDs that are down, which report a misleading 0 ms. '
    + "Example: groupBy='host', sortBy='latency'",
  parameters: {
    type: 'object',
    properties: {
      cluster: {
        type: 'string',
        description: 'Cluster name or id. Optional when a single cluster is visible.',
      },
      groupBy: {
        type: 'string',
        description: 'How to order the OSD list: by host, by device class, or not at all.',
        enum: ['host', 'device_class', 'none'],
        default: 'host',
      },
      sortBy: {
        type: 'string',
        description: 'latency for the slowest disks first, usage for the fullest first, id for numeric order.',
        enum: ['latency', 'usage', 'id'],
        default: 'latency',
      },
      limit: {
        type: 'integer',
        description: 'How many OSDs to list individually. Default 30, max 200. Roll-ups are never truncated.',
        default: 30,
        minimum: 1,
        maximum: 200,
      },
    },
  },
  execute: async (args, ctx) => {
    const connection = resolveConnection(ctx, argString(args, 'cluster'))
    const groupBy = argEnum<GroupBy>(args, 'groupBy', GROUP_BY, 'host')
    const sortBy = argEnum<SortBy>(args, 'sortBy', SORT_BY, 'latency')
    const limit = argNumber(args, 'limit', 30, { min: 1, max: 200 })

    const loaded = await loadCeph(ctx, connection)

    if (!loaded) return { hasCeph: false, cluster: connection.name }

    const { nodeQueried, payload, topology } = loaded
    const osds = payload.osds.list

    // Per-host roll-up comes from the shared CRUSH derivation, which already
    // aggregates OSD counts, device classes and (percent-derived) used bytes.
    const byHost = collectBuckets(topology.tree, 'host')
      .map(host => ({
        host: host.name,
        osdCount: host.osdCount,
        osdUp: host.osdUp,
        deviceClasses: host.classes,
        totalGb: gb(host.totalBytes),
        usedGb: gb(host.usedBytes),
        usedPct: host.usedPct,
      }))
      .sort((a, b) => a.host.localeCompare(b.host))

    const classBytes = new Map<string, { count: number; up: number; totalBytes: number; usedBytes: number }>()

    for (const osd of osds) {
      const row = classBytes.get(osd.deviceClass)
        ?? { count: 0, up: 0, totalBytes: 0, usedBytes: 0 }

      row.count += 1
      row.up += osd.up ? 1 : 0
      row.totalBytes += osd.totalBytes
      row.usedBytes += osd.usedBytes
      classBytes.set(osd.deviceClass, row)
    }

    const byDeviceClass: Record<string, { count: number; up: number; totalGb: number; usedGb: number }> = {}

    for (const [deviceClass, row] of classBytes) {
      byDeviceClass[deviceClass] = {
        count: row.count,
        up: row.up,
        totalGb: gb(row.totalBytes),
        usedGb: gb(row.usedBytes),
      }
    }

    return {
      hasCeph: true,
      cluster: connection.name,
      nodeQueried,
      osdTotal: payload.osdCounts.total || osds.length,
      groupBy,
      sortBy,
      byHost,
      byDeviceClass,
      latency: latencyStats(osds),
      // Up but out is reported here too: such an OSD carries no data and is
      // just as much a missing disk as a down one, only quieter.
      downOsds: osds
        .filter(o => !o.up || !o.in)
        .map(o => ({ id: o.id, host: o.host, status: o.up ? 'out' : 'down' })),
      osdsListed: Math.min(limit, osds.length),
      osds: orderOsds(osds, groupBy, sortBy).slice(0, limit).map(o => ({
        id: o.id,
        name: o.name,
        host: o.host,
        deviceClass: o.deviceClass,
        up: o.up,
        in: o.in,
        status: o.status,
        totalGb: gb(o.totalBytes),
        usedGb: gb(o.usedBytes),
        usedPct: round1(o.usedPct),
        // Null rather than 0 for a down OSD: 0 ms would read as a fast disk.
        applyMs: o.up ? (o.applyLatencyMs ?? null) : null,
        commitMs: o.up ? (o.commitLatencyMs ?? null) : null,
        reweight: o.reweight ?? null,
        pgs: o.pgs ?? null,
        version: o.version,
      })),
    }
  },
}
