'use client'

// Settings > Guest file restore: how ProxCenter writes restored files back
// INTO a guest (QEMU guest agent or SSH/SFTP). Own tab, Community (no licence
// gate); the PUT route requires a provider super admin. The settings hold no secret: SSH credentials are typed
// per restore and never persisted.

import { useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

import NumericTextField from '@/components/ui/NumericTextField'
import { useToast } from '@/contexts/ToastContext'

const API = '/api/v1/settings/guest-file-restore'
const MIB = 1024 * 1024

// A small MUI Select renders 38 px against 35.9 px for a small TextField; this
// pins both to the same line height so a row of fields sits level.
const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

type Conflict = 'keep' | 'overwrite' | 'skip'

interface GuestFileRestoreSettings {
  agentEnabled: boolean
  sshEnabled: boolean
  agentMaxBytes: number
  agentParallelWrites: number
  defaultConflict: Conflict
  restoredPrefix: string
  defaultCustomDirLinux: string
  defaultCustomDirWindows: string
  sshConnectTimeoutSec: number
  maxConcurrentJobs: number
  jobRetentionDays: number
  spoolDir: string
  spoolMinFreeBytes: number
  sourceStallTimeoutSec: number
}

const DEFAULTS: GuestFileRestoreSettings = {
  agentEnabled: true,
  sshEnabled: true,
  agentMaxBytes: 1073741824,
  agentParallelWrites: 4,
  defaultConflict: 'keep',
  restoredPrefix: 'RESTORED-',
  defaultCustomDirLinux: '/var/tmp/proxcenter-restore',
  defaultCustomDirWindows: 'C:\\ProxCenter-Restore',
  sshConnectTimeoutSec: 20,
  maxConcurrentJobs: 3,
  jobRetentionDays: 30,
  spoolDir: '',
  spoolMinFreeBytes: 2048 * MIB,
  sourceStallTimeoutSec: 120,
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const text = await r.text()
  let json: any = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // not JSON
  }

  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`)

  return json as T
}

const fetcher = (url: string) => fetchJson<{ data: GuestFileRestoreSettings }>(url)

function prefixError(prefix: string): boolean {
  return prefix.length < 1 || prefix.length > 32 || /[/\\]/.test(prefix)
}

function spoolDirError(dir: string): boolean {
  const v = dir.trim()

  return v !== '' && !v.startsWith('/')
}

export default function GuestFileRestoreTab() {
  const t = useTranslations('guestFileRestore.settings')
  const toast = useToast()
  const { data, error, isLoading, mutate } = useSWR(API, fetcher, { revalidateOnFocus: false })

  // Local edits on top of the saved settings; null = nothing edited.
  const [edits, setEdits] = useState<GuestFileRestoreSettings | null>(null)
  const [saving, setSaving] = useState(false)

  const saved = data?.data ? { ...DEFAULTS, ...data.data } : null
  const form = edits ?? saved ?? DEFAULTS

  const patch = (p: Partial<GuestFileRestoreSettings>) => setEdits({ ...form, ...p })

  const dirty = !!saved && !!edits && JSON.stringify(saved) !== JSON.stringify(edits)
  const invalid = prefixError(form.restoredPrefix) || !form.defaultCustomDirLinux.trim() || !form.defaultCustomDirWindows.trim() || spoolDirError(form.spoolDir)

  const handleSave = async () => {
    setSaving(true)

    try {
      const json = await fetchJson<{ data: GuestFileRestoreSettings }>(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          restoredPrefix: form.restoredPrefix.trim(),
          defaultCustomDirLinux: form.defaultCustomDirLinux.trim(),
          defaultCustomDirWindows: form.defaultCustomDirWindows.trim(),
          spoolDir: form.spoolDir.trim(),
        }),
      })

      await mutate(json, { revalidate: false })
      setEdits(null)
      toast.success(t('saved'))
    } catch (e: any) {
      toast.error(t('saveFailed', { error: e?.message || String(e) }))
    } finally {
      setSaving(false)
    }
  }

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

      {error && <Alert severity='error'>{t('loadError', { error: error.message })}</Alert>}

      {isLoading ? (
        <Stack spacing={1.5}>
          <Skeleton variant='rounded' height={40} />
          <Skeleton variant='rounded' height={40} />
          <Skeleton variant='rounded' height={40} />
        </Stack>
      ) : (
        <>
          <Card variant='outlined'>
            <CardContent>
              <Typography variant='h6' sx={{ mb: 0.5 }}>{t('methodsHeading')}</Typography>
              <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>{t('methodsDescription')}</Typography>
              <Stack spacing={3}>
                <Box>
                  <FormControlLabel
                    control={<Switch checked={form.agentEnabled} onChange={e => patch({ agentEnabled: e.target.checked })} />}
                    label={t('agentEnabled')}
                  />
                  <FormHelperText sx={{ mt: 0 }}>{t('agentEnabledHelper')}</FormHelperText>
                </Box>
                <NumericTextField
                  size='small'
                  type='number'
                  label={t('agentMaxMib')}
                  value={Math.round(form.agentMaxBytes / MIB)}
                  onChange={v => patch({ agentMaxBytes: v * MIB })}
                  fallback={1024}
                  min={1}
                  max={65536}
                  disabled={!form.agentEnabled}
                  helperText={t('agentMaxMibHelper')}
                  sx={{ maxWidth: 360 }}
                />
                <NumericTextField
                  size='small'
                  type='number'
                  label={t('agentParallelWrites')}
                  value={form.agentParallelWrites}
                  onChange={v => patch({ agentParallelWrites: v })}
                  fallback={4}
                  min={1}
                  max={16}
                  disabled={!form.agentEnabled}
                  helperText={t('agentParallelWritesHelper')}
                  sx={{ maxWidth: 360 }}
                />
                <Box>
                  <FormControlLabel
                    control={<Switch checked={form.sshEnabled} onChange={e => patch({ sshEnabled: e.target.checked })} />}
                    label={t('sshEnabled')}
                  />
                  <FormHelperText sx={{ mt: 0 }}>{t('sshEnabledHelper')}</FormHelperText>
                </Box>
                <NumericTextField
                  size='small'
                  type='number'
                  label={t('sshConnectTimeoutSec')}
                  value={form.sshConnectTimeoutSec}
                  onChange={v => patch({ sshConnectTimeoutSec: v })}
                  fallback={20}
                  min={5}
                  max={120}
                  disabled={!form.sshEnabled}
                  helperText={t('sshConnectTimeoutSecHelper')}
                  sx={{ maxWidth: 360 }}
                />
                {!form.agentEnabled && !form.sshEnabled && (
                  <Alert severity='warning'>{t('noMethodWarning')}</Alert>
                )}
              </Stack>
            </CardContent>
          </Card>

          <Card variant='outlined'>
            <CardContent>
              <Typography variant='h6' sx={{ mb: 0.5 }}>{t('transfersHeading')}</Typography>
              <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>{t('transfersDescription')}</Typography>
              <Stack spacing={3}>
                <TextField
                  size='small'
                  label={t('spoolDir')}
                  value={form.spoolDir}
                  onChange={e => patch({ spoolDir: e.target.value })}
                  error={spoolDirError(form.spoolDir)}
                  helperText={spoolDirError(form.spoolDir) ? t('spoolDirInvalid') : t('spoolDirHelper')}
                  disabled={!form.agentEnabled}
                  slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13 } } }}
                />
                <NumericTextField
                  size='small'
                  type='number'
                  label={t('spoolMinFreeMib')}
                  value={Math.round(form.spoolMinFreeBytes / MIB)}
                  onChange={v => patch({ spoolMinFreeBytes: v * MIB })}
                  fallback={2048}
                  min={0}
                  max={1048576}
                  disabled={!form.agentEnabled}
                  helperText={t('spoolMinFreeMibHelper')}
                  sx={{ maxWidth: 360 }}
                />
                <NumericTextField
                  size='small'
                  type='number'
                  label={t('sourceStallTimeoutSec')}
                  value={form.sourceStallTimeoutSec}
                  onChange={v => patch({ sourceStallTimeoutSec: v })}
                  fallback={120}
                  min={10}
                  max={3600}
                  helperText={t('sourceStallTimeoutSecHelper')}
                  sx={{ maxWidth: 360 }}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card variant='outlined'>
            <CardContent>
              <Typography variant='h6' sx={{ mb: 0.5 }}>{t('defaultsHeading')}</Typography>
              <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>{t('defaultsDescription')}</Typography>
              <Stack spacing={3}>
                <FormControl size='small' sx={{ maxWidth: 360, ...SMALL_SELECT_SX }}>
                  <InputLabel>{t('defaultConflict')}</InputLabel>
                  <Select
                    label={t('defaultConflict')}
                    value={form.defaultConflict}
                    onChange={e => patch({ defaultConflict: e.target.value as Conflict })}
                  >
                    <MenuItem value='keep'>{t('conflictKeep')}</MenuItem>
                    <MenuItem value='overwrite'>{t('conflictOverwrite')}</MenuItem>
                    <MenuItem value='skip'>{t('conflictSkip')}</MenuItem>
                  </Select>
                  <FormHelperText>{t('defaultConflictHelper')}</FormHelperText>
                </FormControl>
                <TextField
                  size='small'
                  label={t('restoredPrefix')}
                  value={form.restoredPrefix}
                  onChange={e => patch({ restoredPrefix: e.target.value })}
                  error={prefixError(form.restoredPrefix)}
                  helperText={prefixError(form.restoredPrefix) ? t('restoredPrefixInvalid') : t('restoredPrefixHelper')}
                  sx={{ maxWidth: 360 }}
                />
                <TextField
                  size='small'
                  label={t('defaultCustomDirLinux')}
                  value={form.defaultCustomDirLinux}
                  onChange={e => patch({ defaultCustomDirLinux: e.target.value })}
                  error={!form.defaultCustomDirLinux.trim()}
                  helperText={t('defaultCustomDirLinuxHelper')}
                  slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13 } } }}
                />
                <TextField
                  size='small'
                  label={t('defaultCustomDirWindows')}
                  value={form.defaultCustomDirWindows}
                  onChange={e => patch({ defaultCustomDirWindows: e.target.value })}
                  error={!form.defaultCustomDirWindows.trim()}
                  helperText={t('defaultCustomDirWindowsHelper')}
                  slotProps={{ htmlInput: { spellCheck: false, style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 13 } } }}
                />
              </Stack>
            </CardContent>
          </Card>

          <Card variant='outlined'>
            <CardContent>
              <Typography variant='h6' sx={{ mb: 0.5 }}>{t('jobsHeading')}</Typography>
              <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>{t('jobsDescription')}</Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <NumericTextField
                  size='small'
                  type='number'
                  label={t('maxConcurrentJobs')}
                  value={form.maxConcurrentJobs}
                  onChange={v => patch({ maxConcurrentJobs: v })}
                  fallback={3}
                  min={1}
                  max={20}
                  helperText={t('maxConcurrentJobsHelper')}
                  sx={{ flex: '1 1 240px', maxWidth: 360 }}
                />
                <NumericTextField
                  size='small'
                  type='number'
                  label={t('jobRetentionDays')}
                  value={form.jobRetentionDays}
                  onChange={v => patch({ jobRetentionDays: v })}
                  fallback={30}
                  min={1}
                  max={365}
                  helperText={t('jobRetentionDaysHelper')}
                  sx={{ flex: '1 1 240px', maxWidth: 360 }}
                />
              </Box>
            </CardContent>
          </Card>

          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            <Button disabled={!dirty || saving} onClick={() => setEdits(null)}>
              {t('reset')}
            </Button>
            <Button
              variant='contained'
              onClick={handleSave}
              disabled={!dirty || invalid || saving}
              startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
            >
              {t('save')}
            </Button>
          </Box>
        </>
      )}
    </Stack>
  )
}
