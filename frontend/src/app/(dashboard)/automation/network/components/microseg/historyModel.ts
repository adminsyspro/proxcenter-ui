import type { MicrosegFlow, MicrosegRevision, MicrosegRun, MicrosegZone } from '@/lib/microseg/types'

/** What the History table lists: the revisions of the policy and the runs of the engine. */
export type HistoryKind = 'all' | 'revisions' | 'runs'

/** What a revision changed against the one before it (null for the first, or without the snapshots). */
export type RevisionDiff = { added: number; removed: number; changed: number }

export type HistoryRow =
  | { type: 'revision'; id: string; at: number; revision: MicrosegRevision; zones: number | null; flows: number | null; diff: RevisionDiff | null }
  | { type: 'run'; id: string; at: number; run: MicrosegRun }

/** The fields that make a flow what it is: two flows with the same id and these differ are a change. */
const flowShape = (f: MicrosegFlow) => [f.src_zone_id, f.src_cidr, f.dst_zone_id, f.dst_cidr, f.proto, f.dport].join('|')
const zoneShape = (z: MicrosegZone) => [z.name, z.state, z.enforcement, z.isolate_members ? 1 : 0].join('|')

/** The zones and flows a revision added, removed and changed against the previous one, by id. */
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

/**
 * The revisions and the runs in one list, the newest first (ties: revisions first, then by id), `kind` keeping one of
 * the two. Each revision carries its counts and its diff against the revision before it (the next older one read).
 */
export function historyRows(revisions: readonly MicrosegRevision[], runs: readonly MicrosegRun[], kind: HistoryKind = 'all'): HistoryRow[] {
  const byVersion = [...revisions].sort((a, b) => b.version - a.version)
  const revRows: HistoryRow[] = byVersion.map((revision, i) => ({
    type: 'revision',
    id: revision.id,
    at: time(revision.created_at),
    revision,
    zones: revision.snapshot ? (revision.snapshot.zones ?? []).length : null,
    flows: revision.snapshot ? (revision.snapshot.flows ?? []).length : null,
    diff: revisionDiff(revision, byVersion[i + 1]),
  }))
  const runRows: HistoryRow[] = runs.map(run => ({ type: 'run', id: run.id, at: time(run.started_at), run }))
  const rows = [...(kind === 'runs' ? [] : revRows), ...(kind === 'revisions' ? [] : runRows)]
  return rows.sort((a, b) => b.at - a.at || tie(a, b))
}

/** The runs the engine starts by itself; the others (plan, apply, remove, restore) an administrator starts. */
export const ENGINE_KINDS = new Set(['light', 'ips', 'full', 'log', 'targeted'])
