'use client'

import { useEffect, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegZone } from '@/lib/microseg/types'

import { OneLine, useDialogAction } from './dialogParts'
import TypedConfirmDialog from './TypedConfirmDialog'
import type { ZoneGate } from './zoneGate'
import { isEgressReady, pendingOutboundOf } from './zoneModel'
import ZoneStateGate from './ZoneStateGate'

/** One page of pending would-block suggestions; a full page means there may be more we cannot see. */
const SUGGESTIONS_LIMIT = 200

type Readiness = 'ready' | 'notReady' | 'unchecked'

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
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const { busy, error, run } = useDialogAction()
  const block = action === 'block'

  const { id: zoneId, egress_state: egressState, egress_observe_since: observeSince } = zone
  useEffect(() => {
    if (!block) return
    let cancelled = false
    microsegApi(connectionId)
      .listSuggestions({ kind: 'would_block', status: 'pending', zone: zoneId, direction: 'out', limit: SUGGESTIONS_LIMIT })
      .then(({ suggestions }) => {
        if (cancelled) return
        const complete = suggestions.length < SUGGESTIONS_LIMIT
        const ready = complete && isEgressReady({ egress_state: egressState, egress_observe_since: observeSince }, pendingOutboundOf(suggestions, zoneId), readyAfterHours, Date.now())
        setReadiness(ready ? 'ready' : 'notReady')
      })
      .catch(() => { if (!cancelled) setReadiness('unchecked') })
    return () => { cancelled = true }
  }, [block, connectionId, zoneId, egressState, observeSince, readyAfterHours])

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
      {block && (loading ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={16} />
          <OneLine text={t('checking')} />
        </Box>
      ) : (
        <OneLine text={t(readiness ?? 'unchecked', { hours: readyAfterHours })} />
      ))}
      <ZoneStateGate pending={gate.pending} count={gate.count} onViewPlan={gate.onViewPlan} discard={gate.discard} />
    </TypedConfirmDialog>
  )
}
