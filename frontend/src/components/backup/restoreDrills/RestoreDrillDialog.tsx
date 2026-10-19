'use client'

import { useEffect, useState, type ReactNode } from 'react'

import { useLocale, useTranslations } from 'next-intl'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import NumericTextField from '@/components/ui/NumericTextField'
import { useToast } from '@/contexts/ToastContext'
import {
  buildDrillBody,
  checkLabelKey,
  checkLook,
  snapshotVerifyState,
  type DrillFormState,
  type SnapshotRow,
} from '@/lib/backups/restoreDrills/display'
import { PREFLIGHT_CHECK_KEYS, SETTINGS_RANGES, type Drill, type DrillSettings, type Preflight } from '@/lib/backups/restoreDrills/types'
import { formatDateTime } from '@/lib/i18n/date'
import { formatBytes } from '@/utils/format'

import DrillTargetPicker, { getJson, type DrillTargetFill } from './DrillTargetPicker'
import { spinSx } from './shared'

const P = 'backups.restoreDrills'

const VERIFY_LOOK = {
  ok: { icon: 'ri-checkbox-circle-fill', color: 'success.main', key: `${P}.verify.ok` },
  failed: { icon: 'ri-error-warning-fill', color: 'error.main', key: `${P}.verify.failed` },
  none: { icon: 'ri-subtract-line', color: 'text.disabled', key: `${P}.verify.none` },
} as const

interface RestoreDrillDialogProps {
  open: boolean
  onClose: () => void
  pbsId: string
  backup: SnapshotRow
  onStarted?: (drill: Drill | null) => void
}

export default function RestoreDrillDialog({ open, onClose, pbsId, backup, onStarted }: RestoreDrillDialogProps) {
  const t = useTranslations()
  const locale = useLocale()
  const toast = useToast()

  const [form, setForm] = useState<DrillFormState>({
    connId: '', node: '', storage: '', networkMode: 'link_down', bridge: '',
    restoreTimeoutSec: 14_400, bootTimeoutSec: 600, agentTimeoutSec: 300,
  })
  const [preflight, setPreflight] = useState<(Preflight & { archive?: string }) | null>(null)
  const [preflighting, setPreflighting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (patch: Partial<DrillFormState>) => {
    setForm(f => ({ ...f, ...patch }))
    // Any change makes the last preflight stale: it must run again.
    setPreflight(null)
    setError(null)
  }
  // The picker's own defaults (first cluster, node, storage) keep the last preflight.
  const fillDefaults = (fill: DrillTargetFill) => setForm(f => {
    const patch = fill(f)
    return patch ? { ...f, ...patch } : f
  })

  // Settings: default timeouts and isolation.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      try {
        const s = await getJson<DrillSettings>('/api/v1/backups/restore-drills/settings')
        if (cancelled || !s) return
        setForm(f => ({
          ...f,
          networkMode: s.default_network_mode === 'bridge' && s.default_bridge ? 'bridge' : 'link_down',
          bridge: s.default_bridge || '',
          restoreTimeoutSec: s.restore_timeout_sec || f.restoreTimeoutSec,
          bootTimeoutSec: s.boot_timeout_sec || f.bootTimeoutSec,
          agentTimeoutSec: s.agent_timeout_sec || f.agentTimeoutSec,
        }))
      } catch { /* defaults stay */ }
    })()
    return () => { cancelled = true }
  }, [open])

  const formComplete = !!(form.connId && form.node && form.storage && (form.networkMode === 'link_down' || form.bridge))
  const body = () => buildDrillBody(pbsId, backup, form)

  const runPreflight = async () => {
    setPreflighting(true)
    setError(null)
    setPreflight(null)
    try {
      const res = await fetch('/api/v1/backups/restore-drills/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body()),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setPreflight(json)
      else setError(t(`${P}.preflightError`, { error: json?.error || `HTTP ${res.status}` }))
    } catch (e: any) {
      setError(t(`${P}.preflightError`, { error: e?.message || 'error' }))
    } finally {
      setPreflighting(false)
    }
  }

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/v1/backups/restore-drills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body()),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        toast.success(t(`${P}.started`))
        onStarted?.(json?.drill ?? null)
        onClose()
        return
      }
      // A check that failed between the preflight and the start comes back
      // with the fresh preflight: show it in place of the stale one.
      if (json?.preflight) setPreflight(json.preflight)
      setError(t(`${P}.startError`, { error: json?.error || `HTTP ${res.status}` }))
    } catch (e: any) {
      setError(t(`${P}.startError`, { error: e?.message || 'error' }))
    } finally {
      setStarting(false)
    }
  }

  const name = backup.vmName || `VM ${backup.backupId}`
  const date = backup.backupTime ? formatDateTime(backup.backupTime * 1000, locale) : backup.backupTimeIso || '-'
  const verify = VERIFY_LOOK[snapshotVerifyState(backup)]
  const busy = preflighting || starting

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth='md' aria-labelledby='restore-drill-title'>
      <AppDialogTitle onClose={busy ? undefined : onClose} icon={<i className='ri-lifebuoy-line' style={{ fontSize: 20 }} />}>
        <span id='restore-drill-title'>{t(`${P}.dialogTitle`, { name })}</span>
      </AppDialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5 }}>
            <Summary label={t(`${P}.restorePoint`)} value={date} />
            <Summary label={t(`${P}.source`)} value={`${backup.datastore}${backup.namespace ? ` / ${backup.namespace}` : ''}`} />
            <Summary label={t(`${P}.backupSize`)} value={backup.size ? formatBytes(backup.size) : '-'} />
            <Summary
              label={t(`${P}.pbsVerification`)}
              value={(
                <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                  <Box component='i' className={verify.icon} sx={{ color: verify.color, fontSize: 16 }} />
                  {t(verify.key)}
                </Box>
              )}
            />
          </Box>

          <DrillTargetPicker
            pbsId={pbsId}
            datastore={backup.datastore}
            namespace={backup.namespace || ''}
            value={form}
            onChange={update}
            onDefaults={fillDefaults}
          />

          <Accordion disableGutters variant='outlined' sx={{ '&:before': { display: 'none' } }}>
            <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
              <Typography variant='body2'>{t(`${P}.advanced`)}</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
                <TimeoutField label={t(`${P}.restoreTimeout`)} value={form.restoreTimeoutSec} range={SETTINGS_RANGES.restore_timeout_sec}
                  onChange={v => update({ restoreTimeoutSec: v })} />
                <TimeoutField label={t(`${P}.bootTimeout`)} value={form.bootTimeoutSec} range={SETTINGS_RANGES.boot_timeout_sec}
                  onChange={v => update({ bootTimeoutSec: v })} />
                <TimeoutField label={t(`${P}.agentTimeout`)} value={form.agentTimeoutSec} range={SETTINGS_RANGES.agent_timeout_sec}
                  onChange={v => update({ agentTimeoutSec: v })} />
              </Box>
            </AccordionDetails>
          </Accordion>

          {preflight && (
            <Box>
              <Alert severity={preflight.ok ? 'success' : 'error'} sx={{ mb: 1 }}>
                {preflight.ok
                  ? t(`${P}.preflightOk`, { vmid: String(preflight.temp_vmid || '-'), size: formatBytes(preflight.required_bytes || 0) })
                  : t(`${P}.preflightFailed`)}
              </Alert>
              <Stack spacing={0.5} data-testid='drill-preflight-checks'>
                {(preflight.checks || []).map(check => {
                  const look = checkLook(check.status)
                  const labelKey = checkLabelKey(check.key)
                  return (
                    <Box key={check.key} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                      <Tooltip title={t(look.key)}>
                        <Box component='i' className={look.icon} aria-label={t(look.key)} sx={{ color: look.color, fontSize: 18, mt: '1px', ...spinSx(look.icon) }} />
                      </Tooltip>
                      <Typography variant='body2' sx={{ fontWeight: 600, minWidth: 170 }}>
                        {(PREFLIGHT_CHECK_KEYS as readonly string[]).includes(check.key) ? t(labelKey) : check.key}
                      </Typography>
                      <Typography variant='body2' color='text.secondary' sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                        {check.detail}
                      </Typography>
                    </Box>
                  )
                })}
              </Stack>
            </Box>
          )}

          {error && <Alert severity='error'>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant='outlined' onClick={() => void runPreflight()} disabled={!formComplete || busy}
          startIcon={preflighting ? <CircularProgress size={14} /> : <i className='ri-list-check-3' />}>
          {t(`${P}.runPreflight`)}
        </Button>
        <Button variant='contained' onClick={() => void start()} disabled={!preflight?.ok || busy}
          startIcon={starting ? <CircularProgress size={14} /> : <i className='ri-play-line' />}>
          {t(`${P}.start`)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function Summary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.25, minWidth: 0 }}>
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{label}</Typography>
      <Box sx={{ typography: 'body2', fontWeight: 600, overflowWrap: 'anywhere' }}>{value}</Box>
    </Box>
  )
}

function TimeoutField({ label, value, range, onChange }: {
  label: string
  value: number
  range: readonly [number, number]
  onChange: (v: number) => void
}) {
  return (
    <NumericTextField
      size='small'
      label={label}
      value={value}
      fallback={value}
      min={range[0]}
      max={range[1]}
      onChange={onChange}
    />
  )
}
