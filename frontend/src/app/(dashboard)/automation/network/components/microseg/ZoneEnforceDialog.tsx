'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import type { MicrosegZone } from '@/lib/microseg/types'

import { useDialogAction } from './dialogParts'
import TypedConfirmDialog from './TypedConfirmDialog'
import { ReadinessLine, useZoneReadiness } from './useZoneReadiness'
import ZoneStateGate from './ZoneStateGate'

type Props = {
  connectionId: string
  zone: MicrosegZone
  readyAfterHours: number
  /** The draft has unapplied changes: enforcing would apply them unseen, so it is refused until they are applied or discarded. */
  pending?: boolean
  pendingCount?: number | null
  onViewPlan?: () => void
  /** Discard of the pending changes, next to View plan in the refusal. */
  discard?: ReactNode
  /** Starts the state change; throws when it fails (the dialog shows the error). */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/**
 * Confirmation before a zone is enforced. "Ready" means observed for the whole
 * window with no pending would-block suggestion seen inside it. An indicator,
 * not a lock: a zone that is not ready (or whose readiness cannot be read) goes
 * ahead only once its name is typed.
 */
export default function ZoneEnforceDialog({
  connectionId, zone, readyAfterHours, pending = false, pendingCount = null, onViewPlan, discard, onConfirm, onCancel,
}: Props) {
  const t = useTranslations('microsegPilot.policy.enforce')
  const readiness = useZoneReadiness(connectionId, zone, readyAfterHours)
  const { busy, error, run } = useDialogAction()

  const needsName = readiness !== null && readiness !== 'ready'

  return (
    <TypedConfirmDialog
      title={t('title', { name: zone.name })}
      inputLabel={t('typeName', { name: zone.name })}
      expected={needsName ? zone.name : undefined}
      confirmLabel={t('confirm')}
      color='warning'
      ready={readiness !== null && !pending}
      busy={busy}
      error={error}
      onConfirm={() => void run(onConfirm)}
      onCancel={onCancel}
    >
      <ReadinessLine readiness={readiness} texts={{ checking: t('checking'), ready: t('ready', { hours: readyAfterHours }), notReady: t('notReady', { hours: readyAfterHours }), unchecked: t('unchecked', { hours: readyAfterHours }) }} />
      <ZoneStateGate pending={pending} count={pendingCount} onViewPlan={onViewPlan} discard={discard} />
    </TypedConfirmDialog>
  )
}
