'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Stack, TextField, MenuItem, FormControlLabel, Switch, Box, Typography, Alert,
} from '@mui/material'

import DatacenterAssignmentTree, { type AssignmentState } from './DatacenterAssignmentTree'

export interface DatacenterValues {
  id?: string
  name: string
  locationLabel?: string | null
  country?: string | null
  latitude?: number | null
  longitude?: number | null
  pue: number
  electricityPrice: number
  currency: string
  co2Factor: number
  co2CountryPreset?: string | null
  tdpPerCoreW?: number
  wattsPerGbRam?: number
  overheadPerNodeW?: number
  comment?: string | null
  isDefault?: boolean
}

interface Props {
  open: boolean
  initial?: DatacenterValues | null
  onClose: () => void
  onSaved: (dc: DatacenterValues) => void
}

const CO2_COUNTRY_PRESETS: Array<{ key: string; co2Factor: number }> = [
  { key: 'france', co2Factor: 0.052 },
  { key: 'germany', co2Factor: 0.385 },
  { key: 'usa', co2Factor: 0.417 },
  { key: 'uk', co2Factor: 0.233 },
  { key: 'spain', co2Factor: 0.210 },
  { key: 'italy', co2Factor: 0.330 },
  { key: 'poland', co2Factor: 0.650 },
  { key: 'south_korea', co2Factor: 0.415 },
  { key: 'sweden', co2Factor: 0.045 },
  { key: 'norway', co2Factor: 0.020 },
  { key: 'europe_avg', co2Factor: 0.276 },
  { key: 'world_avg', co2Factor: 0.475 },
  { key: 'custom', co2Factor: 0 }, // sentinel — keep current value
]

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD', 'JPY', 'CNY', 'KRW', 'SEK', 'NOK', 'DKK', 'PLN']

export default function DatacenterDialog({ open, initial, onClose, onSaved }: Props) {
  const t = useTranslations()
  const [form, setForm] = useState<DatacenterValues>({
    name: '', locationLabel: '', country: '',
    latitude: null, longitude: null,
    pue: 1.4, electricityPrice: 0.18, currency: 'EUR',
    co2Factor: 0.052, co2CountryPreset: 'france',
    tdpPerCoreW: 10, wattsPerGbRam: 0.375, overheadPerNodeW: 50,
    comment: '',
    isDefault: false,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assignments, setAssignments] = useState<AssignmentState>({ clusters: new Set(), nodes: new Set() })
  const [initialAssignments, setInitialAssignments] = useState<AssignmentState>({ clusters: new Set(), nodes: new Set() })

  useEffect(() => {
    if (initial) {
      setForm({ ...initial })
    } else {
      setForm({
        name: '', locationLabel: '', country: '',
        latitude: null, longitude: null,
        pue: 1.4, electricityPrice: 0.18, currency: 'EUR',
        co2Factor: 0.052, co2CountryPreset: 'france',
        tdpPerCoreW: 10, wattsPerGbRam: 0.375, overheadPerNodeW: 50,
        isDefault: false,
      })
    }
    setError(null)
    // Reset assignments — they'll be repopulated below for an existing DC.
    setAssignments({ clusters: new Set(), nodes: new Set() })
    setInitialAssignments({ clusters: new Set(), nodes: new Set() })
  }, [initial, open])

  // Load existing assignments when editing an existing DC.
  useEffect(() => {
    if (!open || !initial?.id) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/v1/admin/datacenters/${encodeURIComponent(initial.id!)}/assignments`)
        if (!res.ok) return
        const json = await res.json()
        const data = json?.data ?? {}
        const next: AssignmentState = {
          clusters: new Set<string>(Array.isArray(data.clusters) ? data.clusters : []),
          nodes: new Set<string>(
            Array.isArray(data.nodes) ? data.nodes.map((n: any) => `${n.connectionId}|${n.nodeName}`) : [],
          ),
        }
        if (cancelled) return
        setAssignments(next)
        setInitialAssignments({
          clusters: new Set(next.clusters),
          nodes: new Set(next.nodes),
        })
      } catch {
        // ignore — empty state is harmless
      }
    })()
    return () => { cancelled = true }
  }, [open, initial?.id])

  const handleCountryPreset = (preset: string) => {
    const found = CO2_COUNTRY_PRESETS.find(p => p.key === preset)
    setForm(s => ({
      ...s,
      co2CountryPreset: preset,
      co2Factor: preset === 'custom' ? s.co2Factor : (found?.co2Factor ?? s.co2Factor),
    }))
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const url = initial?.id
        ? `/api/v1/admin/datacenters/${encodeURIComponent(initial.id)}`
        : `/api/v1/admin/datacenters`
      const method = initial?.id ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          locationLabel: form.locationLabel || null,
          country: form.country || null,
          latitude: typeof form.latitude === 'number' ? form.latitude : null,
          longitude: typeof form.longitude === 'number' ? form.longitude : null,
          pue: Number(form.pue),
          electricityPrice: Number(form.electricityPrice),
          currency: form.currency,
          co2Factor: Number(form.co2Factor),
          co2CountryPreset: form.co2CountryPreset || null,
          tdpPerCoreW: typeof form.tdpPerCoreW === 'number' ? form.tdpPerCoreW : 10,
          wattsPerGbRam: typeof form.wattsPerGbRam === 'number' ? form.wattsPerGbRam : 0.375,
          overheadPerNodeW: typeof form.overheadPerNodeW === 'number' ? form.overheadPerNodeW : 50,
          comment: form.comment ? form.comment : null,
          isDefault: !!form.isDefault,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

      // Persist assignments after the DC row is in place. We always have an
      // ID at this point — either from the freshly inserted row or from the
      // existing edit target.
      const dcId = (json.data?.id ?? initial?.id) as string | undefined
      if (dcId) {
        const assignRes = await fetch(`/api/v1/admin/datacenters/${encodeURIComponent(dcId)}/assignments`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clusters: [...assignments.clusters],
            nodes: [...assignments.nodes].map(k => {
              const [connectionId, nodeName] = k.split('|')
              return { connectionId, nodeName }
            }),
          }),
        })
        if (!assignRes.ok) {
          const j = await assignRes.json().catch(() => ({}))
          throw new Error(j?.error || `Assignments HTTP ${assignRes.status}`)
        }
      }

      onSaved(json.data)
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {initial?.id ? t('settings.green.dc.editTitle') : t('settings.green.dc.addTitle')}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={t('settings.green.dc.name')}
            value={form.name}
            onChange={e => setForm(s => ({ ...s, name: e.target.value }))}
            required
            autoFocus
            size="small"
          />
          <TextField
            label={t('settings.green.dc.location')}
            value={form.locationLabel ?? ''}
            onChange={e => setForm(s => ({ ...s, locationLabel: e.target.value }))}
            size="small"
          />
          <TextField
            label={t('settings.green.dc.comment')}
            value={form.comment ?? ''}
            onChange={e => setForm(s => ({ ...s, comment: e.target.value }))}
            size="small"
            multiline
            minRows={2}
            maxRows={4}
            placeholder={t('settings.green.dc.commentPlaceholder')}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('settings.green.dc.latitude')}
              type="number"
              value={form.latitude ?? ''}
              onChange={e => setForm(s => ({ ...s, latitude: e.target.value === '' ? null : Number(e.target.value) }))}
              size="small"
              fullWidth
              inputProps={{ step: 0.0001 }}
            />
            <TextField
              label={t('settings.green.dc.longitude')}
              type="number"
              value={form.longitude ?? ''}
              onChange={e => setForm(s => ({ ...s, longitude: e.target.value === '' ? null : Number(e.target.value) }))}
              size="small"
              fullWidth
              inputProps={{ step: 0.0001 }}
            />
          </Stack>

          <Box sx={{ pt: 1 }}>
            <Typography variant="overline" color="text.secondary">{t('settings.green.dc.energySection')}</Typography>
          </Box>
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('settings.green.dc.pue')}
              type="number"
              value={form.pue}
              onChange={e => setForm(s => ({ ...s, pue: Number(e.target.value) }))}
              size="small"
              fullWidth
              required
              inputProps={{ step: 0.01, min: 1.0, max: 3.0 }}
              helperText="1.0 = perfect; typical 1.2–1.6"
            />
            <TextField
              label={t('settings.green.dc.electricityPrice')}
              type="number"
              value={form.electricityPrice}
              onChange={e => setForm(s => ({ ...s, electricityPrice: Number(e.target.value) }))}
              size="small"
              fullWidth
              required
              inputProps={{ step: 0.001, min: 0 }}
            />
            <TextField
              label={t('settings.green.dc.currency')}
              select
              value={form.currency}
              onChange={e => setForm(s => ({ ...s, currency: e.target.value }))}
              size="small"
              sx={{ minWidth: 110 }}
            >
              {CURRENCIES.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Stack>

          <Box sx={{ pt: 1 }}>
            <Typography variant="overline" color="text.secondary">{t('settings.green.dc.co2Section')}</Typography>
          </Box>
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('settings.green.dc.co2CountryPreset')}
              select
              value={form.co2CountryPreset ?? 'custom'}
              onChange={e => handleCountryPreset(e.target.value)}
              size="small"
              fullWidth
            >
              {CO2_COUNTRY_PRESETS.map(p => (
                <MenuItem key={p.key} value={p.key}>
                  {t(`settings.co2Countries.${p.key}` as any)}
                  {p.key !== 'custom' && ` — ${p.co2Factor} kg/kWh`}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('settings.green.dc.co2Factor')}
              type="number"
              value={form.co2Factor}
              onChange={e => setForm(s => ({
                ...s,
                co2Factor: Number(e.target.value),
                co2CountryPreset: 'custom',
              }))}
              size="small"
              fullWidth
              required
              inputProps={{ step: 0.001, min: 0 }}
            />
          </Stack>

          <Box sx={{ pt: 1 }}>
            <Typography variant="overline" color="text.secondary">{t('settings.green.dc.serverSpecsSection')}</Typography>
          </Box>
          <Stack direction="row" spacing={2}>
            <TextField
              label={t('settings.green.dc.tdpPerCore')}
              type="number"
              value={form.tdpPerCoreW ?? ''}
              onChange={e => setForm(s => ({ ...s, tdpPerCoreW: e.target.value === '' ? undefined : Number(e.target.value) }))}
              size="small"
              fullWidth
              inputProps={{ step: 1, min: 1 }}
              helperText={t('settings.green.dc.tdpPerCoreHelp')}
            />
            <TextField
              label={t('settings.green.dc.wattsPerGbRam')}
              type="number"
              value={form.wattsPerGbRam ?? ''}
              onChange={e => setForm(s => ({ ...s, wattsPerGbRam: e.target.value === '' ? undefined : Number(e.target.value) }))}
              size="small"
              fullWidth
              inputProps={{ step: 0.001, min: 0 }}
            />
            <TextField
              label={t('settings.green.dc.overheadPerNode')}
              type="number"
              value={form.overheadPerNodeW ?? ''}
              onChange={e => setForm(s => ({ ...s, overheadPerNodeW: e.target.value === '' ? undefined : Number(e.target.value) }))}
              size="small"
              fullWidth
              inputProps={{ step: 1, min: 0 }}
              helperText={t('settings.green.dc.overheadPerNodeHelp')}
            />
          </Stack>

          <FormControlLabel
            sx={{ pt: 1 }}
            control={
              <Switch
                checked={!!form.isDefault}
                onChange={e => setForm(s => ({ ...s, isDefault: e.target.checked }))}
              />
            }
            label={t('settings.green.dc.markAsDefault')}
          />

          <Box sx={{ pt: 1 }}>
            <Typography variant="overline" color="text.secondary">
              {t('settings.green.dc.assignment.sectionTitle')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t('settings.green.dc.assignment.sectionHint')}
            </Typography>
            <DatacenterAssignmentTree
              disabled={saving}
              state={assignments}
              initialState={initialAssignments}
              onChange={setAssignments}
              currentDcId={initial?.id ?? null}
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !form.name}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
