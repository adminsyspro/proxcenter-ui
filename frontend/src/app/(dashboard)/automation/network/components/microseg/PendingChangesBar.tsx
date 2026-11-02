'use client'

import { Alert, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import { countPendingChanges } from '@/lib/microseg/pendingChanges'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import type { MicrosegPolicy } from '@/lib/microseg/types'

type Props = {
  connectionId: string
  policy: MicrosegPolicy
  /** The plan view; the button is disabled while nothing handles it. */
  onOpenPlan?: () => void
}

/**
 * "N unapplied changes: View plan" (UA11). The server tells that something is
 * pending; the number is computed here, and only when it can be trusted: with
 * no revision (everything counts) or once the last revision's snapshot is
 * loaded. Otherwise the bar says "Unapplied changes" without a number.
 */
export default function PendingChangesBar({ connectionId, policy, onOpenPlan }: Props) {
  const t = useTranslations()
  const lastId = policy.last_revision?.id
  const { revision } = useLastRevisionSnapshot(connectionId, policy.pending_changes ? lastId : null)

  if (!policy.pending_changes) return null

  let count: number | null = null
  if (!policy.last_revision) {
    count = countPendingChanges(policy, null)
  } else if (revision) {
    count = countPendingChanges({ ...policy, tag_prefix: policy.policy.tag_prefix }, revision)
  }

  return (
    <Alert
      severity='warning'
      icon={<i className='ri-draft-line' />}
      sx={{ mt: 2 }}
      action={<Button color='inherit' size='small' onClick={onOpenPlan} disabled={!onOpenPlan}>{t('microsegPilot.pending.viewPlan')}</Button>}
    >
      {count ? t('microsegPilot.pending.withCount', { count }) : t('microsegPilot.pending.noCount')}
    </Alert>
  )
}
