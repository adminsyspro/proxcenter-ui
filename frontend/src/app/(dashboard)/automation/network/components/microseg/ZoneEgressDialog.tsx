'use client'

import { useTranslations } from 'next-intl'

import type { MicrosegZone } from '@/lib/microseg/types'

import { useDialogAction } from './dialogParts'
import TypedConfirmDialog from './TypedConfirmDialog'
import type { ZoneGate } from './zoneGate'
import { ReadinessLine, useZoneReadiness } from './useZoneReadiness'
import ZoneStateGate from './ZoneStateGate'

type Props = {
  connectionId: string
  zone: MicrosegZone
  /** `block`: observation to blocking, with the readiness; `reopen`: blocking to observation, only reached when the draft has pending changes. */
  action: 'block' | 'reopen'
  readyAfterHours: number
  gate: ZoneGate
  /** Starts the outbound state change; throws when it fails (the dialog shows the error). */
  onConfirm: () => Promise<void>
  onCancel: () => void
}

/**
 * Confirmation of an outbound state change of a zone. Blocking checks the readiness of the outbound observation
 * (same rule as the inbound enforcement) and asks the zone name when the zone is not ready or the readiness cannot be
 * read. Both are refused while the draft has pending changes: the change applies the whole draft.
 */
export default function ZoneEgressDialog({ connectionId, zone, action, readyAfterHours, gate, onConfirm, onCancel }: Props) {
  const t = useTranslations('microsegPilot.policy.egressState')
  const block = action === 'block'
  const readiness = useZoneReadiness(connectionId, zone, readyAfterHours, { direction: 'out', enabled: block })
  const { busy, error, run } = useDialogAction()

  const needsName = block && readiness !== null && readiness !== 'ready'
  const loading = block && readiness === null

  return (
    <TypedConfirmDialog
      title={t(`title.${action}`, { name: zone.name })}
      lines={block ? [] : [t('reopenBody')]}
      inputLabel={t('typeName', { name: zone.name })}
      expected={needsName ? zone.name : undefined}
      confirmLabel={t(`confirm.${action}`)}
      color='warning'
      ready={!loading && !gate.pending}
      busy={busy}
      error={error}
      onConfirm={() => void run(onConfirm)}
      onCancel={onCancel}
    >
      {block && <ReadinessLine readiness={readiness} texts={{ checking: t('checking'), ready: t('ready', { hours: readyAfterHours }), notReady: t('notReady', { hours: readyAfterHours }), unchecked: t('unchecked', { hours: readyAfterHours }) }} />}
      <ZoneStateGate pending={gate.pending} count={gate.count} onViewPlan={gate.onViewPlan} discard={gate.discard} />
    </TypedConfirmDialog>
  )
}
