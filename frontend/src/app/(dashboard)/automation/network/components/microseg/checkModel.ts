// What the "Check now" window reads from the runs of the engine. A manual check is one pass of the engine: the IP
// collection (an `ips` run), the full run (`full`, its result carries trigger "check") and, when a zone is active,
// the log read (`log`, recorded only when it read something). The runs list omits every result: the figures come
// from GET /runs/{id}. The numbers of a result are omitted by the orchestrator when they are 0.

import type { GuestRef, MicrosegRun, StepRef } from '@/lib/microseg/types'

/** How many runs the window lists to find the runs of its check (a pass records three at most). */
export const CHECK_RUNS_LIMIT = 10

/** The runs of the same pass start within seconds of each other; this bounds the search around the full run. */
export const PASS_WINDOW_MS = 10 * 60_000

/**
 * Which full run can be the one of the check. After a 202, the first full run started at or after `since` (the
 * request time, from the orchestrator's clock like the start times). After a 409 the request time is unknown: the
 * check has not started, so every full run listed at that moment is excluded and the next one is the check.
 */
export type CheckCutoff = { since: string | null; exclude: ReadonlySet<string> }

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN)

/** The oldest full run of the list that can be the check's, or null. The list is newest first. */
export function findCheckCandidate(runs: MicrosegRun[], cutoff: CheckCutoff): MicrosegRun | null {
  const since = time(cutoff.since)
  return runs.findLast(run => run.kind === 'full'
    && !cutoff.exclude.has(run.id)
    && (Number.isNaN(since) || time(run.started_at) >= since)) ?? null
}

/**
 * Whether the detail of a candidate is the check's run. A finished full run says it with its trigger; a running one
 * has no result yet and is taken on its start time.
 */
export function isCheckRun(run: MicrosegRun): boolean {
  if (run.kind !== 'full') return false
  return !run.result || run.result.trigger === 'check'
}

/** The IP collection and the log read of the pass of a full run, found in the runs list (no result in it). */
export function findCompanions(runs: MicrosegRun[], full: MicrosegRun): { ips: MicrosegRun | null; log: MicrosegRun | null } {
  const start = time(full.started_at)
  const near = (run: MicrosegRun) => Math.abs(time(run.started_at) - start) <= PASS_WINDOW_MS
  // Newest first: the IP collection is the newest ips run not after the full run, the log read the oldest log run
  // not before it.
  const ips = runs.find(run => run.kind === 'ips' && time(run.started_at) <= start && near(run)) ?? null
  const log = runs.findLast(run => run.kind === 'log' && time(run.started_at) >= start && near(run)) ?? null
  return { ips, log }
}

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info' | 'pending'

export type CheckRowId = 'inventory' | 'ips' | 'objects' | 'drifts' | 'observation' | 'unread' | 'truncated' | 'errors'

/** One row of the outcome: an i18n id under microsegPilot.check.rows, its status, the values of its texts. */
export type CheckRow = {
  id: CheckRowId
  status: CheckStatus
  /** Which text of the row (figure and detail) applies: `pass`, `warn`, `fail`, `none`, `pending`... */
  variant: string
  values: Record<string, number>
  /** The guests a row is about (the unread ones). */
  guests?: GuestRef[]
  /** Free lines a row lists under its chevron (errors, failed steps), as the engine wrote them. */
  lines?: string[]
}

/** The IP collection and the log read of the check, each once it has been looked for (null: not in the pass). */
export type CheckCompanions = { ipsReady: boolean; ips: MicrosegRun | null; logReady: boolean; log: MicrosegRun | null }

const n = (value: number | undefined) => value ?? 0

function ipsRow(companions: CheckCompanions): CheckRow {
  if (!companions.ipsReady) return { id: 'ips', status: 'pending', variant: 'pending', values: {} }
  const result = companions.ips?.result
  // No IP collection in the pass (an emergency stop not applied yet skips it): nothing was measured.
  if (!companions.ips || !result) return { id: 'ips', status: 'info', variant: 'none', values: {} }
  const members = n(result.members)
  const withIps = Math.min(n(result.with_ips), members)
  const missing = members - withIps
  return { id: 'ips', status: missing > 0 ? 'warn' : 'pass', variant: missing > 0 ? 'warn' : 'pass', values: { withIps, members, missing } }
}

function observationRow(companions: CheckCompanions): CheckRow {
  if (!companions.logReady) return { id: 'observation', status: 'pending', variant: 'pending', values: {} }
  const result = companions.log?.result
  // The engine records a log read only when it read something.
  const values = { events: n(result?.events), suggestions: n(result?.suggestions), dropped: n(result?.dropped_foreign_dst) }
  return { id: 'observation', status: 'pass', variant: values.events > 0 ? 'pass' : 'none', values }
}

function objectsRow(run: MicrosegRun): CheckRow {
  const result = run.result
  const failed = result?.failed ?? []
  const values = { steps: n(result?.steps), writes: n(run.writes), failed: failed.length }
  if (failed.length > 0) {
    return { id: 'objects', status: 'fail', variant: 'fail', values, lines: failed.map(stepLine) }
  }
  // A write means something differed from the policy: the engine realigned it.
  return { id: 'objects', status: values.writes > 0 ? 'warn' : 'pass', variant: values.writes > 0 ? 'warn' : 'pass', values }
}

function stepLine(step: StepRef): string {
  const what = step.summary || `${step.kind} ${step.object}`
  return step.error ? `${what}: ${step.error}` : what
}

/** The rows of a finished check, from its full run and the runs of the same pass. */
export function checkRows(run: MicrosegRun, companions: CheckCompanions): CheckRow[] {
  const result = run.result
  const drifts = n(result?.drifts)
  const rows: CheckRow[] = [
    { id: 'inventory', status: 'pass', variant: 'pass', values: { guests: n(result?.guests), members: n(result?.members) } },
    ipsRow(companions),
    objectsRow(run),
    { id: 'drifts', status: drifts > 0 ? 'warn' : 'pass', variant: drifts > 0 ? 'warn' : 'pass', values: { count: drifts } },
    observationRow(companions),
  ]
  const unread = result?.unread ?? []
  if (unread.length > 0) rows.push({ id: 'unread', status: 'fail', variant: 'fail', values: { count: unread.length }, guests: unread })
  if (result?.truncated || result?.held) {
    rows.push({ id: 'truncated', status: 'fail', variant: result.held ? 'held' : 'fail', values: {} })
  }
  const errors = result?.errors ?? []
  if (errors.length > 0) rows.push({ id: 'errors', status: 'fail', variant: 'fail', values: { count: errors.length }, lines: errors })
  return rows
}

export type LoggedStep = StepRef & { outcome: 'done' | 'failed' | 'notRun' }

/** The steps of a run in plan order, each with what became of it. */
export function stepLog(run: MicrosegRun): LoggedStep[] {
  const result = run.result
  if (!result) return []
  const steps: LoggedStep[] = [
    ...(result.done ?? []).map(step => ({ ...step, outcome: 'done' as const })),
    ...(result.failed ?? []).map(step => ({ ...step, outcome: 'failed' as const })),
    ...(result.not_run ?? []).map(step => ({ ...step, outcome: 'notRun' as const })),
  ]
  return steps.sort((a, b) => a.index - b.index)
}
