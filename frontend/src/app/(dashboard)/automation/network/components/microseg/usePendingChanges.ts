import { countPendingChanges } from '@/lib/microseg/pendingChanges'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import type { MicrosegPolicy } from '@/lib/microseg/types'

/**
 * The unapplied changes of the draft. `pending` is the server's word; `count` is computed here, and only when it can
 * be trusted: with no revision (everything counts) or once the last revision's snapshot is loaded, null otherwise.
 */
export function usePendingChanges(connectionId: string, policy: MicrosegPolicy): { pending: boolean; count: number | null } {
  const lastId = policy.last_revision?.id
  const { revision } = useLastRevisionSnapshot(connectionId, policy.pending_changes ? lastId : null)

  if (!policy.pending_changes) return { pending: false, count: 0 }
  if (!policy.last_revision) return { pending: true, count: countPendingChanges(policy, null) }
  if (revision) return { pending: true, count: countPendingChanges({ ...policy, tag_prefix: policy.policy.tag_prefix }, revision) }
  return { pending: true, count: null }
}
