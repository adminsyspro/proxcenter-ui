import type { MicrosegRun, PlanStep } from '@/lib/microseg/types'

/** Where a planned step stands while the plan is applied, and once the application has ended. */
export type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'notRun'

const all = (steps: PlanStep[], state: StepState) => new Map(steps.map(s => [s.index, state]))

/**
 * The state of every step of the plan shown, by step index, from the application that runs it.
 *
 * While it runs, the engine says how many steps it has written of how many: the steps before that count are done, the
 * one at it is being written, the others wait (all of them wait while the engine still waits or reads the guests).
 * Once it has ended, its result names the steps done, failed and not run.
 *
 * The application computes the plan again before writing it. Null when what it reports is not the plan shown (another
 * number of steps, or steps the plan does not have): the caller then shows the outcome without the per-step marks.
 */
export function stepStates(steps: PlanStep[], run: MicrosegRun | null): Map<number, StepState> | null {
  if (steps.length === 0) return null
  if (!run) return all(steps, 'waiting')
  if (run.status === 'running') {
    const progress = run.result?.progress
    if (!progress || progress.phase !== 'writing') return all(steps, 'waiting')
    if (progress.total !== steps.length) return null
    return new Map(steps.map((s, at) => [s.index, at < progress.done ? 'done' : at === progress.done ? 'running' : 'waiting']))
  }
  const result = run.result
  if (!result) return null
  const outcome = new Map<number, StepState>()
  for (const s of result.done ?? []) outcome.set(s.index, 'done')
  for (const s of result.failed ?? []) outcome.set(s.index, 'failed')
  for (const s of result.not_run ?? []) outcome.set(s.index, 'notRun')
  if (outcome.size !== steps.length || steps.some(s => !outcome.has(s.index))) return null
  return outcome
}

/** The planned steps with what the application said of each: a failed or skipped step carries its reason. */
export function stepsWithOutcome(steps: PlanStep[], run: MicrosegRun | null): PlanStep[] {
  const said = new Map([...(run?.result?.failed ?? []), ...(run?.result?.not_run ?? [])].map(s => [s.index, s]))
  return steps.map(s => said.get(s.index) ?? s)
}

/** How many steps of a group are done, and the one state that sums the group up for its header. */
export function groupState(steps: PlanStep[], states: ReadonlyMap<number, StepState>): { done: number; state: StepState } {
  const of = steps.map(s => states.get(s.index) ?? 'waiting')
  const done = of.filter(s => s === 'done').length
  let state: StepState = 'waiting'
  if (of.includes('failed')) state = 'failed'
  else if (of.includes('running') || (done > 0 && done < of.length && !of.includes('notRun'))) state = 'running'
  else if (done === of.length) state = 'done'
  else if (of.includes('notRun')) state = 'notRun'
  return { done, state }
}
