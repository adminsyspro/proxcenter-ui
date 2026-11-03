'use client'

import type { ReactNode } from 'react'

import { useTranslations } from 'next-intl'

import type { MicrosegZone } from '@/lib/microseg/types'

import { useDialogAction } from './dialogParts'
import TypedConfirmDialog from './TypedConfirmDialog'
import ZoneStateGate from './ZoneStateGate'

type Props = {
  zone: MicrosegZone
  /** Observation or disabled; enforcement has its own dialog (readiness, typed name). */
  state: 'observe' | 'disabled'
  pending: boolean
  pendingCount: number | null
  onViewPlan?: () => void
  /** Discard of the pending changes, next to View plan in the refusal. */
  discard?: ReactNode
  /** Starts the state change; throws when it fails (the dialog shows the error). */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/** Confirmation of a zone moving to observation or disabled: applied at once, refused while the draft has pending changes. */
export default function ZoneStateDialog({ zone, state, pending, pendingCount, onViewPlan, discard, onConfirm, onCancel }: Props) {
  const t = useTranslations('microsegPilot.policy.state')
  const { busy, error, run } = useDialogAction()
  return (
    <TypedConfirmDialog
      title={t(`title.${state}`, { name: zone.name })}
      lines={[t(`body.${state}`)]}
      confirmLabel={t(`confirm.${state}`)}
      color='warning'
      ready={!pending}
      busy={busy}
      error={error}
      onConfirm={() => void run(onConfirm)}
      onCancel={onCancel}
    >
      <ZoneStateGate pending={pending} count={pendingCount} onViewPlan={onViewPlan} discard={discard} />
    </TypedConfirmDialog>
  )
}
