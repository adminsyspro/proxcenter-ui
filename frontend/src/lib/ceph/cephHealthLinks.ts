import type { CephHealthIssue, CockpitItem, CockpitTab, OsdFilter } from './types'

export type HealthTarget = {
  tab: CockpitTab
  filter?: OsdFilter
  item?: CockpitItem
  focus?: 'flags'
}

const messages = (issue: CephHealthIssue): string[] => (issue.detail ?? []).map(d => d.message ?? '')

/** OSD distincts cites sous la forme `osd.N` dans le detail. */
export function osdsCited(issue: CephHealthIssue): number[] {
  const ids = new Set<number>()

  for (const m of messages(issue)) {
    for (const match of m.matchAll(/\bosd\.(\d+)\b/g)) ids.add(Number(match[1]))
  }

  return [...ids]
}

/**
 * OSD a deep-scrubber pour un PG endommage : le premier `osd.N` cite, sinon le
 * premier OSD de la liste `acting [a,b,c]` (le primaire du PG).
 */
export function osdToScrub(issue: CephHealthIssue): number | null {
  const cited = osdsCited(issue)

  if (cited.length > 0) return cited[0]

  for (const m of messages(issue)) {
    const acting = /\bacting\s*\[(\d+)/.exec(m)

    if (acting) return Number(acting[1])
  }

  return null
}

function poolNamed(issue: CephHealthIssue): string | null {
  for (const m of messages(issue)) {
    const match = /\bpool '([^']+)'/.exec(m)

    if (match) return match[1]
  }

  return null
}

/** Ordre de la table : sert aussi a departager les checks de meme severite. */
export const HEALTH_CODE_ORDER: readonly string[] = [
  'OSD_DOWN',
  'OSD_HOST_DOWN',
  'OSD_NEARFULL',
  'OSD_BACKFILLFULL',
  'OSD_FULL',
  'OSD_SCRUB_ERRORS',
  'PG_DAMAGED',
  'POOL_NEAR_FULL',
  'POOL_FULL',
  'POOL_TOO_FEW_PGS',
  'POOL_TOO_MANY_PGS',
  'MON_DOWN',
  'MON_CLOCK_SKEW',
  'MGR_DOWN',
  'MDS_*',
  'FS_*',
  'RECENT_CRASH',
  'OSDMAP_FLAGS',
  'OSD_FLAGS',
  'PG_DEGRADED',
  'PG_AVAILABILITY',
  'PG_NOT_SCRUBBED',
  'PG_NOT_DEEP_SCRUBBED',
  'OBJECT_MISPLACED',
]

/** Rang d'un code dans la table (les familles `MDS_*` et `FS_*` partagent leur rang), ou Infinity. */
export function healthCodeRank(code: string): number {
  const family = code.startsWith('MDS_') ? 'MDS_*' : code.startsWith('FS_') ? 'FS_*' : code
  const i = HEALTH_CODE_ORDER.indexOf(family)

  return i === -1 ? Number.POSITIVE_INFINITY : i
}

/** HEALTH_ERR, then HEALTH_WARN, then anything else. */
export function healthSeverityRank(severity: string): number {
  if (severity === 'HEALTH_ERR') return 0

  return severity === 'HEALTH_WARN' ? 1 : 2
}

/**
 * Ordre total des checks : severite, rang de la table, puis code (ordre ASCII). Les rangs sont compares
 * sans soustraction (Infinity - Infinity = NaN rendait l'ordre d'entree, que Ceph ne garantit
 * pas : la phrase d'etat changeait d'un sondage a l'autre entre deux checks inconnus).
 */
export function compareHealthChecks(a: CephHealthIssue, b: CephHealthIssue): number {
  const bySeverity = healthSeverityRank(a.severity) - healthSeverityRank(b.severity)

  if (bySeverity !== 0) return bySeverity

  const ra = healthCodeRank(a.name)
  const rb = healthCodeRank(b.name)

  if (ra !== rb) return ra < rb ? -1 : 1

  // Codes are ASCII: a plain code-unit order, the same whatever the browser's language.
  if (a.name === b.name) return 0

  return a.name < b.name ? -1 : 1
}

export function healthTarget(issue: CephHealthIssue): HealthTarget | null {
  const code = issue.name

  switch (code) {
    case 'OSD_DOWN':
    case 'OSD_HOST_DOWN':
      return { tab: 'osd', filter: 'down' }
    case 'OSD_NEARFULL':
    case 'OSD_BACKFILLFULL':
    case 'OSD_FULL': {
      const cited = osdsCited(issue)

      return cited.length === 1
        ? { tab: 'osd', filter: 'problem', item: { kind: 'osd', id: cited[0] } }
        : { tab: 'osd', filter: 'problem' }
    }
    case 'OSD_SCRUB_ERRORS':
    case 'PG_DAMAGED': {
      const id = osdToScrub(issue)

      return id === null ? { tab: 'osd', filter: 'problem' } : { tab: 'osd', item: { kind: 'osd', id } }
    }
    case 'POOL_NEAR_FULL':
    case 'POOL_FULL':
    case 'POOL_TOO_FEW_PGS':
    case 'POOL_TOO_MANY_PGS': {
      const name = poolNamed(issue)

      return name === null ? { tab: 'pools' } : { tab: 'pools', item: { kind: 'pool', name } }
    }
    case 'MON_DOWN':
    case 'MON_CLOCK_SKEW':
    case 'MGR_DOWN':
    case 'RECENT_CRASH':
      return { tab: 'services' }
    case 'OSDMAP_FLAGS':
    case 'OSD_FLAGS':
      return { tab: 'overview', focus: 'flags' }
    case 'PG_DEGRADED':
    case 'PG_AVAILABILITY':
    case 'PG_NOT_SCRUBBED':
    case 'PG_NOT_DEEP_SCRUBBED':
    case 'OBJECT_MISPLACED':
      return { tab: 'perf' }
    default:
      return code.startsWith('MDS_') || code.startsWith('FS_') ? { tab: 'services' } : null
  }
}
