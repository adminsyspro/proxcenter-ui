'use client'

// vDC settings, "Usage history" section (#902): sampling on/off, cadence and
// retention of the per-vDC usage history, and what the sampler last did.

import { useEffect, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

interface Settings {
  enabled: boolean
  intervalMinutes: number
  retentionDays: number
}

interface Status {
  samples: number
  lastSampledAt: string | null
  samplerActive: boolean
}

const SETTINGS_URL = '/api/v1/settings/vdc-usage-history'

export default function VdcUsageHistorySettings() {
  const t = useTranslations('vdcUsageHistory')
  const tc = useTranslations('common')
  const locale = useLocale()

  const [form, setForm] = useState<{ enabled: boolean; intervalMinutes: string; retentionDays: string } | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const apply = (json: any) => {
    const s: Settings = json.data

    setForm({ enabled: s.enabled, intervalMinutes: String(s.intervalMinutes), retentionDays: String(s.retentionDays) })
    setStatus(json.status ?? null)
  }

  useEffect(() => {
    let cancelled = false

    fetch(SETTINGS_URL, { cache: 'no-store' })
      .then(async res => {
        const json = await res.json().catch(() => ({}))

        if (!res.ok || !json?.data) throw new Error(json?.error || `HTTP ${res.status}`)
        if (!cancelled) apply(json)
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const interval = Number(form?.intervalMinutes)
  const retention = Number(form?.retentionDays)
  const intervalInvalid = !Number.isInteger(interval) || interval < 1 || interval > 1440
  const retentionInvalid = !Number.isInteger(retention) || retention < 1 || retention > 3650

  const save = async () => {
    if (!form || intervalInvalid || retentionInvalid) return
    setSaving(true)
    setSaved(false)
    try {
      const res = await fetch(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: form.enabled, intervalMinutes: interval, retentionDays: retention }),
      })
      const json = await res.json().catch(() => ({}))

      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      apply(json)
      setSaved(true)
      setError('')
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Card>
      <CardContent>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6">{t('title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('subtitle')}</Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}
        {saved && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSaved(false)}>
            {t('saved')}
          </Alert>
        )}

        {loading && !form ? (
          <LinearProgress />
        ) : form ? (
          <Stack spacing={2.5} sx={{ maxWidth: 520 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.enabled}
                  onChange={e => setForm(f => (f ? { ...f, enabled: e.target.checked } : f))}
                />
              }
              label={t('enabled')}
            />
            <TextField
              size="small"
              type="number"
              label={t('interval')}
              value={form.intervalMinutes}
              onChange={e => setForm(f => (f ? { ...f, intervalMinutes: e.target.value } : f))}
              error={intervalInvalid}
              helperText={t('intervalHelp')}
              disabled={!form.enabled}
              slotProps={{ htmlInput: { min: 1, max: 1440, step: 1 } }}
            />
            <TextField
              size="small"
              type="number"
              label={t('retention')}
              value={form.retentionDays}
              onChange={e => setForm(f => (f ? { ...f, retentionDays: e.target.value } : f))}
              error={retentionInvalid}
              helperText={t('retentionHelp')}
              slotProps={{ htmlInput: { min: 1, max: 3650, step: 1 } }}
            />
            {status && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={status.samplerActive ? 'success' : 'default'}
                  icon={<i className={status.samplerActive ? 'ri-play-circle-line' : 'ri-pause-circle-line'} />}
                  label={status.samplerActive ? t('samplerActive') : t('samplerIdle')}
                />
                <Typography variant="caption" color="text.secondary">
                  {t('storedSamples', { count: status.samples })}
                  {' · '}
                  {status.lastSampledAt
                    ? t('lastSample', { date: dateFmt.format(new Date(status.lastSampledAt)) })
                    : t('noSampleYet')}
                </Typography>
              </Stack>
            )}
            <Box>
              <Button
                variant="contained"
                onClick={() => void save()}
                disabled={saving || intervalInvalid || retentionInvalid}
                startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <i className="ri-save-line" />}
              >
                {tc('save')}
              </Button>
            </Box>
          </Stack>
        ) : null}
      </CardContent>
    </Card>
  )
}
