'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Slider,
  Snackbar,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

const DEFAULTS = {
  cpu_warning: 80,
  cpu_critical: 90,
  memory_warning: 80,
  memory_critical: 90,
  storage_warning: 80,
  storage_critical: 90,
  snapshot_max_age_days: 7,
}

export default function AlertThresholdsTab() {
  const t = useTranslations()
  const [thresholds, setThresholds] = useState(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [snackbar, setSnackbar] = useState({ open: false, severity: 'success', message: '' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/v1/settings/alerts/thresholds')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        if (!cancelled) setThresholds({ ...DEFAULTS, ...data })
      } catch (e) {
        if (!cancelled) setSnackbar({ open: true, severity: 'error', message: e.message || 'Failed to load' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/v1/settings/alerts/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thresholds),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.error || `HTTP ${r.status}`)
      }
      const saved = await r.json()
      setThresholds({ ...DEFAULTS, ...saved })
      setSnackbar({ open: true, severity: 'success', message: t('settings.alertThresholds.saved') })
    } catch (e) {
      setSnackbar({ open: true, severity: 'error', message: e.message || t('settings.alertThresholds.saveError') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Typography variant='h6' fontWeight={700}>{t('settings.alertThresholds.title')}</Typography>
          <Typography variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>
            {t('settings.alertThresholds.description')}
          </Typography>
        </Box>
        <Button
          variant='contained'
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
        >
          {t('common.save')}
        </Button>
      </Box>

      <Typography variant='overline' color='text.secondary' fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 3, mb: 2 }}>
        <i className='ri-bar-chart-box-line' style={{ fontSize: 16 }} />
        {t('alerts.resourceUsage')}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2, mb: 4 }}>
        <ThresholdCard
          icon='ri-cpu-line'
          label={t('alerts.cpu')}
          warning={thresholds.cpu_warning}
          critical={thresholds.cpu_critical}
          onChange={(w, c) => setThresholds(th => ({ ...th, cpu_warning: w, cpu_critical: c }))}
          tWarning={t('alerts.warning')}
          tCritical={t('alerts.critical')}
        />
        <ThresholdCard
          icon='ri-ram-line'
          label={t('alerts.memory')}
          warning={thresholds.memory_warning}
          critical={thresholds.memory_critical}
          onChange={(w, c) => setThresholds(th => ({ ...th, memory_warning: w, memory_critical: c }))}
          tWarning={t('alerts.warning')}
          tCritical={t('alerts.critical')}
        />
        <ThresholdCard
          icon='ri-hard-drive-2-line'
          label={t('alerts.storage')}
          warning={thresholds.storage_warning}
          critical={thresholds.storage_critical}
          onChange={(w, c) => setThresholds(th => ({ ...th, storage_warning: w, storage_critical: c }))}
          tWarning={t('alerts.warning')}
          tCritical={t('alerts.critical')}
        />
      </Box>

      <Typography variant='overline' color='text.secondary' fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <i className='ri-tools-line' style={{ fontSize: 16 }} />
        {t('alerts.maintenance')}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
        <Card variant='outlined' sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-camera-line' style={{ fontSize: 18, opacity: 0.6 }} />
                <Typography variant='subtitle2' fontWeight={700}>{t('alerts.snapshotAge')}</Typography>
              </Box>
              <Switch
                size='small'
                checked={thresholds.snapshot_max_age_days > 0}
                onChange={(_, checked) => setThresholds(th => ({ ...th, snapshot_max_age_days: checked ? 7 : 0 }))}
              />
            </Box>
            <Typography variant='caption' color='text.secondary'>{t('alerts.snapshotAgeDesc')}</Typography>
            {thresholds.snapshot_max_age_days > 0 ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
                <TextField
                  type='number'
                  size='small'
                  value={thresholds.snapshot_max_age_days}
                  onChange={(e) => setThresholds(th => ({ ...th, snapshot_max_age_days: Math.max(1, Number.parseInt(e.target.value) || 1) }))}
                  slotProps={{ htmlInput: { min: 1, max: 365 } }}
                  sx={{ width: 80 }}
                />
                <Typography variant='body2' color='text.secondary'>{t('alerts.snapshotDays')}</Typography>
              </Box>
            ) : (
              <Typography variant='body2' color='text.disabled' sx={{ mt: 2 }}>{t('alerts.snapshotDisabled')}</Typography>
            )}
          </CardContent>
        </Card>
      </Box>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

function ThresholdCard({ icon, label, warning, critical, onChange, tWarning, tCritical }) {
  return (
    <Card variant='outlined' sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <i className={icon} style={{ fontSize: 18, opacity: 0.6 }} />
          <Typography variant='subtitle2' fontWeight={700}>{label}</Typography>
        </Box>
        <Typography variant='caption' color='text.secondary' sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
          {tWarning}: {warning}% · {tCritical}: {critical}%
        </Typography>
        <Slider
          value={[warning, critical]}
          onChange={(_, v) => { const [w, c] = v; onChange(w, c) }}
          valueLabelDisplay='auto'
          valueLabelFormat={(v) => `${v}%`}
          min={50}
          max={100}
          marks={[
            { value: 50, label: '50%' },
            { value: 75, label: '75%' },
            { value: 100, label: '100%' },
          ]}
          sx={{ mt: 2, '& .MuiSlider-markLabel[data-index="0"]': { left: '6% !important' }, '& .MuiSlider-markLabel[data-index="2"]': { left: '94% !important' } }}
        />
      </CardContent>
    </Card>
  )
}
