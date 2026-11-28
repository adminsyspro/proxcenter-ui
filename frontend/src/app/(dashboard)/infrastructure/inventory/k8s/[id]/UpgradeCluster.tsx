'use client'
import { useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import type { WorkerLayout } from '@/lib/k8s/provisionOrchestrator'
import { nextMinor, upgradeRefusal } from '@/lib/k8s/upgrade'

/** Label column of the dialog: every line starts its value there. */
const LABEL_WIDTH = 160

function errorText(t: ReturnType<typeof useTranslations>, code: string | undefined, message?: string): string {
  if (code === 'invalid_request' && message) return t('error.invalid', { message })
  if (code && t.has(`refusal.${code}`)) return t(`refusal.${code}`, { next: '' })
  const key = `error.${code}`
  return code && t.has(key) ? t(key) : t('error.generic')
}

/**
 * Raises the cluster's Kubernetes version. The orchestrator upgrades the
 * control plane first, then the workers, one node at a time.
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
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refusal = target ? upgradeRefusal(current, target) : null
  const singleControlPlane = layout.controlPlane.length === 1

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
            <TextField
              size="small" fullWidth autoFocus value={target}
              placeholder={current}
              onChange={e => setTarget(e.target.value.trim())}
              error={!!refusal}
              helperText={refusal ? t(`refusal.${refusal}`, { next: nextMinor(current) ?? '' }) : t('targetHelp', { next: nextMinor(current) ?? '' })}
            />
          </Box>
        </Box>
        <Typography variant="body2" sx={{ mt: 2 }}>{t('how')}</Typography>
        {singleControlPlane && <Alert severity="warning" sx={{ mt: 1.5 }}>{t('singleControlPlane')}</Alert>}
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button
          variant="contained" onClick={() => { void submit() }} disabled={busy || !target || !!refusal}
          startIcon={busy ? <CircularProgress size={14} /> : <i className="ri-arrow-up-circle-line" />}
        >
          {t('start')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
