'use client'

// Live change of the copy rate cap (lib/migration/warm/copy-rate) of a single
// warm migration or of a batch. Every running copy picks the change up within
// one round of its governor (10 s).

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Typography } from '@mui/material'

import CopyRateLimitFields from '@/components/migration/CopyRateLimitFields'
import type { CopyRateLimit } from '@/lib/migration/warm/copy-rate'

export interface CopyRateTarget {
  /** Where the cap lives: the batch's row, or the single migration's config. */
  scope: 'job' | 'batch'
  jobId?: string
  batchId?: string | null
  copyRateLimit: CopyRateLimit | null
  perHostMbps: number | null
  /** Share the migration copies at right now, null while it does not copy. */
  effectiveMbps: number | null
}

export default function CopyRateDialog({ target, onClose, onDone }: Readonly<{
  target: CopyRateTarget
  onClose: () => void
  onDone?: () => void
}>) {
  const t = useTranslations()
  const [value, setValue] = useState<CopyRateLimit | null>(target.copyRateLimit)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [valid, setValid] = useState(true)
  const batch = target.scope === 'batch'
  const rateText = (mbps: number) => (mbps > 0 ? `${mbps} ${t('copyRate.unit')}` : t('copyRate.unlimited'))

  const send = async (copyRateLimit: CopyRateLimit | null) => {
    setBusy(true)
    setError(null)
    try {
      const res = batch
        ? await fetch(`/api/v1/migrations/batches/${encodeURIComponent(target.batchId || '')}/copy-rate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ copyRateLimit }),
          })
        : await fetch(`/api/v1/migrations/${encodeURIComponent(target.jobId || '')}/copy-rate`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ copyRateLimit }),
          })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(d?.error || `HTTP ${res.status}`)
        return
      }
      onDone?.()
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t(batch ? 'copyRate.dialogTitleBatch' : 'copyRate.dialogTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1.5 }}>{t(batch ? 'copyRate.dialogBodyBatch' : 'copyRate.dialogBody')}</DialogContentText>
        <CopyRateLimitFields value={value} onChange={setValue} shared={batch} disabled={busy} onValidityChange={setValid} />
        {target.effectiveMbps !== null && (
          <Typography variant="body2" sx={{ mt: 1.5 }} data-testid="copy-rate-in-force">
            {t('copyRate.inForce', { rate: rateText(target.effectiveMbps) })}
          </Typography>
        )}
        {target.perHostMbps !== null && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('copyRate.perHostNote', { rate: rateText(target.perHostMbps) })}
          </Typography>
        )}
        {error && <Alert severity="error" sx={{ mt: 1.5, py: 0 }} data-testid="copy-rate-error">{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => send(null)} disabled={busy} sx={{ mr: 'auto', textTransform: 'none' }} data-testid="copy-rate-remove">
          {t('copyRate.remove')}
        </Button>
        <Button onClick={onClose} disabled={busy}>{t('common.back')}</Button>
        <Button variant="contained" disabled={busy || !valid} onClick={() => send(value)} data-testid="copy-rate-confirm">
          {t('copyRate.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
