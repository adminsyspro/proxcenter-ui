'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import NumericTextField from '@/components/ui/NumericTextField'
import { useToast } from '@/contexts/ToastContext'
import { SETTINGS_RANGES, type DrillSettings, type SettingsRangeKey } from '@/lib/backups/restoreDrills/types'

const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

const P = 'backups.restoreDrills'

const DEFAULTS: DrillSettings = {
  max_concurrent: 1,
  capacity_budget_gb: 0,
  free_space_margin_pct: 10,
  restore_timeout_sec: 14_400,
  boot_timeout_sec: 600,
  agent_timeout_sec: 300,
  default_network_mode: 'link_down',
  default_bridge: '',
  screenshot_delay_sec: 45,
}

const NUMERIC_FIELDS: Array<{ key: SettingsRangeKey; label: string }> = [
  { key: 'max_concurrent', label: 'settings.maxConcurrent' },
  { key: 'capacity_budget_gb', label: 'settings.capacityBudget' },
  { key: 'free_space_margin_pct', label: 'settings.freeSpaceMargin' },
  { key: 'restore_timeout_sec', label: 'restoreTimeout' },
  { key: 'boot_timeout_sec', label: 'bootTimeout' },
  { key: 'agent_timeout_sec', label: 'agentTimeout' },
  { key: 'screenshot_delay_sec', label: 'settings.screenshotDelay' },
]

/** Out-of-range fields of a settings row, by key. */
export function invalidSettingsFields(s: DrillSettings): SettingsRangeKey[] {
  return (Object.keys(SETTINGS_RANGES) as SettingsRangeKey[]).filter(k => {
    const [min, max] = SETTINGS_RANGES[k]
    const v = s[k]
    return !Number.isInteger(v) || v < min || v > max
  })
}

export default function RestoreDrillSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved?: () => void }) {
  const t = useTranslations()
  const toast = useToast()
  const [settings, setSettings] = useState<DrillSettings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Mounted only while open: every opening reads the current row.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/v1/backups/restore-drills/settings', { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok) setSettings({ ...DEFAULTS, ...json })
        else setLoadError(json?.error || `HTTP ${res.status}`)
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || 'error')
      }
    })()
    return () => { cancelled = true }
  }, [])

  const set = (patch: Partial<DrillSettings>) => setSettings(s => (s ? { ...s, ...patch } : s))
  const invalid = settings ? invalidSettingsFields(settings) : []
  const bridgeMissing = settings?.default_network_mode === 'bridge' && !settings.default_bridge.trim()

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/v1/backups/restore-drills/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...settings, default_bridge: settings.default_bridge.trim() }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(t(`${P}.settings.saveError`, { error: json?.error || `HTTP ${res.status}` }))
        return
      }
      toast.success(t(`${P}.settings.saved`))
      onSaved?.()
      onClose()
    } catch (e: any) {
      setSaveError(t(`${P}.settings.saveError`, { error: e?.message || 'error' }))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth='sm'>
      <AppDialogTitle onClose={saving ? undefined : onClose} icon={<i className='ri-settings-3-line' style={{ fontSize: 20 }} />}>
        {t(`${P}.settings.title`)}
      </AppDialogTitle>
      <DialogContent dividers>
        {loadError && <Alert severity='error'>{t(`${P}.settings.loadError`, { error: loadError })}</Alert>}
        {!settings && !loadError && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
        )}
        {settings && (
          <Stack spacing={4}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, columnGap: 2, rowGap: 4 }}>
              {NUMERIC_FIELDS.map(({ key, label }) => {
                const [min, max] = SETTINGS_RANGES[key]
                const bad = invalid.includes(key)
                return (
                  <NumericTextField
                    key={key}
                    size='small'
                    label={t(`${P}.${label}`)}
                    value={settings[key]}
                    fallback={DEFAULTS[key]}
                    onChange={v => set({ [key]: v } as Partial<DrillSettings>)}
                    error={bad}
                    helperText={t(`${P}.settings.range`, { min: String(min), max: String(max) })}
                    slotProps={{ htmlInput: { 'aria-label': t(`${P}.${label}`) } }}
                  />
                )
              })}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <FormControl size='small' fullWidth>
                <InputLabel id='drill-default-network'>{t(`${P}.settings.defaultNetworkMode`)}</InputLabel>
                <Select
                  labelId='drill-default-network'
                  label={t(`${P}.settings.defaultNetworkMode`)}
                  value={settings.default_network_mode}
                  sx={SMALL_SELECT_SX}
                  onChange={e => set({ default_network_mode: e.target.value as DrillSettings['default_network_mode'] })}
                >
                  <MenuItem value='link_down'>{t(`${P}.networkLinkDown`)}</MenuItem>
                  <MenuItem value='bridge'>{t(`${P}.networkBridge`)}</MenuItem>
                </Select>
              </FormControl>
              <TextField
                size='small'
                label={t(`${P}.settings.defaultBridge`)}
                value={settings.default_bridge}
                onChange={e => set({ default_bridge: e.target.value })}
                error={bridgeMissing}
                placeholder='vmbr9'
              />
            </Box>
            {saveError && <Alert severity='error'>{saveError}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant='contained' onClick={() => void save()} disabled={!settings || saving || invalid.length > 0 || bridgeMissing}
          startIcon={saving ? <CircularProgress size={14} /> : undefined}>
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
