import type { CephLive } from './live'
import type { CephHealthIssue, CephInventory } from './types'

/** Seuils par defaut de Ceph (mon_data_avail_warn / mon_data_avail_crit), en pourcentage d'espace libre. */
export const MON_DATA_AVAIL_WARN_PCT = 30
export const MON_DATA_AVAIL_CRIT_PCT = 5

type MonDisk = NonNullable<CephInventory['monDisk']>

const MON_DISK_CODES = new Set(['MON_DISK_LOW', 'MON_DISK_CRIT'])

interface MonReading {
  mon: string
  /** Whole percent of free space; null when only Ceph's own line is known and it carries no number. */
  pct: number | null
  /** Used when pct is null: the code Ceph raised the mon under, and its line. */
  code?: string
  message?: string
}

/**
 * Ceph n'expose dans sa carte de sante agregee qu'un moniteur a la fois pour MON_DISK_LOW / MON_DISK_CRIT : le contenu tourne
 * d'un sondage a l'autre. On les retire donc et on les recalcule depuis l'espace libre reel de chaque mon (rootfs du nœud),
 * avec les seuils de Ceph et son format de message.
 */
export function monDiskChecks(monDisk: MonDisk): CephHealthIssue[] {
  // Ceph compare un pourcentage entier (division entiere) aux seuils.
  return checksOf(monDisk.map(m => ({ mon: m.mon, pct: Math.floor(m.availPct) })))
}

function checksOf(readings: MonReading[]): CephHealthIssue[] {
  // The monitor list comes in any order: sorted by name, so the wording never changes between two reads.
  const sorted = [...readings].sort((a, b) => a.mon.localeCompare(b.mon, undefined, { numeric: true }))
  const codeOf = (r: MonReading) => (r.pct === null ? r.code : r.pct <= MON_DATA_AVAIL_CRIT_PCT ? 'MON_DISK_CRIT' : r.pct <= MON_DATA_AVAIL_WARN_PCT ? 'MON_DISK_LOW' : undefined)
  const checks: CephHealthIssue[] = []

  for (const [name, severity, adj] of [['MON_DISK_CRIT', 'HEALTH_ERR', 'very low'], ['MON_DISK_LOW', 'HEALTH_WARN', 'low']] as const) {
    const mons = sorted.filter(r => codeOf(r) === name)

    if (mons.length === 0) continue
    const names = mons.map(m => m.mon)

    checks.push({
      name,
      severity,
      summary: mons.length === 1 ? `mon ${names[0]} is ${adj} on available space` : `mons ${names.join(',')} are ${adj} on available space`,
      detail: mons.map(m => ({ message: m.pct === null ? (m.message ?? `mon.${m.mon}`) : `mon.${m.mon} has ${m.pct}% avail` })),
    })
  }

  return checks
}

/** The mons Ceph cites in its own MON_DISK_* checks, with the free space it printed when there is one. */
function citedByCeph(checks: CephHealthIssue[]): MonReading[] {
  return checks.filter(c => MON_DISK_CODES.has(c.name)).flatMap(c => c.detail.flatMap(d => {
    const m = /^mon\.(\S+) has (\d+)% avail/.exec(d.message)

    return m ? [{ mon: m[1], pct: Number(m[2]), code: c.name, message: d.message }] : []
  }))
}

/**
 * Le Live tel que le cockpit l'affiche : checks MON_DISK_* de Ceph remplaces par ceux de `monDisk`. Sans mesure (`undefined` ou liste
 * vide : inventaire pas encore revenu, ou aucun nœud lisible) les checks de Ceph restent tels quels : pas de trou au premier rendu.
 */
export function withMonDisk(live: CephLive, monDisk: CephInventory['monDisk']): CephLive {
  if (!monDisk || monDisk.length === 0) return live

  return applyMonDisk(live, monDisk)
}

/** Meme chose sans mesure : les MON_DISK_* retires. Sert a l'empreinte d'inventaire, qui ne doit pas bouger quand Ceph en cite un autre. */
export function withoutMonDisk(live: CephLive): CephLive {
  return applyMonDisk(live, [])
}

const RANK: Record<string, number> = { HEALTH_OK: 0, HEALTH_WARN: 1, HEALTH_ERR: 2 }
const rankOf = (status: string): number => RANK[status] ?? -1
const worstOf = (statuses: string[]): string => statuses.reduce((w, s) => (rankOf(s) > rankOf(w) ? s : w), 'HEALTH_OK')

function applyMonDisk(live: CephLive, monDisk: MonDisk): CephLive {
  const raw = live.health.checks
  const others = raw.filter(c => !MON_DISK_CODES.has(c.name))
  const rawMonDisk = raw.filter(c => MON_DISK_CODES.has(c.name))
  const measured = new Set(monDisk.map(m => m.mon))
  // A mon Ceph cites but that could not be measured keeps Ceph's own line, instead of vanishing.
  const unmeasured = monDisk.length === 0 ? [] : citedByCeph(raw).filter(r => !measured.has(r.mon))
  const monChecks = checksOf([...monDisk.map(m => ({ mon: m.mon, pct: Math.floor(m.availPct) })), ...unmeasured])
  const checks = [...others, ...monChecks]
  const ceph = live.health.status

  if (rankOf(ceph) < 0) return { ...live, health: { status: ceph, checks } }

  // Ceph's own state, unless only its MON_DISK_* justified it (no other check has that severity): then the worst of the others.
  const onlyMonDisk = rankOf(ceph) > 0
    && rawMonDisk.some(c => c.severity === ceph)
    && !others.some(c => c.severity === ceph)
  const corrected = onlyMonDisk ? worstOf(others.map(c => c.severity)) : ceph

  return { ...live, health: { status: worstOf([corrected, ...monChecks.map(c => c.severity)]), checks } }
}
