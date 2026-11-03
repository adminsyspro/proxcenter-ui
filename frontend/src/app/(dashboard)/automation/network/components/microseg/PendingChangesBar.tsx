'use client'

import { Alert, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegPolicy } from '@/lib/microseg/types'

import { usePendingChanges } from './usePendingChanges'
import { WriteTip, useMicrosegWrite } from './microsegAccess'

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
  const { pending, count } = usePendingChanges(connectionId, policy)
  const { canWrite } = useMicrosegWrite()

  if (!pending) return null

  return (
    <Alert
      severity='warning'
      icon={<i className='ri-draft-line' />}
      action={<WriteTip><Button color='inherit' size='small' onClick={onOpenPlan} disabled={!canWrite || !onOpenPlan}>{t('microsegPilot.pending.viewPlan')}</Button></WriteTip>}
    >
      {count ? t('microsegPilot.pending.withCount', { count }) : t('microsegPilot.pending.noCount')}
    </Alert>
  )
}
