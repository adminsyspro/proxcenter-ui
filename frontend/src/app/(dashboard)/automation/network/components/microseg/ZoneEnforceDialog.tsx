'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import type { MicrosegZone } from '@/lib/microseg/types'

import { useDialogAction } from './dialogParts'
import IPFilterEnforceLine from './IPFilterEnforceLine'
import TypedConfirmDialog from './TypedConfirmDialog'
import { useReadinessCheck } from './useZoneReadiness'
import ZoneStateGate from './ZoneStateGate'

type Props = {
  connectionId: string
  /** Names the clusters of a shared policy in the details of the IP filter line. */
  clusterName?: (id: string) => string
  zone: MicrosegZone
  readyAfterHours: number
  /** The draft has unapplied changes: enforcing would apply them unseen, so it is refused until they are applied or discarded. */
  pending?: boolean
  pendingCount?: number | null
  onViewPlan?: () => void
  /** Discard of the pending changes, next to Review and apply in the refusal. */
  discard?: ReactNode
  /** Starts the state change; throws when it fails (the dialog shows the error). */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/**
 * Confirmation before a zone is enforced. "Ready" means observed for the whole
 * window with no pending would-block suggestion seen inside it. An indicator,
 * not a lock: a zone that is not ready (or whose readiness cannot be read) goes
 * ahead only once its name is typed. Enforcing the first zone of a policy whose IP filter is on starts the filter:
 * one more line says how many members are ready for it.
 */
export default function ZoneEnforceDialog({
  connectionId, clusterName, zone, readyAfterHours, pending = false, pendingCount = null, onViewPlan, discard, onConfirm, onCancel,
}: Props) {
  const t = useTranslations('microsegPilot.policy.enforce')
  const check = useReadinessCheck(connectionId, zone, readyAfterHours)
  const { busy, error, run } = useDialogAction()

  return (
    <TypedConfirmDialog
      title={t('title', { name: zone.name })}
      inputLabel={t('typeName', { name: zone.name })}
      expected={check.needsName ? zone.name : undefined}
      confirmLabel={t('confirm')}
      color='warning'
      ready={!check.loading && !pending}
      busy={busy}
      error={error}
      onConfirm={() => void run(onConfirm)}
      onCancel={onCancel}
    >
      {check.line}
      <IPFilterEnforceLine connectionId={connectionId} clusterName={clusterName} />
      <ZoneStateGate pending={pending} count={pendingCount} onViewPlan={onViewPlan} discard={discard} />
    </TypedConfirmDialog>
  )
}
