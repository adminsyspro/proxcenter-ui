'use client'

// vDC settings, "Moves between vDCs" (#1335): tenant self-service, moves
// copying at once per tenant, bandwidth cap of the copy. One line per
// setting; every change is saved as it is made.

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, Card, CardContent, LinearProgress, Stack, Switch, TextField, Typography } from '@mui/material'

interface Settings {
  tenantSelfService: boolean
  maxConcurrentPerTenant: number
  bwlimitMiBps: number
}

const SETTINGS_URL = '/api/v1/settings/vdc-moves'
const LABEL_WIDTH = 300
const ROW_SX = { display: 'flex', alignItems: 'center', gap: 2, minHeight: 44 } as const
const FIELD_WIDTH = 120

export default function VdcMoveSettings() {
  const t = useTranslations('moveVdc.settings')
  const [settings, setSettings] = useState<Settings | null>(null)
  const [draft, setDraft] = useState<{ max: string; bw: string }>({ max: '', bw: '' })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(SETTINGS_URL, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok || !json?.data) throw new Error(json?.error || `HTTP ${res.status}`)
        if (cancelled) return
        setSettings(json.data)
        setDraft({ max: String(json.data.maxConcurrentPerTenant), bw: String(json.data.bwlimitMiBps) })
      })
      .catch((e: any) => { if (!cancelled) setError(e?.message || String(e)) })

    return () => { cancelled = true }
  }, [])

  const save = async (next: Settings) => {
    setSaved(false)
    try {
      const res = await fetch(SETTINGS_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      // The draft is left alone: the user may already be typing in the next field.
      setSettings(json.data)
      setSaved(true)
      setError('')
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }

  const max = Number(draft.max)
  const bw = Number(draft.bw)
  const maxInvalid = !Number.isInteger(max) || max < 1 || max > 10
  const bwInvalid = !Number.isInteger(bw) || bw < 0 || bw > 100000

  // Every save sends the whole form as it stands now, so two quick edits in a
  // row never send the first field's old value with the second one.
  const formValue = (base: Settings, over: Partial<Settings> = {}): Settings => ({
    ...base,
    ...(maxInvalid ? {} : { maxConcurrentPerTenant: max }),
    ...(bwInvalid ? {} : { bwlimitMiBps: bw }),
    ...over,
  })

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" sx={{ mb: 1 }}>{t('title')}</Typography>
        {error && <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError('')}>{error}</Alert>}
        {!settings ? (
          !error && <LinearProgress />
        ) : (
          <Stack spacing={0.5}>
            <Box sx={ROW_SX}>
              <Typography variant="body2" noWrap sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>{t('selfService')}</Typography>
              <Box sx={{ width: FIELD_WIDTH, flexShrink: 0 }}>
                <Switch
                  size="small"
                  checked={settings.tenantSelfService}
                  onChange={(e) => void save(formValue(settings, { tenantSelfService: e.target.checked }))}
                  slotProps={{ input: { 'aria-label': t('selfService') } }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" noWrap title={t('selfServiceHint')}>{t('selfServiceHint')}</Typography>
            </Box>
            <Box sx={ROW_SX}>
              <Typography variant="body2" noWrap sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>{t('maxConcurrent')}</Typography>
              <TextField
                size="small"
                type="number"
                value={draft.max}
                error={maxInvalid}
                sx={{ width: FIELD_WIDTH, flexShrink: 0 }}
                onChange={(e) => setDraft((d) => ({ ...d, max: e.target.value }))}
                onBlur={() => { if (!maxInvalid && max !== settings.maxConcurrentPerTenant) void save(formValue(settings)) }}
                slotProps={{ htmlInput: { min: 1, max: 10, step: 1, 'aria-label': t('maxConcurrent') } }}
              />
            </Box>
            <Box sx={ROW_SX}>
              <Typography variant="body2" noWrap sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>{t('bwlimit')}</Typography>
              <TextField
                size="small"
                type="number"
                value={draft.bw}
                error={bwInvalid}
                sx={{ width: FIELD_WIDTH, flexShrink: 0 }}
                onChange={(e) => setDraft((d) => ({ ...d, bw: e.target.value }))}
                onBlur={() => { if (!bwInvalid && bw !== settings.bwlimitMiBps) void save(formValue(settings)) }}
                slotProps={{ htmlInput: { min: 0, max: 100000, step: 1, 'aria-label': t('bwlimit') } }}
              />
              <Typography variant="caption" color="text.secondary" noWrap>{t('bwlimitHint')}</Typography>
            </Box>
            {saved && <Typography variant="caption" color="success.main">{t('saved')}</Typography>}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}
