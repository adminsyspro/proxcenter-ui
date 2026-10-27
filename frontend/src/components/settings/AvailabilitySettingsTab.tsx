'use client'

// Settings > Availability and SLA: how long the availability history is kept
// (relayed to the orchestrator) and the default target of new SLA policies.
// Own tab, gated by Features.SLA_MONITORING in settings/page.jsx and by
// requireAvailabilitySettingsAccess() on its route.

import { useCallback, useEffect, useState } from 'react'

import { Alert, Box, Button, Card, CardContent, CircularProgress, Stack, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { RETENTION_MAX_DAYS, RETENTION_MIN_DAYS, TARGET_MAX, TARGET_MIN } from '@/lib/availability/limits'

const API = '/api/v1/availability/settings'

/** The codes of a 400 this tab words itself; any other code is the generic failure. */
const KNOWN_ERRORS = ['invalid_retention', 'invalid_target', 'invalid_body', 'orchestrator_unavailable'] as const

export default function AvailabilitySettingsTab() {
  const t = useTranslations('availability.settings')
  const [retention, setRetention] = useState('')
  const [target, setTarget] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // A code, not a translated string, so the callbacks never depend on `t`.
  const [errorCode, setErrorCode] = useState<string | null>(null)

  const codeOf = async (res: Response): Promise<string> => {
    const body = await res.json().catch(() => null)
    const code = body?.error

    return (KNOWN_ERRORS as readonly string[]).includes(code) ? code : 'generic'
  }

  const applySettings = (body: any): boolean => {
    if (!Number.isFinite(body?.retentionDays) || !Number.isFinite(body?.defaultTarget)) return false

    setRetention(String(body.retentionDays))
    setTarget(String(body.defaultTarget))

    return true
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch(API)

      if (!res.ok) {
        setErrorCode('load')

        return
      }

      const body = await res.json()

      if (!applySettings(body)) {
        setErrorCode('load')

        return
      }

      setLoaded(true)
    } catch {
      setErrorCode('load')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setSaved(false)
    setErrorCode(null)

    try {
      const res = await fetch(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: Number(retention), defaultTarget: Number(target) }),
      })

      if (!res.ok) {
        setErrorCode(await codeOf(res))

        return
      }

      // Only a well-formed answer replaces what was typed.
      applySettings(await res.json().catch(() => null))
      setSaved(true)
    } catch {
      setErrorCode('generic')
    } finally {
      setSaving(false)
    }
  }

  const bounds = { min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS, targetMin: TARGET_MIN, targetMax: TARGET_MAX }
  let message: string | null = null
  if (errorCode === 'load') message = t('loadError')
  else if (errorCode) message = t(`errors.${errorCode}`, bounds)
  const ready = loaded && retention.trim() !== '' && target.trim() !== '' && !saving

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant='h5' fontWeight={600}>
          {t('title')}
        </Typography>
        <Typography variant='body2' color='text.secondary'>
          {t('description')}
        </Typography>
      </Box>

      <Card variant='outlined'>
        <CardContent>
          <Stack spacing={3} sx={{ maxWidth: 520 }}>
            {message && <Alert severity='error'>{message}</Alert>}
            {saved && <Alert severity='success'>{t('saved')}</Alert>}

            <TextField
              size='small'
              type='number'
              label={t('retentionLabel')}
              value={retention}
              onChange={e => { setRetention(e.target.value); setSaved(false) }}
              helperText={t('retentionHelp', bounds)}
              slotProps={{ htmlInput: { min: RETENTION_MIN_DAYS, max: RETENTION_MAX_DAYS, step: 1 } }}
            />

            <TextField
              size='small'
              type='number'
              label={t('targetLabel')}
              value={target}
              onChange={e => { setTarget(e.target.value); setSaved(false) }}
              helperText={t('targetHelp', bounds)}
              slotProps={{ htmlInput: { min: TARGET_MIN, max: TARGET_MAX, step: 'any' } }}
            />

            <Box>
              <Button
                variant='contained'
                onClick={save}
                disabled={!ready}
                startIcon={saving ? <CircularProgress size={16} color='inherit' /> : undefined}
              >
                {saving ? t('saving') : t('save')}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  )
}
