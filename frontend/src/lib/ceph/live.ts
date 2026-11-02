import type { CephHealthIssue } from './types'

export interface CephLive {
  health: { status: string; checks: CephHealthIssue[] }
  pg: { total: number; clean: number; byState: { state: string; count: number }[] }
  osd: { total: number; up: number; in: number }
  io: { readOps: number; writeOps: number; readBytes: number; writeBytes: number }
  recovery: { bytesPerSec: number; objectsPerSec: number; degraded: number; misplaced: number }
  raw: { used: number; total: number }
  at: number
}

type Rec = Record<string, unknown>

const rec = (v: unknown): Rec => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {})
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/**
 * Un etat de PG est propre si ses jetons (separes par `+`) contiennent `active` et `clean` :
 * un cluster sain porte aussi active+clean+snaptrim ou active+clean+scrubbing+deep.
 * Meme regle que le collecteur du backend (internal/cephmetrics, pgStateClean).
 */
export function pgStateClean(state: string): boolean {
  const tokens = state.split('+')

  return tokens.includes('active') && tokens.includes('clean')
}

/**
 * Decode la sortie de `/cluster/ceph/status` (= `ceph status --format json`).
 * L'osdmap est a plat (Ceph recent) ou imbrique (`osdmap.osdmap`, anciennes versions).
 * Tout champ absent vaut 0 (ou chaine/liste vide).
 */
export function liveFromCephStatus(status: unknown, at: number): CephLive {
  const s = rec(status)
  const health = rec(s.health)
  const pgmap = rec(s.pgmap)
  const outer = rec(s.osdmap)
  const osdmap = 'osdmap' in outer && typeof outer.osdmap === 'object' && outer.osdmap !== null ? rec(outer.osdmap) : outer

  const checks: CephHealthIssue[] = Object.entries(rec(health.checks)).filter(([, raw]) => rec(raw).muted !== true).map(([name, raw]) => {
    const c = rec(raw)
    const summary = rec(c.summary)

    return {
      name,
      severity: str(c.severity) || 'UNKNOWN',
      summary: str(summary.message) || name,
      detail: (Array.isArray(c.detail) ? c.detail : []).map(d => ({ message: str(rec(d).message) })),
    }
  })

  const byState = (Array.isArray(pgmap.pgs_by_state) ? pgmap.pgs_by_state : []).map(p => ({
    state: str(rec(p).state_name),
    count: num(rec(p).count),
  }))

  return {
    health: { status: str(health.status), checks },
    pg: {
      total: num(pgmap.num_pgs),
      clean: byState.filter(p => pgStateClean(p.state)).reduce((n, p) => n + p.count, 0),
      byState,
    },
    osd: { total: num(osdmap.num_osds), up: num(osdmap.num_up_osds), in: num(osdmap.num_in_osds) },
    io: {
      readOps: num(pgmap.read_op_per_sec),
      writeOps: num(pgmap.write_op_per_sec),
      readBytes: num(pgmap.read_bytes_sec),
      writeBytes: num(pgmap.write_bytes_sec),
    },
    recovery: {
      bytesPerSec: num(pgmap.recovering_bytes_per_sec),
      objectsPerSec: num(pgmap.recovering_objects_per_sec),
      degraded: num(pgmap.degraded_objects),
      misplaced: num(pgmap.misplaced_objects),
    },
    raw: { used: num(pgmap.bytes_used), total: num(pgmap.bytes_total) },
    at,
  }
}

/**
 * Empreinte de l'etat "structurel" : statut, codes de checks tries, OSD total/up/in,
 * nombre de PG et presence de PG non propres (booleen : leur nombre varie a chaque sondage pendant une reconstruction et
 * declencherait un rechargement d'inventaire a chaque fois). Les debits (io, recovery) et `at` n'y entrent pas :
 * elle sert a detecter un changement d'etat, pas un changement de mesure.
 */
export function liveFingerprint(l: CephLive): string {
  const codes = l.health.checks.map(c => c.name).sort((a, b) => a.localeCompare(b))

  return [l.health.status, codes.join(','), `${l.osd.total}/${l.osd.up}/${l.osd.in}`, l.pg.total, l.pg.total - l.pg.clean > 0].join('|')
}
