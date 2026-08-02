'use client'

import { useState } from 'react'

import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'
import { ALL_SCOPE_IDS } from '@/lib/api-tokens/scopes'
import { copyToClipboard } from '@/lib/clipboard'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const EXPIRATION_CHOICES = [
  { value: 'none', labelKey: 'expirationNone', days: null as number | null },
  { value: '30', labelKey: 'expiration30', days: 30 },
  { value: '90', labelKey: 'expiration90', days: 90 },
  { value: '365', labelKey: 'expiration365', days: 365 },
  { value: 'custom', labelKey: 'expirationCustom', days: null as number | null },
]

export default function CreateTokenDialog({ open, onClose, onCreated }: Props) {
  const t = useTranslations('settings.apiTokens')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [expiration, setExpiration] = useState('none')
  const [customDays, setCustomDays] = useState('180')
  const [scopes, setScopes] = useState<string[]>([])
  const [connections, setConnections] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)

  function toggleScope(scope: string) {
    setScopes(prev => (prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]))
  }

  function reset() {
    setName('')
    setDescription('')
    setExpiration('none')
    setCustomDays('180')
    setScopes([])
    setConnections('')
    setError('')
    setSecret('')
    setCopied(false)
  }

  function expiresInDays(): number | null {
    if (expiration === 'custom') {
      const parsed = Number(customDays)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }
    return EXPIRATION_CHOICES.find(c => c.value === expiration)?.days ?? null
  }

  async function handleCreate() {
    setSaving(true)
    setError('')
    try {
      const connectionIds = connections
        .split(',')
        .map(c => c.trim())
        .filter(Boolean)
      const res = await fetch('/api/v1/settings/api-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          scopes,
          connectionIds: connectionIds.length ? connectionIds : null,
          expiresInDays: expiresInDays(),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || t('createError'))
      // ONE-TIME reveal: keep it in local state only, never re-fetchable.
      setSecret(json.data.secret)
      onCreated()
    } catch (e: any) {
      setError(e?.message || t('createError'))
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={secret ? undefined : handleClose} fullWidth maxWidth='sm'>
      <DialogTitle>{secret ? t('reveal.title') : t('dialog.title')}</DialogTitle>
      <DialogContent>
        {secret ? (
          <Stack spacing={2}>
            <Alert severity='warning'>{t('reveal.warning')}</Alert>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
              <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>{secret}</Typography>
              <Tooltip title={copied ? t('reveal.copied') : t('reveal.copy')} slotProps={tooltipSlotProps}>
                <IconButton
                  aria-label={t('reveal.copy')}
                  onClick={async () => setCopied(await copyToClipboard(secret))}
                >
                  <i className='ri-file-copy-line' />
                </IconButton>
              </Tooltip>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity='error'>{error}</Alert>}
            <TextField label={t('dialog.name')} value={name} onChange={e => setName(e.target.value)} fullWidth required />
            <TextField label={t('dialog.description')} value={description} onChange={e => setDescription(e.target.value)} fullWidth />
            <TextField select label={t('dialog.expiration')} value={expiration} onChange={e => setExpiration(e.target.value)} fullWidth>
              {EXPIRATION_CHOICES.map(choice => (
                <MenuItem key={choice.value} value={choice.value}>{t(`dialog.${choice.labelKey}`)}</MenuItem>
              ))}
            </TextField>
            {expiration === 'custom' && (
              <TextField label={t('dialog.customDays')} type='number' value={customDays} onChange={e => setCustomDays(e.target.value)} fullWidth />
            )}
            <Box>
              <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('dialog.scopes')}</Typography>
              {ALL_SCOPE_IDS.map(scope => (
                <FormControlLabel
                  key={scope}
                  control={<Checkbox checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />}
                  label={scope}
                />
              ))}
            </Box>
            <TextField
              label={t('dialog.connections')}
              helperText={t('dialog.connectionsAll')}
              value={connections}
              onChange={e => setConnections(e.target.value)}
              fullWidth
            />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {secret ? (
          <Button variant='contained' onClick={handleClose}>{t('reveal.done')}</Button>
        ) : (
          <>
            <Button onClick={handleClose}>{t('dialog.cancel')}</Button>
            <Button
              variant='contained'
              disabled={saving || !name.trim() || scopes.length === 0}
              onClick={handleCreate}
            >
              {t('dialog.create')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
