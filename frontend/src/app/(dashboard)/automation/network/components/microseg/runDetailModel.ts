import type { MicrosegRun } from '@/lib/microseg/types'

/** The kinds of run the engine schedules on its own: each reads something else, so each has its own lines. */
export const ENGINE_RUN_KINDS = new Set(['light', 'ips', 'full', 'log', 'targeted'])

export type RunDetailRow =
  | { key: string; count: number; warn?: boolean }
  | { key: string; text: string }
  | { key: string; label: string }

const positive = (n: number | undefined) => (n ?? 0) > 0

/**
 * The lines of a run's detail, one per figure, in reading order. An engine run shows what its
 * loop counts (log lines and suggestions for a log read, members with an IP for an IP read,
 * guests read and drifts for a full check); a plan, an apply or a removal shows its guests,
 * members and steps (its outcome is drawn below by ApplyResult). A figure that is only worth
 * telling when it is not zero (left-out events, guests not read) is left out at zero.
 */
export function runDetailRows(run: MicrosegRun): RunDetailRow[] {
  const r = run.result
  if (!r) return []
  const rows: RunDetailRow[] = []
  const add = (row: RunDetailRow) => rows.push(row)
  const unread = () => { if (positive(r.unread?.length)) add({ key: 'unread', count: r.unread!.length, warn: true }) }
  const ambiguous = () => { if (positive(r.ambiguous?.length)) add({ key: 'ambiguous', count: r.ambiguous!.length, warn: true }) }

  switch (run.kind) {
    case 'log':
      add({ key: 'events', count: r.events ?? 0 })
      add({ key: 'suggestions', count: r.suggestions ?? 0 })
      if (positive(r.dropped_foreign_dst)) add({ key: 'droppedForeignDst', count: r.dropped_foreign_dst! })
      if (positive(r.log_truncated?.length)) add({ key: 'logTruncated', text: r.log_truncated!.join(', ') })
      break
    case 'ips': {
      const withIps = r.with_ips ?? 0
      add({ key: 'members', count: r.members ?? 0 })
      add({ key: 'withIps', count: withIps })
      if ((r.members ?? 0) > withIps) add({ key: 'withoutIp', count: (r.members ?? 0) - withIps, warn: true })
      break
    }
    case 'full':
      add({ key: 'trigger', label: r.trigger === 'check' ? 'triggerCheck' : 'triggerSchedule' })
      add({ key: 'guests', count: r.guests ?? 0 })
      add({ key: 'members', count: r.members ?? 0 })
      add({ key: 'drifts', count: r.drifts ?? 0, warn: positive(r.drifts) })
      unread()
      ambiguous()
      add({ key: 'steps', count: r.steps ?? 0 })
      break
    case 'light':
      add({ key: 'steps', count: r.steps ?? 0 })
      break
    case 'targeted':
      add({ key: 'members', count: r.members ?? 0 })
      add({ key: 'guests', count: r.guests ?? 0 })
      unread()
      add({ key: 'steps', count: r.steps ?? 0 })
      break
    default:
      add({ key: 'guests', count: r.guests ?? 0 })
      add({ key: 'members', count: r.members ?? 0 })
      add({ key: 'steps', count: r.steps ?? 0 })
  }
  return rows
}

/** True when the run carried out steps: their outcome is then drawn as an apply's. */
export function hasStepOutcome(run: MicrosegRun): boolean {
  const r = run.result
  return !!r && (r.done?.length ?? 0) + (r.failed?.length ?? 0) + (r.not_run?.length ?? 0) > 0
}
