import type { CephInventory, CephOsd, OsdFilter } from './types'
import type { OsdLoad, OutImpact } from './osdOutImpact'
import { crushHostMatchesNode } from './nodeNoout'
import { cephRatios } from './thresholds'

/*
   Pure model of the OSD tab: the quick filters and their counts, the OSDs grouped by
   host, the page of rows to draw, the load of an OSD as the out-impact estimate reads
   it and the pools that can place data on it. Nothing here renders or fetches.
*/

const TIB = 1024 ** 4
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

export const OSD_PAGE_SIZE = 20

export interface Ratios {
  nearfull: number
  full: number
}

/** What makes an OSD a problem besides its own state: its fill against the thresholds and the health checks that cite it. */
export interface OsdContext {
  ratios?: Ratios
  /** The OSDs a health check points at (osdIssues of hostMap.ts). */
  issues?: ReadonlyMap<number, readonly unknown[]>
}

/**
 * The load of one OSD as osdOutImpact reads it. Size and used bytes are the measured ones (the
 * route reads kb_used or PVE's bytes_used and total_space); the CRUSH weight sizes it when nothing
 * was measured, and the fill percentage rebuilds the used bytes only as a fallback. The load is
 * `loadKnown: false` when it cannot be trusted: no size, an OSD that is down (it reports no fill),
 * or no fill at all while it holds placement groups. An unknown load is never read as "nothing to move".
 */
export function toOsdLoad(osd: CephOsd): OsdLoad {
  const measured = (osd.usedBytes || 0) + (osd.availBytes || 0)
  const totalBytes = measured > 0 ? measured : Math.max(0, osd.totalBytes || 0)
  const fill = Math.max(0, osd.usedPct || 0)
  const usedBytes = osd.usedBytes > 0 ? osd.usedBytes : (fill / 100) * totalBytes
  const holdsPgs = (osd.pgs ?? 0) > 0
  const loadKnown = totalBytes > 0 && osd.up && (usedBytes > 0 || !holdsPgs)

  return {
    id: osd.id,
    host: osd.host,
    deviceClass: osd.deviceClass,
    usedBytes,
    totalBytes,
    crushWeight: totalBytes / TIB,
    up: osd.up,
    in: osd.in,
    loadKnown,
  }
}

/** Fill of the OSD before the move (0 to 1) of the one the projection ends fullest: the "before" of the impact. */
export function projectedBefore(osds: CephOsd[], impact: Pick<OutImpact, 'maxProjectedOsd'>): number | null {
  const target = impact.maxProjectedOsd === null ? null : osds.find(o => o.id === impact.maxProjectedOsd)

  return target ? Math.min(1, Math.max(0, target.usedPct / 100)) : null
}

const fillOf = (osd: CephOsd) => (Number.isFinite(osd.usedPct) ? osd.usedPct / 100 : 0)

/** Down, out, past nearfull or cited by a health check. */
export function isProblemOsd(osd: CephOsd, ctx: OsdContext = {}): boolean {
  const { nearfull } = ctx.ratios ?? cephRatios()

  return !osd.up || !osd.in || fillOf(osd) >= nearfull || (ctx.issues?.get(osd.id)?.length ?? 0) > 0
}

export function matchesOsdFilter(osd: CephOsd, filter: OsdFilter, ctx: OsdContext = {}): boolean {
  switch (filter) {
    case 'down':
      return !osd.up
    case 'out':
      return !osd.in
    case 'problem':
      return isProblemOsd(osd, ctx)
    default:
      return true
  }
}

export function osdFilterCounts(osds: CephOsd[], ctx: OsdContext = {}): Record<OsdFilter, number> {
  return {
    all: osds.length,
    problem: osds.filter(o => isProblemOsd(o, ctx)).length,
    down: osds.filter(o => !o.up).length,
    out: osds.filter(o => !o.in).length,
  }
}

export interface OsdQuery extends OsdContext {
  search?: string
  host?: string
  deviceClass?: string
  filter?: OsdFilter
}

export interface OsdHostGroup {
  host: string
  osds: CephOsd[]
}

/** The OSDs that pass the search, the host and class selects and the quick filter, by host in natural order. */
export function groupOsdsByHost(osds: CephOsd[], query: OsdQuery = {}): OsdHostGroup[] {
  const needle = (query.search ?? '').trim().toLowerCase()
  const byHost = new Map<string, CephOsd[]>()

  for (const o of osds) {
    if (query.host && o.host !== query.host) continue
    if (query.deviceClass && o.deviceClass !== query.deviceClass) continue
    if (!matchesOsdFilter(o, query.filter ?? 'all', query)) continue
    if (needle && !`osd.${o.id} ${o.name ?? ''} ${o.host}`.toLowerCase().includes(needle)) continue
    byHost.set(o.host, [...(byHost.get(o.host) ?? []), o])
  }

  return [...byHost.entries()]
    .sort(([a], [b]) => natural(a, b))
    .map(([host, list]) => ({ host, osds: [...list].sort((a, b) => a.id - b.id) }))
}

export type OkToStopVerdict = 'checking' | 'ok' | 'refused' | 'unknown'

/** What `ceph osd ok-to-stop` said: no answer yet, no verdict (null, or a message instead of one), safe, or refused. */
export function okToStopVerdict(
  payload: { ok: boolean; message?: string | null } | null,
  loading = false,
): OkToStopVerdict {
  if (loading) return 'checking'
  if (!payload || payload.message) return 'unknown'

  return payload.ok === true ? 'ok' : 'refused'
}

/**
 * Typing the OSD name is required unless Ceph said it is safe AND the projection is known and stays
 * under nearfull.
 */
export function needsOsdNameTyping(verdict: OkToStopVerdict, impact: Pick<OutImpact, 'overNearfull'> & { unknown?: boolean }): boolean {
  return verdict !== 'ok' || impact.overNearfull || impact.unknown === true
}

/**
 * `force` of a confirmed action: only a verdict that is not "ok" is overridden. When Ceph said ok and
 * only the projected fill asked for the name, the action goes without force and the server asks Ceph again.
 */
export const forceForVerdict = (verdict: OkToStopVerdict): boolean => verdict !== 'ok'

export type OsdDotState = 'ok' | 'warn' | 'error'

/** Worst state of an OSD: down, full or an error check; then out, nearfull or a warning check. */
export function osdDotState(osd: Pick<CephOsd, 'up' | 'in' | 'usedPct'>, ratios: Ratios, issues: readonly { severity: 'error' | 'warning' }[] = []): OsdDotState {
  const fill = Number.isFinite(osd.usedPct) ? osd.usedPct / 100 : 0

  if (!osd.up || fill >= ratios.full || issues.some(i => i.severity === 'error')) return 'error'
  if (!osd.in || fill >= ratios.nearfull || issues.length > 0) return 'warn'

  return 'ok'
}

/**
 * The PVE node a CRUSH host stands for: the exact name, else the node it matches by first label
 * (a bucket named with the FQDN). Null when none matches, or when several nodes match and none is exact.
 */
export function resolvePveNode(crushHost: string, nodes: readonly string[] | undefined): string | null {
  if (!nodes || nodes.length === 0) return null
  if (nodes.includes(crushHost)) return crushHost

  const matches = nodes.filter(n => crushHostMatchesNode(crushHost, n))

  return matches.length === 1 ? matches[0] : null
}

/** PVE status of the node a CRUSH host stands for; undefined (grey dot) when the host resolves to no node or the status is unknown. */
export function pveStatusOfHost(crushHost: string, inv: { pveNodes?: readonly string[]; pveNodeStatus?: Record<string, string> } | null | undefined): string | undefined {
  const node = resolvePveNode(crushHost, inv?.pveNodes)

  return node ? inv?.pveNodeStatus?.[node] : undefined
}

export const osdHosts = (osds: CephOsd[]): string[] => [...new Set(osds.map(o => o.host))].sort(natural)
export const osdDeviceClasses = (osds: CephOsd[]): string[] => [...new Set(osds.map(o => o.deviceClass).filter(Boolean))].sort(natural)

/** The OSDs in the order the table lists them, for the previous and next of the sheet. */
export const flattenGroups = (groups: OsdHostGroup[]): CephOsd[] => groups.flatMap(g => g.osds)

export interface ShownGroup {
  host: string
  /** Every OSD of the group that passed the filters (the size of the group line). */
  osds: CephOsd[]
  /** The rows drawn on this page: none for a folded group. */
  rows: CephOsd[]
  folded: boolean
}

export interface OsdPage {
  page: number
  pageCount: number
  /** Rows of the unfolded groups, all pages together. */
  rowCount: number
  shown: ShownGroup[]
}

/** One page of rows (20 by default) across the groups; a folded group keeps its line, on the page where it falls. */
export function paginateGroups(groups: OsdHostGroup[], folded: ReadonlySet<string>, page: number, size = OSD_PAGE_SIZE): OsdPage {
  const rowCount = groups.reduce((n, g) => n + (folded.has(g.host) ? 0 : g.osds.length), 0)
  const pageCount = Math.max(1, Math.ceil(rowCount / size))
  const current = Math.min(Math.max(0, page), pageCount - 1)
  const first = current * size
  const last = first + size
  const shown: ShownGroup[] = []
  let seen = 0

  for (const g of groups) {
    if (folded.has(g.host)) {
      // A folded line belongs to the page of the row that follows it (the last page at the end).
      if (Math.min(Math.floor(seen / size), pageCount - 1) === current) shown.push({ host: g.host, osds: g.osds, rows: [], folded: true })
      continue
    }

    const rows = g.osds.slice(Math.max(0, first - seen), Math.max(0, last - seen))

    if (rows.length > 0) shown.push({ host: g.host, osds: g.osds, rows, folded: false })
    seen += g.osds.length
  }

  return { page: current, pageCount, rowCount, shown }
}

/** The page that lists an OSD, 0 when it is not among the visible rows. */
export function pageOfOsd(groups: OsdHostGroup[], folded: ReadonlySet<string>, id: number, size = OSD_PAGE_SIZE): number {
  let seen = 0

  for (const g of groups) {
    if (folded.has(g.host)) continue

    const at = g.osds.findIndex(o => o.id === id)

    if (at >= 0) return Math.floor((seen + at) / size)
    seen += g.osds.length
  }

  return 0
}

/**
 * Pools that can place data on an OSD: the pool's CRUSH root holds the OSD and, when the rule
 * takes a device class (`default~ssd`), the OSD is of that class. A pool whose root is unknown
 * is listed, since it cannot be ruled out.
 */
export function poolsOnOsd(inv: Pick<CephInventory, 'pools' | 'crushTree' | 'crushRules'>, osd: Pick<CephOsd, 'id' | 'deviceClass'>): string[] {
  const holds = (node: { id: number; children?: unknown[] }): boolean =>
    node.id === osd.id || ((node.children as { id: number; children?: unknown[] }[] | undefined) ?? []).some(holds)
  const findNode = (nodes: { id: number; children?: unknown[] }[], id: number): { id: number; children?: unknown[] } | null => {
    for (const n of nodes) {
      if (n.id === id) return n
      const hit = findNode((n.children as { id: number; children?: unknown[] }[] | undefined) ?? [], id)

      if (hit) return hit
    }

    return null
  }

  return (inv.pools?.list ?? [])
    .filter(pool => {
      const rule = (inv.crushRules ?? []).find(r => r.id === pool.crushRule)
      const take = rule?.steps.find(s => s.op === 'take')
      const cls = take?.item_name?.includes('~') ? take.item_name.split('~')[1] : null

      if (cls && cls !== osd.deviceClass) return false

      const root = pool.crushRootId === null || pool.crushRootId === undefined ? null : findNode(inv.crushTree ?? [], pool.crushRootId)

      return root ? holds(root) : true
    })
    .map(p => p.name)
}
