import { diffCount, policyDiff, type PolicyDiff } from '@/lib/microseg/pendingChanges'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import type { MicrosegPolicy } from '@/lib/microseg/types'

/** A draft with nothing to apply. */
export const NO_DIFF: PolicyDiff = { zones: new Map(), flows: new Map(), removedZones: [], removedFlows: [], members: 0, prefix: false }

/**
 * The unapplied changes of the draft. `pending` is the server's word; `count` and `diff` (what each zone and flow
 * changes over the last applied revision) are computed here, and only when they can be trusted: with no revision
 * (everything is added) or once the last revision's snapshot is loaded, null otherwise.
 */
export function usePendingChanges(connectionId: string, policy: MicrosegPolicy): { pending: boolean; count: number | null; diff: PolicyDiff | null } {
  const lastId = policy.last_revision?.id
  const { revision } = useLastRevisionSnapshot(connectionId, policy.pending_changes ? lastId : null)

  if (!policy.pending_changes) return { pending: false, count: 0, diff: NO_DIFF }
  const draft = { ...policy, tag_prefix: policy.policy.tag_prefix }
  let diff: PolicyDiff | null = null
  if (!policy.last_revision) diff = policyDiff(draft, null)
  else if (revision) diff = policyDiff(draft, revision)
  return { pending: true, count: diff ? diffCount(diff) : null, diff }
}
