import { isPlanStale } from '@/lib/microseg/api'
import type { GroupRunError, MicrosegRun, PlanStep } from '@/lib/microseg/types'

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

/**
 * True only for the wording of the orchestrator's PVE client when it could not reach the cluster, in one of two shapes:
 * - every node failed: the text contains "cluster nodes unreachable", as at the lab:
 *   `read the guests: GET /cluster/resources?type=vm: request failed: all 3 cluster nodes unreachable (last error: ...
 *   dial tcp 10.42.0.111:8006: connect: connection refused)`;
 * - one request failed to connect: "request failed:" together with "connection refused", "no route to host",
 *   "i/o timeout" or "dial tcp", as `request failed: Get "https://10.0.0.1:8006/...": dial tcp 10.0.0.1:8006: connect:
 *   connection refused`.
 * Anything else is a real failure: a bare "connection refused" relayed by PVE from a node-to-node hop ("500 proxy:
 * connection refused"), a database dial ("dial tcp 127.0.0.1:5432: ..."), "context deadline exceeded", a refusal of
 * PVE, a certificate error. Only then does a plan not block Apply and a line promise that the cluster catches up once
 * it is reachable again.
 */
const ALL_NODES_RE = /cluster nodes unreachable/i
const REQUEST_FAILED_RE = /request failed:/i
const CONNECT_FAILURE_RE = /connection refused|no route to host|i\/o timeout|dial tcp/i

export function looksUnreachable(error: string | undefined | null): boolean {
  const text = error ?? ''
  return ALL_NODES_RE.test(text) || (REQUEST_FAILED_RE.test(text) && CONNECT_FAILURE_RE.test(text))
}

/** The plan of one cluster of a shared policy: its run, or why it did not start, or that it cannot be read any more. */
export type ClusterPlan = { connectionId: string; run: MicrosegRun | null; error?: GroupRunError; fatal?: boolean }

export type ClusterPlanState = ClusterPlan & {
  state: PlanState
  /** The plan is still computed (or its first answer has not come). */
  running: boolean
  /** This cluster holds Apply back: its plan did not start for a reason that needs the admin, or cannot be read. */
  blocking: boolean
  /** Its plan run ended failed because the cluster could not be reached: it catches up at its next pass, like `no_client`. */
  unreachable: boolean
}

/**
 * The start errors after which nothing can be written on a cluster for now (unreachable, engine stopped, emergency
 * stop): the cluster catches up by itself at its next pass, so they hold no other cluster back. Any other code
 * (`internal`, or one this UI does not know) is a failure that needs the admin.
 */
export const CATCH_UP_ERRORS: ReadonlySet<string> = new Set(['no_client', 'engine_stopped', 'stopped'])

export type GroupPlanState = {
  clusters: ClusterPlanState[]
  /** A plan of a cluster is still computed: Apply waits. */
  running: boolean
  /** A plan of a cluster comes from an older draft (or the draft moved): Apply is refused until recomputed. */
  stale: boolean
  /** The draft version of the first stale plan, for the stale message (0 when unknown). */
  staleVersion: number
  /** Whether Apply may be offered once nothing else is in the way. */
  applicable: boolean
  /** Why Apply is refused, said next to the button: null while computing, or when it is allowed or there is nothing to apply. */
  blockReason: GroupBlockReason | null
}

export type GroupBlockReason = 'failed' | 'stale' | 'collisions' | 'noCluster'

/**
 * What the plans of the clusters of a shared policy allow together: Apply stays one button. It waits while any plan
 * is computed, and is refused when any plan collides, failed or comes from an older draft. A cluster whose plan did
 * not start because nothing can be written there now (unreachable, engine stopped, emergency stop) does not hold the
 * others back: it catches up at its next pass. Any other start error, and a plan that cannot be read any more, block
 * Apply. Apply needs at least one usable plan.
 */
export function groupPlanState(plans: readonly ClusterPlan[], draftVersion: number, pendingChanges: boolean, conflict: boolean): GroupPlanState {
  const clusters = plans.map(plan => {
    const state = planState(plan.run, draftVersion, pendingChanges, conflict)
    const finished = plan.run?.status === 'done' || plan.run?.status === 'failed'
    const running = !plan.error && !plan.fatal && !finished
    const blocking = plan.error ? !CATCH_UP_ERRORS.has(plan.error) : !!plan.fatal
    const unreachable = !plan.error && !plan.fatal && plan.run?.status === 'failed' && looksUnreachable(plan.run.error)
    return { ...plan, state, running, blocking, unreachable }
  })
  const planned = clusters.filter(c => !c.error && !c.fatal && !c.unreachable)
  const running = planned.some(c => c.running)
  const staleRun = planned.find(c => c.state.stale)
  const stale = conflict || !!staleRun
  const hasWork = pendingChanges || planned.some(c => c.state.steps.length > 0)
  const failed = clusters.some(c => c.blocking) || planned.some(c => c.state.failure || (!c.running && !c.state.showDiff))
  const collisions = planned.some(c => c.state.collisions)
  let blockReason: GroupBlockReason | null = null
  if (running) blockReason = null
  else if (failed) blockReason = 'failed'
  else if (stale) blockReason = 'stale'
  else if (collisions) blockReason = 'collisions'
  else if (planned.length === 0) blockReason = 'noCluster'
  return {
    clusters,
    running,
    stale,
    staleVersion: staleRun?.run?.result?.version ?? 0,
    applicable: !running && !failed && !collisions && planned.length > 0 && hasWork,
    blockReason,
  }
}
