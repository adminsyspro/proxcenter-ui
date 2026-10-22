'use client'

// Settings > Guest file restore: how ProxCenter writes restored files back
// INTO a guest (QEMU guest agent or SSH/SFTP). Own tab, Community (no licence
// gate); the PUT route requires a provider super admin. The settings hold no secret: SSH credentials are typed
// per restore and never persisted.

import { useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  InputAdornment,
  MenuItem,
  Skeleton,
  Stack,
  Switch,
  TextField,
  Tooltip,
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

// Every card lays its fields on the same four columns, so fields line up from
// one card to the next.
const FIELD_GRID_SX = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
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
  defaultCustomDirLinux: '~/proxcenter-restore',
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

// Explanations live in tooltips (same glyph as the vDC tab); only a validation
// error is written under a field.
function hintIcon(title: ReactNode) {
  return (
    <Tooltip arrow placement='top' title={title}>
      <Box component='i' className='ri-information-line' sx={{ fontSize: 14, opacity: 0.55, cursor: 'help' }} />
    </Tooltip>
  )
}

// Unit then hint, at the end of the field so every field keeps its full width.
// `insideSelect` leaves room for the dropdown arrow of a Select.
function endAdornment(hint: ReactNode, unit?: string, insideSelect = false) {
  return (
    <InputAdornment position='end' sx={{ gap: 1, mr: insideSelect ? 4 : 0, pointerEvents: 'auto' }}>
      {unit && <Typography variant='body2' color='text.secondary'>{unit}</Typography>}
      {hintIcon(hint)}
    </InputAdornment>
  )
}

function SectionCard({ icon, title, description, action, children }: {
  icon: string
  title: string
  description: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card variant='outlined'>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 3 }}>
          <Box component='i' className={icon} sx={{ fontSize: 20, color: 'primary.main', mt: 0.25 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant='subtitle1' fontWeight={600} lineHeight={1.4}>{title}</Typography>
            <Typography variant='body2' color='text.secondary'>{description}</Typography>
          </Box>
          {action}
        </Box>
        {children}
      </CardContent>
    </Card>
  )
}

export default function GuestFileRestoreTab() {
  const t = useTranslations('guestFileRestore.settings')
  const tg = useTranslations('guestFileRestore')
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
          <SectionCard
            icon='ri-cpu-line'
            title={tg('methodAgent')}
            description={t('agentEnabledHelper')}
            action={
              <Switch
                checked={form.agentEnabled}
                onChange={e => patch({ agentEnabled: e.target.checked })}
                slotProps={{ input: { 'aria-label': t('agentEnabled') } }}
              />
            }
          >
            <Box sx={FIELD_GRID_SX}>
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
                slotProps={{ input: { endAdornment: endAdornment(t('agentMaxMibHelper'), t('unitMib')) } }}
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
                slotProps={{ input: { endAdornment: endAdornment(t('agentParallelWritesHelper')) } }}
              />
              <TextField
                size='small'
                label={t('spoolDir')}
                value={form.spoolDir}
                onChange={e => patch({ spoolDir: e.target.value })}
                error={spoolDirError(form.spoolDir)}
                helperText={spoolDirError(form.spoolDir) ? t('spoolDirInvalid') : undefined}
                disabled={!form.agentEnabled}
                slotProps={{
                  htmlInput: { spellCheck: false },
                  input: { endAdornment: endAdornment(t('spoolDirHelper')) },
                }}
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
                slotProps={{ input: { endAdornment: endAdornment(t('spoolMinFreeMibHelper'), t('unitMib')) } }}
              />
            </Box>
          </SectionCard>

          <SectionCard
            icon='ri-terminal-box-line'
            title={tg('methodSsh')}
            description={t('sshEnabledHelper')}
            action={
              <Switch
                checked={form.sshEnabled}
                onChange={e => patch({ sshEnabled: e.target.checked })}
                slotProps={{ input: { 'aria-label': t('sshEnabled') } }}
              />
            }
          >
            <Box sx={FIELD_GRID_SX}>
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
                slotProps={{ input: { endAdornment: endAdornment(t('sshConnectTimeoutSecHelper'), t('unitSeconds')) } }}
              />
            </Box>
          </SectionCard>

          {!form.agentEnabled && !form.sshEnabled && (
            <Alert severity='warning'>{t('noMethodWarning')}</Alert>
          )}

          <SectionCard icon='ri-equalizer-line' title={t('defaultsHeading')} description={t('defaultsDescription')}>
            <Box sx={FIELD_GRID_SX}>
              <TextField
                select
                size='small'
                label={t('defaultConflict')}
                value={form.defaultConflict}
                onChange={e => patch({ defaultConflict: e.target.value as Conflict })}
                sx={SMALL_SELECT_SX}
                slotProps={{ input: { endAdornment: endAdornment(t('defaultConflictHelper'), undefined, true) } }}
              >
                <MenuItem value='keep'>{t('conflictKeep')}</MenuItem>
                <MenuItem value='overwrite'>{t('conflictOverwrite')}</MenuItem>
                <MenuItem value='skip'>{t('conflictSkip')}</MenuItem>
              </TextField>
              <TextField
                size='small'
                label={t('restoredPrefix')}
                value={form.restoredPrefix}
                onChange={e => patch({ restoredPrefix: e.target.value })}
                error={prefixError(form.restoredPrefix)}
                helperText={prefixError(form.restoredPrefix) ? t('restoredPrefixInvalid') : undefined}
                slotProps={{ input: { endAdornment: endAdornment(t('restoredPrefixHelper')) } }}
              />
              <TextField
                size='small'
                label={t('defaultCustomDirLinux')}
                value={form.defaultCustomDirLinux}
                onChange={e => patch({ defaultCustomDirLinux: e.target.value })}
                error={!form.defaultCustomDirLinux.trim()}
                slotProps={{
                  htmlInput: { spellCheck: false },
                  input: { endAdornment: endAdornment(t('defaultCustomDirLinuxHelper')) },
                }}
              />
              <TextField
                size='small'
                label={t('defaultCustomDirWindows')}
                value={form.defaultCustomDirWindows}
                onChange={e => patch({ defaultCustomDirWindows: e.target.value })}
                error={!form.defaultCustomDirWindows.trim()}
                slotProps={{
                  htmlInput: { spellCheck: false },
                  input: { endAdornment: endAdornment(t('defaultCustomDirWindowsHelper')) },
                }}
              />
            </Box>
          </SectionCard>

          <SectionCard icon='ri-list-check-3' title={t('jobsHeading')} description={t('jobsDescription')}>
            <Box sx={FIELD_GRID_SX}>
              <NumericTextField
                size='small'
                type='number'
                label={t('maxConcurrentJobs')}
                value={form.maxConcurrentJobs}
                onChange={v => patch({ maxConcurrentJobs: v })}
                fallback={3}
                min={1}
                max={20}
                slotProps={{ input: { endAdornment: endAdornment(t('maxConcurrentJobsHelper')) } }}
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
                slotProps={{ input: { endAdornment: endAdornment(t('jobRetentionDaysHelper'), t('unitDays')) } }}
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
                slotProps={{ input: { endAdornment: endAdornment(t('sourceStallTimeoutSecHelper'), t('unitSeconds')) } }}
              />
            </Box>
          </SectionCard>

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
