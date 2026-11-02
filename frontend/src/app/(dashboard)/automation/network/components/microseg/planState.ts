import { isPlanStale } from '@/lib/microseg/api'
import type { MicrosegRun, PlanStep } from '@/lib/microseg/types'

// The backend marks a plan run `failed` with this error, and still stores the whole plan, when guests could not be read.
const UNREAD_ONLY_ERROR = /^\d+ guest\(s\) could not be read$/

export type PlanState = {
  steps: PlanStep[]
  /** The plan, its warnings and its steps are shown (a failed run may still carry a plan). */
  showDiff: boolean
  /** The run failed for a reason other than unread guests: say so, with a Recompute. */
  failure: boolean
  stale: boolean
  collisions: boolean
  /** Whether Apply may be offered once nothing else is in the way. */
  applicable: boolean
}

/**
 * What a plan run allows. A `failed` plan run keeps its result: the diff is
 * shown, and it can still be applied when the only cause is guests that could
 * not be read (they are handled on the next pass) and nothing collides.
 */
export function planState(run: MicrosegRun | null, draftVersion: number, pendingChanges: boolean, conflict: boolean): PlanState {
  const result = run?.result ?? null
  const steps = result?.plan ?? []
  const failed = run?.status === 'failed'
  const unreadOnly = failed && !!result && (result.unread?.length ?? 0) > 0 && UNREAD_ONLY_ERROR.test(run?.error ?? '')
  const finished = run?.status === 'done' || failed
  const showDiff = !!result && finished && (!failed || steps.length > 0 || unreadOnly)
  const collisions = (result?.collisions?.length ?? 0) > 0
  const hasWork = steps.length > 0 || pendingChanges
  return {
    steps,
    showDiff,
    failure: failed && !unreadOnly,
    stale: conflict || (!!run && isPlanStale(run, draftVersion)),
    collisions,
    applicable: showDiff && (!failed || unreadOnly) && !collisions && hasWork,
  }
}
