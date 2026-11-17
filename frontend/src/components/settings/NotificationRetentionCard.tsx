'use client'

// Notifications tab, "History" section: how long the notification history is
// kept. One row per notification is stored, one per successful replication
// run included, so the retention bounds a table that otherwise only grows.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, Button, Card, CardContent, CircularProgress, InputAdornment, TextField, Typography } from '@mui/material'

const RETENTION_URL = '/api/v1/orchestrator/notifications/retention'
const DEFAULT_MAX_DAYS = 365

export default function NotificationRetentionCard() {
  const t = useTranslations('notifications.retention')
  const tc = useTranslations('common')

  const [days, setDays] = useState('')
  const [maxDays, setMaxDays] = useState(DEFAULT_MAX_DAYS)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetch(RETENTION_URL, { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => ({}))

        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        if (cancelled) return
        setDays(String(json.retentionDays))
        setMaxDays(json.maxRetentionDays ?? DEFAULT_MAX_DAYS)
        setLoaded(true)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || String(e))
      })

    return () => {
      cancelled = true
    }
  }, [])

  const value = Number(days)
  const invalid = !Number.isInteger(value) || value < 1 || value > maxDays

  const save = async () => {
    if (invalid) return
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(RETENTION_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ retentionDays: value })
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      setSaved(true)
      setError('')
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card variant='outlined' sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-history-line' />
          {t('title')}
        </Typography>
        <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
          {t('description')}
        </Typography>

        {error && (
          <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {saved && (
          <Alert severity='success' sx={{ mb: 2 }} onClose={() => setSaved(false)}>
            {t('saved')}
          </Alert>
        )}

        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
          <TextField
            size='small'
            type='number'
            label={t('label')}
            value={days}
            onChange={e => {
              setDays(e.target.value)
              setSaved(false)
            }}
            disabled={!loaded}
            error={loaded && invalid}
            helperText={loaded && invalid ? t('range', { max: maxDays }) : undefined}
            slotProps={{
              htmlInput: { min: 1, max: maxDays, 'aria-label': t('label') },
              input: { endAdornment: <InputAdornment position='end'>{t('unit')}</InputAdornment> },
              formHelperText: { sx: { whiteSpace: 'nowrap' } }
            }}
            sx={{ width: 220 }}
          />
          <Button
            variant='contained'
            aria-label={t('save')}
            onClick={() => void save()}
            disabled={!loaded || invalid || saving}
            startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
          >
            {saving ? tc('saving') : tc('save')}
          </Button>
        </Box>
      </CardContent>
    </Card>
  )
}
