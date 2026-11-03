'use client'

import { useEffect, useState } from 'react'
import { Box, CircularProgress } from '@mui/material'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegZone } from '@/lib/microseg/types'

import { OneLine, useDialogAction } from './dialogParts'
import TypedConfirmDialog from './TypedConfirmDialog'
import { isZoneReady } from './zoneModel'
import ZoneStateGate from './ZoneStateGate'

/** One page of pending would-block suggestions; a full page means there may be more we cannot see. */
const SUGGESTIONS_LIMIT = 200

type Readiness = 'ready' | 'notReady' | 'unchecked'

type Props = {
  connectionId: string
  zone: MicrosegZone
  readyAfterHours: number
  /** The draft has unapplied changes: enforcing would apply them unseen, so it is refused until they are applied or discarded. */
  pending?: boolean
  pendingCount?: number | null
  onViewPlan?: () => void
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
  connectionId, zone, readyAfterHours, pending = false, pendingCount = null, onViewPlan, onConfirm, onCancel,
}: Props) {
  const t = useTranslations('microsegPilot.policy.enforce')
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const { busy, error, run } = useDialogAction()

  const { id: zoneId, state, observe_since: observeSince } = zone
  useEffect(() => {
    let cancelled = false
    microsegApi(connectionId)
      .listSuggestions({ kind: 'would_block', status: 'pending', zone: zoneId, limit: SUGGESTIONS_LIMIT })
      .then(({ suggestions }) => {
        if (cancelled) return
        const complete = suggestions.length < SUGGESTIONS_LIMIT
        const ready = complete && isZoneReady({ state, observe_since: observeSince }, suggestions, readyAfterHours, Date.now())
        setReadiness(ready ? 'ready' : 'notReady')
      })
      .catch(() => { if (!cancelled) setReadiness('unchecked') })
    return () => { cancelled = true }
  }, [connectionId, zoneId, state, observeSince, readyAfterHours])

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
      {readiness === null ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CircularProgress size={16} />
          <OneLine text={t('checking')} />
        </Box>
      ) : (
        <OneLine text={t(readiness, { hours: readyAfterHours })} />
      )}
      <ZoneStateGate pending={pending} count={pendingCount} onViewPlan={onViewPlan} />
    </TypedConfirmDialog>
  )
}
