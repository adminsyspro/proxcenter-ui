import type { MicrosegException, MicrosegFlow, MicrosegRevision, MicrosegRun, MicrosegZone } from '@/lib/microseg/types'

/** What the History table lists: the revisions of the policy and the runs of the engine. */
export type HistoryKind = 'all' | 'revisions' | 'runs'

/** What a revision changed against the one before it (null for the first, or without the snapshots). */
export type RevisionDiff = { added: number; removed: number; changed: number }

export type HistoryRow =
  | {
    type: 'revision'; id: string; at: number; revision: MicrosegRevision; zones: number | null; flows: number | null; exceptions: number; diff: RevisionDiff | null
    /** On a shared policy: the application runs of every cluster that recorded the revision (absent on one cluster). */
    runs?: MicrosegRun[]
  }
  | { type: 'run'; id: string; at: number; run: MicrosegRun }

/** The fields that make a flow what it is: two flows with the same id and these differ are a change. */
const flowShape = (f: MicrosegFlow) => [f.src_zone_id, f.src_cidr, f.dst_zone_id, f.dst_cidr, f.proto, f.dport].join('|')
const zoneShape = (z: MicrosegZone) => [z.name, z.state, z.enforcement, z.isolate_members ? 1 : 0, z.egress_state ?? 'off', z.egress_mode ?? 'local'].join('|')

/**
 * What an exception allows: its sources, its destinations and its services, each list in its order (the orchestrator
 * compares them in order, the recorded names of the guests included).
 */
const exceptionShape = (e: MicrosegException) => [
  e.sources.map(g => `${g.type}/${g.vmid}/${g.name}`).join(','),
  e.destinations.map(g => `${g.type}/${g.vmid}/${g.name}`).join(','),
  e.services.map(s => `${s.proto}/${s.dport}`).join(','),
].join('|')

/**
 * The zones, flows and exceptions a revision added, removed and changed against the previous one, by id. A revision
 * taken before the exceptions existed has none.
 */
export function revisionDiff(current: MicrosegRevision, previous: MicrosegRevision | undefined): RevisionDiff | null {
  const now = current.snapshot
  const before = previous?.snapshot
  if (!now || !before) return null
  let added = 0
  let removed = 0
  let changed = 0
  const count = <T extends { id: string }>(after: T[], prior: T[], shape: (x: T) => string) => {
    const old = new Map(prior.map(x => [x.id, x]))
    const kept = new Set(after.map(x => x.id))
    for (const x of after) {
      const was = old.get(x.id)
      if (!was) added++
      else if (shape(was) !== shape(x)) changed++
    }
    for (const x of prior) if (!kept.has(x.id)) removed++
  }
  count(now.zones ?? [], before.zones ?? [], zoneShape)
  count(now.flows ?? [], before.flows ?? [], flowShape)
  count(now.exceptions ?? [], before.exceptions ?? [], exceptionShape)
  return { added, removed, changed }
}

/** Same time: the revision before the run, then by id. */
function tie(a: HistoryRow, b: HistoryRow): number {
  if (a.type !== b.type) return a.type === 'revision' ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

const time = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/** The runs that record a revision when they end well: an application, a restore. */
const RECORDING_KINDS = new Set(['apply', 'restore'])

/**
 * The revision a run of an application or a restore recorded, as GET /runs names it (`revision_id`), when that revision
 * is among those listed; null for a run still going, one that recorded none (failed before), or any other kind.
 */
function revisionOf(run: MicrosegRun, listed: ReadonlySet<string>): string | null {
  if (!RECORDING_KINDS.has(run.kind)) return null
  const id = run.revision_id
  return typeof id === 'string' && listed.has(id) ? id : null
}

/**
 * The revisions and the runs in one list, the newest first (ties: revisions first, then by id), `kind` keeping one of
 * the two. Each revision carries its counts and its diff against the revision before it (the next older one read).
 * `grouped` (a shared policy): a revision is one line, and the application runs of every cluster that recorded it go
 * under it instead of on lines of their own (not under the Runs filter, which lists every run).
 */
export function historyRows(revisions: readonly MicrosegRevision[], runs: readonly MicrosegRun[], kind: HistoryKind = 'all', options: { grouped?: boolean } = {}): HistoryRow[] {
  const byVersion = [...revisions].sort((a, b) => b.version - a.version)
  const revRows: HistoryRow[] = byVersion.map((revision, i) => ({
    type: 'revision',
    id: revision.id,
    at: time(revision.created_at),
    revision,
    zones: revision.snapshot ? (revision.snapshot.zones ?? []).length : null,
    flows: revision.snapshot ? (revision.snapshot.flows ?? []).length : null,
    // A revision taken before the exceptions existed has no list: it held none.
    exceptions: (revision.snapshot?.exceptions ?? []).length,
    diff: revisionDiff(revision, byVersion[i + 1]),
  }))
  let listed = runs
  if (options.grouped && kind !== 'runs') {
    const under = new Map<string, MicrosegRun[]>()
    const revIds = new Set(revRows.map(r => r.id))
    listed = runs.filter(run => {
      const rev = revisionOf(run, revIds)
      if (!rev) return true
      under.set(rev, [...(under.get(rev) ?? []), run])
      return false
    })
    for (const row of revRows) {
      if (row.type === 'revision') row.runs = (under.get(row.id) ?? []).sort((a, b) => time(a.started_at) - time(b.started_at) || a.connection_id.localeCompare(b.connection_id))
    }
  }
  const runRows: HistoryRow[] = listed.map(run => ({ type: 'run', id: run.id, at: time(run.started_at), run }))
  const rows = [...(kind === 'runs' ? [] : revRows), ...(kind === 'revisions' ? [] : runRows)]
  return rows.sort((a, b) => b.at - a.at || tie(a, b))
}

/** The runs the engine starts by itself; the others (plan, apply, remove, restore) an administrator starts. */
export const ENGINE_KINDS = new Set(['light', 'ips', 'full', 'log', 'targeted'])
