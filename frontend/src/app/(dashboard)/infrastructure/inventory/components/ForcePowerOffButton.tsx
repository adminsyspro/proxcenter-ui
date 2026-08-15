'use client'

import { useTranslations } from 'next-intl'

import ConfirmActionButton from './ConfirmActionButton'

/**
 * The way out of a refused guest shutdown.
 *
 * The pipeline asks the guest to shut down and then waits for a confirmed
 * powered-off state. When the guest refuses, that wait used to be silent and the
 * run was lost. It is now a step of its own, and this is the action attached to
 * it: stop the source hard, on the operator's decision only, because a hard power
 * off makes the final delta crash-consistent (#614).
 */

type PowerOffJob = {
  id: string
  status: string
  currentStep?: string | null
} | null | undefined

/** True while the pipeline is waiting for the source to reach a powered-off state. */
export function isAwaitingPowerOff(job: PowerOffJob): boolean {
  return job?.currentStep === 'awaiting_power_off'
    && !['completed', 'failed', 'cancelled'].includes(job?.status ?? '')
}

export default function ForcePowerOffButton({
  job,
  size = 'small',
  onRequested,
}: {
  job: PowerOffJob
  size?: 'small' | 'medium'
  onRequested?: () => void
}) {
  const t = useTranslations()

  if (!isAwaitingPowerOff(job)) return null

  return (
    <ConfirmActionButton
      label={t('inventoryPage.esxiMigration.forcePowerOff')}
      icon="ri-shut-down-line"
      color="error"
      size={size}
      title={t('inventoryPage.esxiMigration.forcePowerOffConfirmTitle')}
      body={t('inventoryPage.esxiMigration.forcePowerOffConfirmBody')}
      alert={t('inventoryPage.esxiMigration.forcePowerOffCrashConsistent')}
      onConfirm={async () => {
        await fetch(`/api/v1/migrations/${job!.id}/force-poweroff`, { method: 'POST' })
        onRequested?.()
      }}
    />
  )
}
