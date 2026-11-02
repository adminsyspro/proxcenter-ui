import { isProblemOsd, type OsdContext } from './osdTable'
import { compareHealthChecks, osdToScrub, osdsCited } from './cephHealthLinks'
import type { CephHealthIssue, CephInventory, CephOsd } from './types'

/*
   Pure model of the overview's host map: OSDs grouped by host with the services
   each host runs, one cell per OSD (fill, down, out, flag), and the tone of a fill
   on the sequential scale. Detailed cards up to 4 OSDs per host, a dense grid above.
*/

export type HostMapMode = 'cards' | 'dense'

/** Above this many OSDs on one host, the map switches to the dense grid. */
export const CARDS_MAX_OSDS_PER_HOST = 4

/** Fill below which a dense cell stays in the lightest shade. */
export const DENSE_MID_RATIO = 0.7

export type FillTone = 'low' | 'mid' | 'nearfull' | 'full'

export interface Ratios {
  nearfull: number
  full: number
}

/** `'dense'` as soon as one host carries more than 4 OSDs. */
export function hostMapMode(hosts: { osds: unknown[] }[]): HostMapMode {
  return hosts.some(h => h.osds.length > CARDS_MAX_OSDS_PER_HOST) ? 'dense' : 'cards'
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0)

/** One OSD as a cell of the map. `usedPct` is a percentage (0 to 100), as Ceph reports it for an OSD. */
export function osdCell(
  osd: Pick<CephOsd, 'usedPct' | 'up' | 'in'>,
  flags: readonly string[] = [],
): { fillRatio: number; down: boolean; out: boolean; flagged: boolean } {
  return {
    fillRatio: clamp01(osd.usedPct / 100),
    down: !osd.up,
    out: !osd.in,
    flagged: flags.length > 0,
  }
}

/** Where a fill falls: light below 70 %, darker up to nearfull, then the warning and error states. */
export function fillTone(ratio: number, ratios: Ratios): FillTone {
  if (ratio >= ratios.full) return 'full'
  if (ratio >= ratios.nearfull) return 'nearfull'

  return ratio >= DENSE_MID_RATIO ? 'mid' : 'low'
}

export interface HostGroup {
  name: string
  osds: CephOsd[]
  /** The monitor of this host, if it runs one. */
  mon: { leader: boolean; inQuorum: boolean } | null
  mgr: 'active' | 'standby' | null
  /** MDS daemons on this host. */
  mds: number
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** OSDs grouped by host, hosts and OSDs in natural order, with the services each host runs. */
export function hostGroups(inv: Pick<CephInventory, 'osds' | 'monitors' | 'managers' | 'mds'>): HostGroup[] {
  const byHost = new Map<string, CephOsd[]>()

  // The ids are numbers already: useCephInventory reads them once (R20).
  for (const o of inv.osds?.list ?? []) byHost.set(o.host, [...(byHost.get(o.host) ?? []), o])

  const mons = inv.monitors?.list ?? []
  const mgrs = inv.managers ?? { active: null, standbys: [] }
  const mds = inv.mds?.list ?? []

  return [...byHost.entries()]
    .sort(([a], [b]) => natural(a, b))
    .map(([name, osds]) => {
      const mon = mons.find(m => m.host === name || m.name === name)

      return {
        name,
        osds: [...osds].sort((a, b) => a.id - b.id),
        mon: mon ? { leader: Boolean(mon.leader), inQuorum: Boolean(mon.inQuorum) } : null,
        mgr: mgrs.active?.host === name ? 'active' : mgrs.standbys.some(s => s.host === name) ? 'standby' : null,
        mds: mds.filter(m => m.host === name).length,
      }
    })
}

export interface HostSummary {
  /** Mean fill of the up OSDs (a down OSD reports no fill). */
  avg: number
  max: number
  down: number
  out: number
  tone: 'down' | 'full' | 'nearfull' | 'ok'
}

/** What the end of a dense row says: a down OSD first, then the fullest one, else the mean fill. */
export function hostSummary(osds: Pick<CephOsd, 'usedPct' | 'up' | 'in'>[], ratios: Ratios): HostSummary {
  const up = osds.filter(o => o.up).map(o => clamp01(o.usedPct / 100))
  const avg = up.length > 0 ? Math.round((up.reduce((s, v) => s + v, 0) / up.length) * 1000) / 1000 : 0
  const max = up.length > 0 ? Math.max(...up) : 0
  const down = osds.filter(o => !o.up).length
  const out = osds.filter(o => !o.in).length
  const tone = down > 0 ? 'down' : max >= ratios.full ? 'full' : max >= ratios.nearfull ? 'nearfull' : 'ok'

  return { avg, max, down, out, tone }
}

export interface OsdIssue {
  code: string
  severity: 'error' | 'warning'
}

const SCRUB_CODES = new Set(['OSD_SCRUB_ERRORS', 'PG_DAMAGED'])

// Checks about the disk or the daemon of an OSD. AUTH_* checks also write "osd.0" (as
// an auth entity) and OSD_FLAGS is shown as a flag, so neither marks the OSD.
const isOsdCheck = (code: string) =>
  (code.startsWith('OSD_') && code !== 'OSD_FLAGS') || code.startsWith('BLUESTORE_') || code === 'SLOW_OPS' || code.startsWith('DEVICE_HEALTH')

/** The health checks that point at each OSD, worst first. */
export function osdIssues(checks: CephHealthIssue[]): Map<number, OsdIssue[]> {
  const out = new Map<number, OsdIssue[]>()

  for (const check of [...checks].sort(compareHealthChecks)) {
    if (!isOsdCheck(check.name) && !SCRUB_CODES.has(check.name)) continue

    const scrub = SCRUB_CODES.has(check.name) ? osdToScrub(check) : null
    const ids = scrub !== null ? [scrub] : osdsCited(check)
    const issue: OsdIssue = { code: check.name, severity: check.severity === 'HEALTH_ERR' ? 'error' : 'warning' }

    for (const id of ids) out.set(id, [...(out.get(id) ?? []), issue])
  }

  return out
}

/** More hosts than this and the map offers to show only the hosts with a problem. */
export const DENSE_PROBLEM_FILTER_MIN_HOSTS = 40

/** Hosts with an OSD down, out, past nearfull or cited by a health check: the definition of the OSD tab's "problem" filter. */
export function problemHosts(hosts: HostGroup[], ctx: OsdContext): HostGroup[] {
  return hosts.filter(h => h.osds.some(o => isProblemOsd(o, ctx)))
}

// Pixel widths of a dense row, from what it holds.
const DENSE_CELL = 14
const DENSE_CELL_GAP = 3
const DENSE_ROW_GAP = 12
const DENSE_GLYPH = 30
const DENSE_CHAR = 7.5
const DENSE_COUNT = 62
const DENSE_TAG_PAD = 18
const DENSE_TAG_GAP = 6
const DENSE_TAG_CHAR = 6.8
/** A flag tag shows its name after a flag icon and a gap: about three characters wide. */
const DENSE_FLAG_PREFIX_CHARS = 3
const DENSE_SUMMARY = 72
const DENSE_NAME_MAX = 260
/** Squares on one line of a row; a host with more wraps them on a second line instead of widening every row. */
export const DENSE_MAX_CELLS_PER_LINE = 12

interface DenseHost { name: string; mon?: { leader: boolean } | null; mgr?: 'active' | 'standby' | null; mds?: number }

/** Width of the role tags a host really carries (mon, active mgr or mgr, mds, flags), with their gaps. */
export function denseTagsWidth(host: DenseHost, flags: readonly string[] = []): number {
  const labels = [
    host.mon ? 'mon'.length + (host.mon.leader ? 2 : 0) : 0,
    host.mgr ? (host.mgr === 'active' ? 'active mgr' : 'mgr').length : 0,
    host.mds && host.mds > 0 ? 'mds'.length : 0,
    ...flags.map(f => f.length + DENSE_FLAG_PREFIX_CHARS),
  ].filter(n => n > 0)

  return labels.reduce((w, n) => w + n * DENSE_TAG_CHAR + DENSE_TAG_PAD + DENSE_TAG_GAP, 0)
}

/** Width of the name block of a dense row: glyph, longest host name (capped), OSD count and the widest set of role tags, so nothing is cut while the room exists. */
export function denseNameWidth(hosts: DenseHost[], flagsOf: (name: string) => readonly string[] = () => []): number {
  const longest = hosts.reduce((m, h) => Math.max(m, h.name.length), 0)
  const tags = hosts.reduce((m, h) => Math.max(m, denseTagsWidth(h, flagsOf(h.name))), 0)

  return DENSE_GLYPH + Math.min(DENSE_NAME_MAX, Math.ceil(longest * DENSE_CHAR)) + DENSE_COUNT + tags
}

/** Minimum width of a dense row from its content: name block, N squares of 14 px with their gaps, summary and the gaps between the three. */
export function denseRowMinWidth(hosts: (DenseHost & { osds: unknown[] })[], flagsOf?: (name: string) => readonly string[]): number {
  const cells = Math.min(DENSE_MAX_CELLS_PER_LINE, hosts.reduce((m, h) => Math.max(m, h.osds.length), 1))
  const squares = cells * DENSE_CELL + (cells - 1) * DENSE_CELL_GAP

  return denseNameWidth(hosts, flagsOf) + squares + DENSE_SUMMARY + 2 * DENSE_ROW_GAP
}
