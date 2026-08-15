'use client'

import { useTranslations } from 'next-intl'

import ConfirmActionButton from './ConfirmActionButton'

/**
 * The operator's switchover control, with its confirmation.
 *
 * One component rather than a copy per surface: the button belongs both to the
 * VM panel (where a job started through the API is followed) and to the migrate
 * dialog (where the operator who started the run is actually looking). Two
 * hand-written copies would drift, and the first one to drift would be the one
 * nobody is watching.
 */

type WarmJob = {
  id: string
  status: string
  projectedDowntimeSec?: number | null
  config?: { cutoverMode?: string } | null
} | null | undefined

/**
 * A manual-cutover run holds in `delta_sync`, replicating, instead of parking in
 * `awaiting_cutover`. It is waiting for the operator all the same, so both read
 * as "waiting" everywhere in the UI (#443).
 */
export function isWarmHold(job: WarmJob): boolean {
  return job?.config?.cutoverMode === 'manual' && job?.status === 'delta_sync'
}

/** True when the migration is waiting on a human, whichever way it got there. */
export function isAwaitingOperator(job: WarmJob): boolean {
  return isWarmHold(job) || job?.status === 'awaiting_cutover'
}

/**
 * The cutover can only be requested once a delta pass has produced an estimate:
 * before that the pipeline has no projection to show and no change id to resume
 * from.
 */
export function canRequestCutover(job: WarmJob): boolean {
  return !!job && ['delta_sync', 'awaiting_cutover'].includes(job.status) && job.projectedDowntimeSec != null
}

export default function WarmCutoverButton({
  job,
  size = 'small',
  onRequested,
}: {
  job: WarmJob
  size?: 'small' | 'medium'
  onRequested?: () => void
}) {
  const t = useTranslations()

  if (!canRequestCutover(job)) return null

  const awaiting = isAwaitingOperator(job)
  const mins = Math.round((job!.projectedDowntimeSec ?? 0) / 60)

  return (
    <ConfirmActionButton
      label={t('inventoryPage.esxiMigration.cutoverNow')}
      icon="ri-flashlight-line"
      color="primary"
      variant={awaiting ? 'contained' : 'outlined'}
      size={size}
      title={t('inventoryPage.esxiMigration.cutoverConfirmTitle')}
      body={t('inventoryPage.esxiMigration.cutoverConfirmBody', { mins })}
      // Only the automatic mode can reach the gate, and only there does the
      // warning hold: a manual hold is waiting on purpose, not diverging.
      alert={job!.status === 'awaiting_cutover' ? t('inventoryPage.esxiMigration.cutoverNotConverging') : undefined}
      onConfirm={async () => {
        await fetch(`/api/v1/migrations/${job!.id}/cutover`, { method: 'POST' })
        onRequested?.()
      }}
    />
  )
}
