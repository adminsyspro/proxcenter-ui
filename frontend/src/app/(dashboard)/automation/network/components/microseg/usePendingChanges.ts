import { useMemo } from 'react'

import { diffCount, policyDiff, type PolicyDiff } from '@/lib/microseg/pendingChanges'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import type { MicrosegPolicy } from '@/lib/microseg/types'

/** A draft with nothing to apply. */
export const NO_DIFF: PolicyDiff = { zones: new Map(), flows: new Map(), removedZones: [], removedFlows: [], renamedZones: new Map(), members: 0, prefix: false }

/**
 * The unapplied changes of the draft. `pending` is the server's word; `count` and `diff` (what each zone and flow
 * changes over the last applied revision) are computed here, and only when they can be trusted: with no revision
 * (everything is added) or once the last revision's snapshot is loaded, null otherwise. The diff is computed once per
 * draft and revision.
 */
export function usePendingChanges(connectionId: string, policy: MicrosegPolicy): { pending: boolean; count: number | null; diff: PolicyDiff | null } {
  const lastId = policy.last_revision?.id
  const { revision } = useLastRevisionSnapshot(connectionId, policy.pending_changes ? lastId : null)
  const { zones, flows, pending_members: members } = policy
  const tagPrefix = policy.policy.tag_prefix
  const hasRevision = !!policy.last_revision

  const diff = useMemo(() => {
    const draft = { zones, flows, pending_members: members, tag_prefix: tagPrefix }
    if (!hasRevision) return policyDiff(draft, null)
    return revision ? policyDiff(draft, revision) : null
  }, [zones, flows, members, tagPrefix, hasRevision, revision])

  if (!policy.pending_changes) return { pending: false, count: 0, diff: NO_DIFF }
  return { pending: true, count: diff ? diffCount(diff) : null, diff }
}
