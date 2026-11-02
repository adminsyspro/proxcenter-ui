'use client'

import { useEffect, useState } from 'react'
import { Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import { useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import type { MicrosegZone } from '@/lib/microseg/types'

import { DialogErrorLine, ONE_LINE_SX, OneLine, useDialogAction } from './dialogParts'
import { isZoneReady } from './zoneModel'

/** One page of pending would-block suggestions; a full page means there may be more we cannot see. */
const SUGGESTIONS_LIMIT = 200

type Readiness = 'ready' | 'notReady' | 'unchecked'

type Props = {
  connectionId: string
  zone: MicrosegZone
  readyAfterHours: number
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
export default function ZoneEnforceDialog({ connectionId, zone, readyAfterHours, onConfirm, onCancel }: Props) {
  const t = useTranslations('microsegPilot.policy.enforce')
  const tc = useTranslations('common')
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [typed, setTyped] = useState('')
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
  const canConfirm = readiness !== null && (!needsName || typed === zone.name)

  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth='sm' fullWidth aria-labelledby='microseg-enforce-title'>
      <DialogTitle id='microseg-enforce-title' sx={ONE_LINE_SX}>{t('title', { name: zone.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {readiness === null && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <CircularProgress size={16} />
              <OneLine text={t('checking')} />
            </Box>
          )}
          {readiness !== null && <OneLine text={t(readiness, { hours: readyAfterHours })} />}
          {needsName && (
            <TextField
              label={t('typeName', { name: zone.name })}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              disabled={busy}
              size='small'
              fullWidth
              autoFocus
              autoComplete='off'
            />
          )}
          {error && <DialogErrorLine message={error} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={busy}>{tc('cancel')}</Button>
        <Button onClick={() => void run(onConfirm)} variant='contained' color='warning' disabled={busy || !canConfirm}>
          {t('confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
