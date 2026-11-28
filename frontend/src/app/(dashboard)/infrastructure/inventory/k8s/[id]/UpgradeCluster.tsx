'use client'
import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Select, TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import type { WorkerLayout } from '@/lib/k8s/provisionOrchestrator'
import { nextMinor, upgradeRefusal } from '@/lib/k8s/upgrade'
import { SMALL_SELECT_SX } from '@/components/settings/VdcQuotaRow'

/** Label column of the dialog: every line starts its value there. */
const LABEL_WIDTH = 160

/** What GET /upgrade answers: candidates null when the releases cannot be read. */
interface UpgradeOptions { current: string | null; candidates: string[] | null; path: string[] }

function errorText(t: ReturnType<typeof useTranslations>, code: string | undefined, message?: string): string {
  if (code === 'invalid_request' && message) return t('error.invalid', { message })
  if (code && t.has(`refusal.${code}`)) return t(`refusal.${code}`, { next: '' })
  const key = `error.${code}`
  return code && t.has(key) ? t(key) : t('error.generic')
}

/** The target, chosen among the releases reachable in one step, or typed when they cannot be read. */
function TargetField({ t, current, options, target, onChange }: {
  t: ReturnType<typeof useTranslations>
  current: string
  options: UpgradeOptions | null
  target: string
  onChange: (v: string) => void
}) {
  if (!options) return <CircularProgress size={18} sx={{ mt: 1 }} />
  if (options.candidates?.length === 0) return <Typography sx={{ pt: 1 }} color="text.secondary">{t('upToDate')}</Typography>
  if (options.candidates) {
    return (
      <Select size="small" fullWidth value={target} onChange={e => onChange(e.target.value)} sx={SMALL_SELECT_SX}>
        {options.candidates.map((v, i) => (
          <MenuItem key={v} value={v}>{i === 0 ? t('recommended', { version: v }) : v}</MenuItem>
        ))}
      </Select>
    )
  }
  const refusal = target ? upgradeRefusal(current, target) : null
  const next = nextMinor(current) ?? ''
  return (
    <TextField
      size="small" fullWidth autoFocus value={target} placeholder={current}
      onChange={e => onChange(e.target.value.trim())}
      error={!!refusal}
      helperText={refusal ? t(`refusal.${refusal}`, { next }) : t('targetHelp', { next })}
    />
  )
}

/**
 * Raises the cluster's Kubernetes version. The target is one of the releases
 * reachable in one step (one minor version at most); when the newest release
 * is further, the path to it is shown. The orchestrator upgrades the control
 * plane first, then the workers, one node at a time.
 */
export function UpgradeDialog({
  clusterId, clusterName, layout, onClose, onStarted,
}: {
  clusterId: string
  clusterName: string
  layout: WorkerLayout
  onClose: () => void
  onStarted: () => void
}) {
  const t = useTranslations('kubernetes.upgrade')
  const current = layout.version ?? ''
  const [options, setOptions] = useState<UpgradeOptions | null>(null)
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const singleControlPlane = layout.controlPlane.length === 1

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/upgrade`, { cache: 'no-store' }).catch(() => null)
      const body = (await res?.json().catch(() => null)) as UpgradeOptions | null
      if (cancelled) return
      const loaded = res?.ok && body ? body : { current, candidates: null, path: [] }
      setOptions(loaded)
      setTarget(loaded.candidates?.[0] ?? '')
    })()
    return () => { cancelled = true }
  }, [clusterId, current])

  const upToDate = options?.candidates?.length === 0
  const typedRefusal = options && !options.candidates && target ? upgradeRefusal(current, target) : null
  const canStart = !!target && !typedRefusal && !busy

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/upgrade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: target }),
    }).catch(() => null)
    const body = await res?.json().catch(() => null)
    setBusy(false)
    if (res?.ok) { onStarted(); return }
    setError(errorText(t, body?.error, body?.message))
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('title', { cluster: clusterName })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>{t('current')}</Typography>
            <Typography sx={{ fontWeight: 600 }}>{current}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
            <Typography sx={{ width: LABEL_WIDTH, flexShrink: 0, pt: 1 }}>{t('target')}</Typography>
            <TargetField t={t} current={current} options={options} target={target} onChange={setTarget} />
          </Box>
          {!!options?.path.length && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Typography sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>{t('path')}</Typography>
              <Box>
                <Typography>{[current, ...options.path].join(' → ')}</Typography>
                <Typography variant="caption" color="text.secondary">{t('pathHelp')}</Typography>
              </Box>
            </Box>
          )}
        </Box>
        {!upToDate && <Typography variant="body2" sx={{ mt: 2 }}>{t('how')}</Typography>}
        {!upToDate && singleControlPlane && <Alert severity="warning" sx={{ mt: 1.5 }}>{t('singleControlPlane')}</Alert>}
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button
          variant="contained" onClick={() => { void submit() }} disabled={!canStart}
          startIcon={busy ? <CircularProgress size={14} /> : <i className="ri-arrow-up-circle-line" />}
        >
          {t('start')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
