import type { MicrosegRun } from '@/lib/microseg/types'

import { ENGINE_KINDS } from './historyModel'

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

export type RunSummaryPart = { key: string; count: number; total?: number } | { key: string; text: string }

/**
 * The figures of an engine run said on its History row, the list carrying the result of a loop's
 * run: what it read, then what is worth a look (drifts, guests not read, corrections). The usual
 * zeroes stay out, except a light check that corrected nothing ("no correction"). Empty for a
 * plan, an apply or a removal (their result is read in the drawer) and when the list has no result.
 */
export function runSummaryParts(run: MicrosegRun): RunSummaryPart[] {
  const r = run.result
  if (!r || !ENGINE_KINDS.has(run.kind)) return []
  const parts: RunSummaryPart[] = []
  const add = (key: string, n: number | undefined, always = false) => { if (always || positive(n)) parts.push({ key, count: n ?? 0 }) }
  switch (run.kind) {
    case 'log':
      add('events', r.events, true)
      add('suggestions', r.suggestions, true)
      add('droppedForeignDst', r.dropped_foreign_dst)
      if (positive(r.log_truncated?.length)) parts.push({ key: 'logTruncated', text: r.log_truncated!.join(', ') })
      break
    case 'ips':
      parts.push({ key: 'withIps', count: r.with_ips ?? 0, total: r.members ?? 0 })
      break
    case 'full':
    case 'targeted':
      add('guests', r.guests, true)
      if (run.kind === 'full') add('drifts', r.drifts, true)
      add('unread', r.unread?.length)
      add('steps', r.steps)
      break
    default:
      if (positive(r.steps)) add('steps', r.steps)
      else parts.push({ key: 'noCorrection', count: 0 })
  }
  return parts
}

/**
 * True when a run has more than its row says: a plan, an apply or a removal (their steps), an
 * engine run that carried out steps or met read errors, or a run the list gave without a result.
 */
export function runHasDetails(run: MicrosegRun): boolean {
  if (!ENGINE_KINDS.has(run.kind) || !run.result) return true
  return hasStepOutcome(run) || positive(run.result.errors?.length) || positive(run.result.ambiguous?.length)
}
