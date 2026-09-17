'use client'

import { useState } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { useBasemapSettings } from '@/hooks/useBasemapSettings'
import { isTileTemplate, type BasemapProvider, type BasemapSettings } from '@/lib/map/basemap'

interface SaveResult {
  ok: boolean
  text: string
}

interface BasemapFormProps {
  initial: BasemapSettings
  canEdit: boolean
  onSaved: (result: SaveResult) => void
  refresh: () => Promise<unknown>
}

/**
 * The fields alone, seeded from the stored row. The parent remounts it (via
 * `key`) whenever that row changes, which keeps the initial state honest
 * without an effect that writes state back on every render.
 */
function BasemapForm({ initial, canEdit, onSaved, refresh }: BasemapFormProps) {
  const t = useTranslations()
  const [form, setForm] = useState<BasemapSettings>(initial)
  const [saving, setSaving] = useState(false)

  const lightUrlInvalid = form.provider === 'custom' && form.lightUrl.length > 0 && !isTileTemplate(form.lightUrl)
  const darkUrlInvalid = form.provider === 'custom' && form.darkUrl.length > 0 && !isTileTemplate(form.darkUrl)
  const incomplete = form.provider === 'custom' && !isTileTemplate(form.lightUrl)

  const handleSave = async () => {
    setSaving(true)

    try {
      const res = await fetch('/api/v1/settings/map', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)

        onSaved({ ok: false, text: body?.error || t('settings.basemap.saveFailed') })

        return
      }

      await refresh()
      onSaved({ ok: true, text: t('settings.basemap.saved') })
    } catch (e: any) {
      onSaved({ ok: false, text: e?.message || t('settings.basemap.saveFailed') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Stack spacing={2}>
        <TextField
          select
          size='small'
          fullWidth
          label={t('settings.basemap.provider')}
          value={form.provider}
          disabled={!canEdit}
          onChange={e => setForm(f => ({ ...f, provider: e.target.value as BasemapProvider }))}
        >
          <MenuItem value='osm'>{t('settings.basemap.providerOsm')}</MenuItem>
          <MenuItem value='custom'>{t('settings.basemap.providerCustom')}</MenuItem>
        </TextField>

        {form.provider === 'custom' && (
          <>
            <TextField
              size='small'
              fullWidth
              label={t('settings.basemap.lightUrl')}
              placeholder='https://tiles.example.com/{z}/{x}/{y}.png'
              value={form.lightUrl}
              disabled={!canEdit}
              error={lightUrlInvalid}
              helperText={lightUrlInvalid ? t('settings.basemap.invalidTemplate') : t('settings.basemap.lightUrlHelp')}
              onChange={e => setForm(f => ({ ...f, lightUrl: e.target.value }))}
            />
            <TextField
              size='small'
              fullWidth
              label={t('settings.basemap.darkUrl')}
              placeholder='https://tiles.example.com/dark/{z}/{x}/{y}.png'
              value={form.darkUrl}
              disabled={!canEdit}
              error={darkUrlInvalid}
              helperText={darkUrlInvalid ? t('settings.basemap.invalidTemplate') : t('settings.basemap.darkUrlHelp')}
              onChange={e => setForm(f => ({ ...f, darkUrl: e.target.value }))}
            />
            <TextField
              size='small'
              fullWidth
              label={t('settings.basemap.attribution')}
              value={form.attribution}
              disabled={!canEdit}
              helperText={t('settings.basemap.attributionHelp')}
              onChange={e => setForm(f => ({ ...f, attribution: e.target.value }))}
            />
          </>
        )}
      </Stack>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2 }}>
        <Button
          variant='contained'
          size='small'
          disabled={!canEdit || saving || incomplete || lightUrlInvalid || darkUrlInvalid}
          startIcon={<i className='ri-save-line' />}
          onClick={handleSave}
        >
          {t('common.save')}
        </Button>
      </Box>
    </>
  )
}

/**
 * Instance-wide basemap picker (issue #960).
 *
 * The default, OpenStreetMap, needs no account. 'custom' is what an operator
 * uses to plug a provider they hold a key for, or a tile server of their own
 * on a site with no route to the internet.
 */
export default function BasemapCard() {
  const t = useTranslations()
  const theme = useTheme()
  const { settings, canEdit, isLoading, mutate } = useBasemapSettings()
  const [result, setResult] = useState<SaveResult | null>(null)

  return (
    <Card variant='outlined' sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 0.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-map-2-line' style={{ color: theme.palette.primary.main }} />
          {t('settings.basemap.title')}
        </Typography>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 2 }}>
          {t('settings.basemap.desc')}
        </Typography>

        {!isLoading && !canEdit && (
          <Alert severity='info' sx={{ mb: 2 }}>
            {t('settings.basemap.readOnly')}
          </Alert>
        )}

        {result && (
          <Alert severity={result.ok ? 'success' : 'error'} sx={{ mb: 2 }} onClose={() => setResult(null)}>
            {result.text}
          </Alert>
        )}

        <BasemapForm
          key={`${settings.provider}|${settings.lightUrl}|${settings.darkUrl}|${settings.attribution}`}
          initial={settings}
          canEdit={canEdit && !isLoading}
          onSaved={setResult}
          refresh={mutate}
        />
      </CardContent>
    </Card>
  )
}
