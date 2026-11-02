/**
 * Demo bodies of the Ceph cockpit reads, derived from the demo inventory
 * (`/connections/<id>/ceph`, built by buildCephData in demo-api.ts) so the
 * live read, the CRUSH map and the history tell the same story as the
 * inventory: same OSDs, same hosts, same health.
 *
 *  - `/ceph/live`    : the CephLive shape of src/lib/ceph/live.ts;
 *  - `/ceph/crush`   : parseCrushMap() of a decompiled map written from the OSD list;
 *  - `/orchestrator/ceph/<id>/history` : the CephHistory of the orchestrator
 *    (the demo announces Enterprise, so the history is served), with the
 *    per-OSD latency and activity curves when asked;
 *  - the ceph-exporter readings and the OSD precheck (`ok-to-stop`);
 *  - `crushTree` / `crushRules` of the inventory and the raw `/ceph/status`
 *    read by the Ceph tab of the inventory.
 */

import { parseCrushMap } from '@/lib/ceph/crushRules'
import type { ExporterFailure } from '@/lib/ceph/exporterFailure'
import type { OkToStopPayload } from '@/lib/ceph/okToStop'
import type { CephCrushNode, CephCrushRule, CephInventory, CephLive } from '@/lib/ceph/types'
import type { CephHistory, CephHistoryPoint } from '@/lib/orchestrator/client'

/** Same windows and steps as src/app/api/v1/orchestrator/ceph/[connectionId]/history/route.ts. */
export const DEMO_CEPH_HISTORY_RANGES: Record<string, { seconds: number; step: number }> = {
  '1h': { seconds: 3600, step: 60 },
  '24h': { seconds: 86_400, step: 300 },
  '7d': { seconds: 604_800, step: 1800 },
  '30d': { seconds: 2_592_000, step: 7200 },
}

const DAY = 86_400

/** Daily load curve, 0.65 at night to 1.15 mid-afternoon, plus a small deterministic ripple. */
function load(tSec: number, seed: number): number {
  const day = Math.sin((2 * Math.PI * ((tSec % DAY) - 6 * 3600)) / DAY)
  const ripple = Math.sin(tSec / 97 + seed) * 0.04 + Math.sin(tSec / 413 + seed * 2) * 0.03

  return 0.9 + 0.25 * day + ripple
}

const round = (n: number) => Math.round(n)
const unclean = (inv: CephInventory) => inv.pgs.states.filter(s => s.state_name !== 'active+clean').reduce((n, s) => n + s.count, 0)
const healthCode = (status: string): 0 | 1 | 2 => (status === 'HEALTH_ERR' ? 2 : status === 'HEALTH_WARN' ? 1 : 0)

export function demoCephLive(inv: CephInventory, atMs: number): CephLive {
  const t = atMs / 1000
  const f = load(t, inv.osds.total)
  const notClean = unclean(inv)
  const recovering = notClean > 0

  return {
    health: { status: inv.health.status, checks: inv.health.checks },
    pg: {
      total: inv.pgs.total,
      clean: inv.pgs.total - notClean,
      byState: inv.pgs.states.map(s => ({ state: s.state_name, count: s.count })),
    },
    osd: { total: inv.osds.total, up: inv.osds.up, in: inv.osds.in },
    io: {
      readOps: round(inv.performance.readOpsSec * f),
      writeOps: round(inv.performance.writeOpsSec * f),
      readBytes: round(inv.performance.readBytesSec * f),
      writeBytes: round(inv.performance.writeBytesSec * f),
    },
    recovery: recovering
      ? { bytesPerSec: round(48 * 1024 ** 2 * f), objectsPerSec: round(12 * f), degraded: notClean * 124, misplaced: 0 }
      : { bytesPerSec: 0, objectsPerSec: 0, degraded: 0, misplaced: 0 },
    raw: { used: inv.capacity.rawUsedBytes, total: inv.capacity.rawTotalBytes },
    at: atMs,
  }
}

type OsdList = CephInventory['osds']['list']

/** The OSDs of each host, in the order the hosts first appear in the list. */
function osdsByHost(osds: OsdList): Map<string, OsdList> {
  const hosts = new Map<string, OsdList>()

  for (const osd of osds) hosts.set(osd.host, [...(hosts.get(osd.host) ?? []), osd])

  return hosts
}

/** The device classes of the OSDs, in the order they first appear. */
function deviceClasses(osds: OsdList): string[] {
  return [...new Set(osds.map(o => o.deviceClass).filter(Boolean))]
}

/**
 * `crushTree` of the inventory (what the route extracts from PVE's OSD tree): the `default` root, one host bucket
 * per OSD host (ids -2, -3... like the decompiled map below) and the OSDs as leaves.
 */
export function demoCrushTree(osds: OsdList): CephCrushNode[] {
  const hosts = [...osdsByHost(osds)].map(([host, list], i): CephCrushNode => ({
    id: -2 - i,
    name: host,
    type: 'host',
    type_id: 1,
    children: list.map((o): CephCrushNode => ({ id: o.id, name: o.name, type: 'osd', type_id: 0, status: o.up ? 'up' : 'down' })),
  }))

  return [{ id: -1, name: 'default', type: 'root', type_id: 11, children: hosts }]
}

/** `crushRules` of the inventory: the default replicated rule and one rule per device class, as PVE lists them. */
export function demoCrushRules(osds: OsdList): CephCrushRule[] {
  const rule = (id: number, name: string, root: string): CephCrushRule => ({
    id,
    name,
    steps: [
      { op: 'take', type: '', num: 0, item: -1, item_name: root },
      { op: 'chooseleaf_firstn', type: 'host', num: 0, item: -1, item_name: '' },
      { op: 'emit', type: '', num: 0, item: -1, item_name: '' },
    ],
  })

  return [rule(0, 'replicated_rule', 'default'), ...deviceClasses(osds).map((cls, i) => rule(i + 1, `replicated_${cls}`, `default~${cls}`))]
}

/** A decompiled CRUSH map with one host bucket per OSD host under `default`, then parsed like the route does. */
export function demoCephCrush(inv: CephInventory): ReturnType<typeof parseCrushMap> {
  const hosts = osdsByHost(inv.osds.list)

  const weight = (bytes: number) => (bytes / 1024 ** 4).toFixed(5)
  const lines: string[] = ['# begin crush map', '', '# devices']

  for (const osd of inv.osds.list) lines.push(`device ${osd.id} osd.${osd.id} class ${osd.deviceClass || 'hdd'}`)
  lines.push('', '# types', 'type 0 osd', 'type 1 host', 'type 11 root', '', '# buckets')

  let id = -2

  for (const [host, osds] of hosts) {
    lines.push(`host ${host} {`, `\tid ${id--}`, '\talg straw2', '\thash 0')
    for (const osd of osds) lines.push(`\titem osd.${osd.id} weight ${weight(osd.totalBytes)}`)
    lines.push('}')
  }

  lines.push('root default {', '\tid -1', '\talg straw2', '\thash 0')
  for (const [host, osds] of hosts) lines.push(`\titem ${host} weight ${weight(osds.reduce((n, o) => n + o.totalBytes, 0))}`)
  lines.push('}', '', '# rules')
  lines.push('rule replicated_rule {', '\tid 0', '\ttype replicated', '\tstep take default', '\tstep chooseleaf firstn 0 type host', '\tstep emit', '}')

  const classes = deviceClasses(inv.osds.list)

  classes.forEach((cls, i) => {
    lines.push(`rule replicated_${cls} {`, `\tid ${i + 1}`, '\ttype replicated', `\tstep take default class ${cls}`, '\tstep chooseleaf firstn 0 type host', '\tstep emit', '}')
  })
  lines.push('', '# end crush map')

  return parseCrushMap(lines.join('\n'))
}

/** Connection whose last host has no reachable ceph-exporter: the demo of the failure reasons. */
export const DEMO_EXPORTER_FAILURE_CONNECTION = 'demo-pve-dr-001'
/** The OSDs of the DR cluster went down this long ago (the PG_DEGRADED check says "stuck undersized for 41m"). */
const DEMO_OSD_DOWN_SECONDS = 41 * 60
/** Cap of the stored curves, as in the orchestrator (cephSparklineMaxPoints). */
const SPARKLINE_MAX_POINTS = 60
const MAX_OSD_IDS = 100

/**
 * Hosts of the cluster whose ceph-exporter does not answer, with the reason: on the DR cluster only, the LAST host
 * of the inventory, whose port refuses connections (package not installed). The production cluster is fully ok.
 */
export function demoCephExporterFailures(connectionId: string, inv: CephInventory): Record<string, ExporterFailure> {
  if (connectionId !== DEMO_EXPORTER_FAILURE_CONNECTION) return {}

  const hosts = [...osdsByHost(inv.osds.list).keys()]
  const last = hosts[hosts.length - 1]

  return last ? { [last]: 'refused' } : {}
}

export interface DemoHistoryExtras {
  /** `osds=`: the OSDs whose latency curve (and activity curve with `osdIo`) is asked. */
  osds?: number[]
  osdIo?: boolean
  /** Hosts whose exporter fails (see demoCephExporterFailures). */
  failures?: Record<string, ExporterFailure>
}

/**
 * The `osds` and `osd_io` parameters of the history, validated like src/app/api/v1/orchestrator/ceph/[connectionId]/history/route.ts:
 * distinct non-negative integers, at most 100, `osd_io` only as `1` and only with `osds`.
 */
export function parseDemoHistoryOsds(params: URLSearchParams): DemoHistoryExtras | { error: string } {
  const osdsRaw = params.get('osds')
  let osds: number[] | undefined

  if (osdsRaw !== null) {
    const parts = osdsRaw.split(',')

    if (!parts.every(p => /^\d{1,9}$/.test(p))) return { error: 'osds must be a comma separated list of non-negative integers' }
    osds = [...new Set(parts.map(Number))]
    if (osds.length > MAX_OSD_IDS) return { error: `osds must hold at most ${MAX_OSD_IDS} distinct ids` }
  }

  const osdIoRaw = params.get('osd_io')

  if (osdIoRaw !== null && osdIoRaw !== '1') return { error: 'osd_io must be 1' }
  if (osdIoRaw === '1' && !osds) return { error: 'osd_io requires osds' }

  return { osds, osdIo: osdIoRaw === '1' }
}

/** Stable pseudo-random number in [0, 1) of two integers (no state, so a curve is the same at every request). */
function hash01(a: number, b = 0): number {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)

  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15

  return (h >>> 0) / 4_294_967_296
}

/**
 * Load factor of one OSD at `x` (Unix seconds), around 0.9 like the cluster one. Each OSD has its own day phase,
 * its own slow and fast ripples and its own rare bursts, so the curves of two OSDs never peak together.
 */
function osdFactor(x: number, osdId: number): number {
  const own = hash01(osdId, 1)
  const day = Math.sin(2 * Math.PI * ((x % DAY) / DAY + own))
  const slow = Math.sin(x / (1700 + 230 * (osdId % 7)) + own * 2 * Math.PI)
  const fast = Math.sin(x / (83 + 11 * (osdId % 5)) + osdId)
  const burst = hash01(osdId, Math.floor(x / 900)) > 0.97 ? 0.55 : 0

  return 0.9 + 0.22 * day + 0.07 * slow + 0.04 * fast + burst
}

/** Step of the per-OSD curves: the request step, raised so that the curve holds at most 60 points (orchestrator cephSparklineStep). */
function sparklineStep(from: number, to: number, step: number): number {
  const minStep = (to - from) / (SPARKLINE_MAX_POINTS - 1)

  return step < minStep ? Math.ceil(minStep / 60) * 60 : step
}

/** Instants of a per-OSD curve: the grid of the step aligned on the epoch, so that the curve scrolls instead of being rebuilt. */
function sparklineTimes(from: number, to: number, step: number): number[] {
  const times: number[] = []

  for (let t = Math.floor(from / step) * step; t < to; t += step) times.push(t)

  return times
}

/** The curve of an OSD stops where the OSD went down; an OSD that is up has data up to the end of the window. */
function curveEnd(osd: CephInventory['osds']['list'][number], to: number): number {
  return osd.up ? to : to - DEMO_OSD_DOWN_SECONDS
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * History over `range` ending at `nowMs`, or null for a range the route would refuse. With `extras.osds`, the
 * latency curve of each of those OSDs that has data (`osd_series`); with `extras.osdIo`, also their activity
 * (`osd_io_series`, read from the ceph-exporter) and the exporter state of every host (`exporter`).
 */
export function demoCephHistory(inv: CephInventory, range: string, nowMs: number, top = 8, extras: DemoHistoryExtras = {}): CephHistory | null {
  const spec = DEMO_CEPH_HISTORY_RANGES[range]

  if (!spec) return null

  const to = Math.floor(nowMs / 1000 / spec.step) * spec.step
  const from = to - spec.seconds
  const up = inv.osds.list.filter(o => o.up)
  const latAvg = up.length ? up.reduce((n, o) => n + o.commitLatencyMs, 0) / up.length : null
  const latMax = up.length ? Math.max(...up.map(o => o.commitLatencyMs)) : null
  const notClean = unclean(inv)
  const points: CephHistoryPoint[] = []

  for (let t = from + spec.step; t <= to; t += spec.step) {
    const f = load(t, inv.osds.total)
    // Raw usage grows by about 1 % over 30 days, so the long ranges show a real slope.
    const grow = 1 - ((to - t) / (30 * DAY)) * 0.01

    points.push({
      time: t,
      health: healthCode(inv.health.status),
      read_ops: round(inv.performance.readOpsSec * f),
      write_ops: round(inv.performance.writeOpsSec * f),
      read_bytes: round(inv.performance.readBytesSec * f),
      write_bytes: round(inv.performance.writeBytesSec * f),
      recovering_bytes: notClean > 0 ? round(48 * 1024 ** 2 * f) : 0,
      degraded_objects: notClean * 124,
      misplaced_objects: 0,
      pgs_total: inv.pgs.total,
      pgs_clean: inv.pgs.total - notClean,
      raw_used_bytes: round(inv.capacity.rawUsedBytes * grow),
      raw_total_bytes: inv.capacity.rawTotalBytes,
      osd_total: inv.osds.total,
      osd_up: inv.osds.up,
      osd_in: inv.osds.in,
      osd_lat_avg_ms: latAvg === null ? null : Math.round(latAvg * f * 100) / 100,
      osd_lat_max_ms: latMax === null ? null : Math.round(latMax * (0.9 + 0.3 * f) * 100) / 100,
    })
  }

  const slowest_osds = [...up]
    .sort((a, b) => b.commitLatencyMs - a.commitLatencyMs || a.id - b.id)
    .slice(0, top)
    .map(o => ({ osd_id: o.id, avg_ms: o.commitLatencyMs, max_ms: Math.round(o.commitLatencyMs * 2.4 * 100) / 100 }))

  const history: CephHistory = { from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString(), step: spec.step, points, slowest_osds }

  if (extras.osds) {
    const step = sparklineStep(from, to, spec.step)
    const times = sparklineTimes(from, to, step)
    const failures = extras.failures ?? {}
    const osd_series: NonNullable<CephHistory['osd_series']> = {}
    const osd_io_series: NonNullable<CephHistory['osd_io_series']> = {}

    for (const id of extras.osds) {
      const osd = inv.osds.list.find(o => o.id === id)

      if (!osd) continue

      const end = curveEnd(osd, to)
      const own = times.filter(t => t < end)

      if (own.length === 0) continue

      // A bucket is read at its middle, whatever the window: the curve scrolls and a point keeps its value.
      const at = (t: number) => t + step / 2

      osd_series[String(id)] = own.map(t => {
        const x = at(t)
        const avg = osd.commitLatencyMs * (osdFactor(x, id) / 0.9) * (1 + 0.05 * Math.sin(x / 151 + id))

        return { time: t, avg_ms: round2(avg), max_ms: round2(avg * (1.9 + 0.7 * hash01(id, Math.floor(x / 120)))) }
      })

      if (extras.osdIo && !failures[osd.host]) {
        const share = osdIoShare(inv, id)

        osd_io_series[String(id)] = own.map(t => {
          const rate = share * osdFactor(at(t), id)

          return {
            time: t,
            read_ops: round2(inv.performance.readOpsSec * rate),
            write_ops: round2(inv.performance.writeOpsSec * rate),
            read_bytes: round(inv.performance.readBytesSec * rate),
            write_bytes: round(inv.performance.writeBytesSec * rate),
          }
        })
      }
    }

    history.osd_series = osd_series

    if (extras.osdIo) {
      history.osd_io_series = osd_io_series

      const nodes: NonNullable<CephHistory['exporter']>['nodes'] = {}
      const lastOk = Math.floor(nowMs / 1000)

      for (const host of osdsByHost(inv.osds.list).keys()) nodes[host] = failures[host] ? { ok: false, last_ok: null } : { ok: true, last_ok: lastOk }
      history.exporter = { nodes }
    }
  }

  return history
}

/** Share of the cluster I/O that one OSD carries: an equal split, weighted from 0.8 to 1.2 by OSD (averaging 1). */
function osdIoShare(inv: CephInventory, osdId: number): number {
  return (1 / Math.max(1, inv.osds.total)) * (0.8 + ((osdId * 37) % 11) / 25)
}

/**
 * Cumulative ceph-exporter counters of one demo OSD at `atMs`, growing with
 * time like the real ones (since the OSD started). The rate follows the
 * inventory's cluster I/O split between the OSDs (the same share as the stored
 * history, see osdIoShare), with a slow ripple; it stays positive, so the
 * counters never decrease between two readings.
 */
function demoOsdCounters(inv: CephInventory, osdId: number, atMs: number) {
  const t = atMs / 1000
  const share = osdIoShare(inv, osdId)
  const integral = (perSec: number) => perSec * share * (0.9 * t - 6 * Math.cos(t / 60 + osdId))
  const base = 1_000_000 * (osdId + 1)

  return {
    op_r: round(base + integral(inv.performance.readOpsSec)),
    op_w: round(base / 4 + integral(inv.performance.writeOpsSec)),
    op_r_out_bytes: round(base * 3000 + integral(inv.performance.readBytesSec)),
    op_w_in_bytes: round(base * 2000 + integral(inv.performance.writeBytesSec)),
  }
}

/**
 * `GET /connections/<id>/nodes/<node>/ceph/exporter?osd=N`: the reading, or null when the node has no such OSD
 * that the exporter reports (an OSD that is down is not exported). The failure of the node is the caller's: see
 * demoCephExporterFailures.
 */
export function demoCephExporterOsd(inv: CephInventory, node: string, osdId: number, atMs: number) {
  const osd = inv.osds.list.find(o => o.id === osdId && o.host === node && o.up)

  return osd ? { osd: osdId, at: atMs, ...demoOsdCounters(inv, osdId, atMs) } : null
}

export type DemoExporterNode = { ok: true } | { ok: false; reason: ExporterFailure }

/**
 * `GET /connections/<id>/ceph/exporter?nodes=a,b`: null when no node is listed, more than 20 are, or one is not the
 * cluster's. A node in `failures` is `ok: false` with its reason and its OSDs are absent, like one that answers
 * but does not export a stopped OSD.
 */
export function demoCephExporterNodes(inv: CephInventory, nodes: string[], atMs: number, failures: Record<string, ExporterFailure> = {}) {
  const hosts = new Set(inv.osds.list.map(o => o.host))

  if (nodes.length === 0 || nodes.length > 20 || nodes.some(n => !hosts.has(n))) return null

  const out: { at: number; nodes: Record<string, DemoExporterNode>; osds: Record<string, { node: string; op_r: number; op_w: number; op_r_out_bytes: number; op_w_in_bytes: number }> } = { at: atMs, nodes: {}, osds: {} }

  for (const n of nodes) out.nodes[n] = failures[n] ? { ok: false, reason: failures[n] } : { ok: true }
  for (const osd of inv.osds.list) {
    if (osd.up && nodes.includes(osd.host) && !failures[osd.host]) out.osds[String(osd.id)] = { node: osd.host, ...demoOsdCounters(inv, osd.id, atMs) }
  }

  return out
}

export type DemoOkToStop = { payload: OkToStopPayload } | { error: 'node' | 'osd' }

/**
 * `POST /connections/<id>/nodes/<node>/ceph/osd/<id>/ok-to-stop`: Ceph's verdict on stopping the OSD. It is refused
 * while placement groups are not clean (stopping one more copy would take them below min_size), with the count of
 * those PGs; otherwise it is granted. A node that is not the cluster's, or an OSD that is not on that node, is unknown.
 */
export function demoCephOkToStop(inv: CephInventory, node: string, osdId: number): DemoOkToStop {
  if (!inv.osds.list.some(o => o.host === node)) return { error: 'node' }

  const osd = inv.osds.list.find(o => o.id === osdId && o.host === node)

  if (!osd) return { error: 'osd' }

  const notOk = unclean(inv)

  return { payload: { ok: notOk === 0, osds: [osdId], numOkPgs: Math.max(0, (osd.pgs ?? 0) - notOk), numNotOkPgs: notOk, message: null } }
}

const hex = (n: number, len: number) => (n >>> 0).toString(16).padStart(len, '0')

/**
 * Raw `GET /connections/<id>/ceph/status` (PVE's `ceph status` plus the route's `_normalized`), read by the Ceph tab
 * of the inventory: Health, Status (OSD grid, PGs), services, Usage and Performance. Derived from the inventory so the
 * tab and the cockpit show the same cluster. Throughput and IOPS follow the clock (the tab polls every 2 s and charts
 * them): the cluster load of `demoCephLive` plus ripples of a few seconds, with the reads and the writes on their own.
 */
export function demoCephStatus(inv: CephInventory, atMs: number) {
  const t = Math.floor(atMs / 1000)
  const f = load(t, inv.osds.total)
  const wobble = (salt: number, metric: number) => f + 0.1 * Math.sin(t / 13 + salt) + 0.06 * Math.sin(t / 4.7 + 2 * salt) + (hash01(t, salt * 10 + metric) - 0.5) * 0.08
  const readF = (metric: number) => wobble(1, metric)
  const writeF = (metric: number) => wobble(2.4, metric)
  const notClean = unclean(inv)
  const perf = inv.performance
  const checks = Object.fromEntries(inv.health.checks.map(c => [c.name, { severity: c.severity, summary: { message: c.summary }, detail: c.detail, muted: false }]))
  const ipOf = (host: string) => inv.monitors.list.find(m => m.host === host)?.addr.split(':')[0]
  const mgrEntry = (m: { name: string; host: string }) => {
    const ip = ipOf(m.host)

    return { name: m.name, addr: ip ? `${ip}:6800/1` : null }
  }
  const active = inv.managers.active

  return {
    fsid: `${hex(inv.osds.total * 2654435761, 8)}-b574-4d5e-b8b2-5e96fec499c4`,
    health: { status: inv.health.status, checks, mutes: [] },
    election_epoch: 450,
    quorum: inv.monitors.list.map((_, i) => i),
    quorum_names: inv.monitors.quorumNames,
    quorum_age: 16_355_835,
    monmap: { epoch: 3, mons: inv.monitors.list.map((m, rank) => ({ rank, name: m.name, addr: m.addr, public_addr: m.addr })) },
    osdmap: { epoch: 2_943_367, num_osds: inv.osds.total, num_up_osds: inv.osds.up, num_in_osds: inv.osds.in, num_remapped_pgs: 0 },
    pgmap: {
      num_pgs: inv.pgs.total,
      pgs_by_state: inv.pgs.states.map(s => ({ state_name: s.state_name, count: s.count })),
      num_pools: inv.pools.total,
      num_objects: inv.pools.list.reduce((n, p) => n + p.objects, 0),
      data_bytes: inv.capacity.usedBytes,
      bytes_used: inv.capacity.rawUsedBytes,
      bytes_avail: inv.capacity.rawTotalBytes - inv.capacity.rawUsedBytes,
      bytes_total: inv.capacity.rawTotalBytes,
      read_bytes_sec: round(perf.readBytesSec * readF(0)),
      write_bytes_sec: round(perf.writeBytesSec * writeF(0)),
      read_op_per_sec: round(perf.readOpsSec * readF(1)),
      write_op_per_sec: round(perf.writeOpsSec * writeF(1)),
      ...(notClean > 0 ? { recovering_bytes_per_sec: round(48 * 1024 ** 2 * f), degraded_objects: notClean * 124 } : {}),
    },
    mgrmap: {
      available: active !== null,
      active_name: active?.name ?? null,
      active_addr: active ? mgrEntry(active).addr : null,
      standbys: inv.managers.standbys.map(mgrEntry),
    },
    fsmap: { epoch: 1, by_rank: [], 'up:standby': 0 },
    version: inv.monitors.list[0]?.version ?? null,
    _normalized: {
      osd: {
        num_osds: inv.osds.total,
        num_up_osds: inv.osds.up,
        num_in_osds: inv.osds.in,
        list: inv.osds.list.map(o => ({ id: o.id, up: o.up, in: o.in })),
      },
      mds: inv.mds.list.map(m => ({ name: m.name, state: m.state, addr: m.addr, host: m.host, rank: m.rank })),
      healthChecks: inv.health.checks.map(c => ({ name: c.name, severity: c.severity, summary: c.summary, detail: c.detail })),
    },
  }
}
