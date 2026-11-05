import type { ReactNode } from 'react'

import DiscardDraft from './DiscardDraft'
import type { ZoneEdits } from './useZoneEdits'

/** What a zone change that applies the whole draft says when the draft has pending changes (ZoneStateGate). */
export type ZoneGate = { pending: boolean; count: number | null; onViewPlan?: () => void; discard?: ReactNode }

/** The pending changes of the draft as the gate of a zone change, with the ways out of the refusal (plan, discard). */
export function zoneGateOf(edits: ZoneEdits, onClose: () => void): ZoneGate {
  const { onOpenPlan, pendingChanges } = edits
  return {
    pending: pendingChanges.pending,
    count: pendingChanges.count,
    onViewPlan: onOpenPlan ? () => { onClose(); onOpenPlan() } : undefined,
    discard: pendingChanges.pending
      ? <DiscardDraft connectionId={edits.connectionId} policy={edits.policy} count={pendingChanges.count} variant='outlined' />
      : undefined,
  }
}
