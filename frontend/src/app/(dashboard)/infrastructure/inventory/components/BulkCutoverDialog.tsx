'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Typography } from '@mui/material'

import PagedRows from '@/components/ui/PagedRows'

import { formatDowntimeBudget } from './migrationGuards'

export interface BulkCutoverJob {
  jobId: string
  name: string
  projectedDowntimeSec?: number | null
}

interface SkippedJob { jobId: string; sourceVmName: string | null; status: string; error?: string }

/**
 * Group cutover of a bulk warm migration: the VMs of the batch that wait for
 * their cutover, each with its projected downtime, all selected. The operator
 * unticks the ones to keep replicating and cuts the others over in one request.
 *
 * The request always names the VMs: a VM that reached its hold after the
 * dialog opened was never shown here and must not be cut over by it.
 */
export default function BulkCutoverDialog({ open, batchId, jobs, onClose, onDone }: {
  open: boolean
  batchId: string
  jobs: BulkCutoverJob[]
  onClose: () => void
  /** Called after a request the server accepted, so the caller reads the batch again. */
  onDone: () => void
}) {
  const t = useTranslations()
  const [selected, setSelected] = useState<Set<string>>(() => new Set(jobs.map(j => j.jobId)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<SkippedJob[]>([])

  // Each opening starts from "everything that waits", whatever was left ticked last time.
  useEffect(() => {
    if (!open) return
    setSelected(new Set(jobs.map(j => j.jobId)))
    setError(null)
    setSkipped([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only: the list refreshes under an open dialog
  }, [open])

  const shown = jobs.filter(j => selected.has(j.jobId))
  const all = shown.length === jobs.length && jobs.length > 0
  const toggle = (jobId: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(jobId)) next.delete(jobId)
    else next.add(jobId)
    return next
  })

  const submit = async () => {
    setBusy(true)
    setError(null)
    setSkipped([])
    try {
      const res = await fetch(`/api/v1/migrations/batches/${encodeURIComponent(batchId)}/cutover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: shown.map(j => j.jobId) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d?.error || `HTTP ${res.status}`); return }
      onDone()
      const left: SkippedJob[] = Array.isArray(d?.data?.skipped) ? d.data.skipped : []
      if (left.length > 0) { setSkipped(left); return }
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('inventoryPage.esxiMigration.bulkCutoverTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>{t('inventoryPage.esxiMigration.bulkCutoverBody')}</DialogContentText>
        <FormControlLabel
          sx={{ ml: 0 }}
          control={<Checkbox size="small" checked={all} indeterminate={shown.length > 0 && !all} onChange={() => setSelected(all ? new Set() : new Set(jobs.map(j => j.jobId)))} data-testid="bulk-cutover-all" />}
          label={<Typography variant="body2" fontWeight={600}>{t('common.all')}</Typography>}
        />
        <Box sx={{ maxHeight: 320, overflowY: 'auto' }}>
          <PagedRows items={jobs} testId="bulk-cutover-pager">
            {job => (
              <Box key={job.jobId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-testid={`bulk-cutover-row-${job.jobId}`}>
                <Checkbox size="small" checked={selected.has(job.jobId)} onChange={() => toggle(job.jobId)} slotProps={{ input: { 'aria-label': job.name } }} />
                <i className="ri-computer-line" style={{ fontSize: 14, opacity: 0.7 }} />
                <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{job.name}</Typography>
                {job.projectedDowntimeSec != null && (
                  <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {t('inventoryPage.esxiMigration.bulkCutoverProjected', { downtime: formatDowntimeBudget(job.projectedDowntimeSec) })}
                  </Typography>
                )}
              </Box>
            )}
          </PagedRows>
        </Box>
        {error && <Alert severity="error" sx={{ mt: 1, py: 0 }} data-testid="bulk-cutover-error">{error}</Alert>}
        {skipped.length > 0 && (
          <Alert severity="warning" sx={{ mt: 1, py: 0 }} data-testid="bulk-cutover-skipped">
            {t('inventoryPage.esxiMigration.bulkCutoverSkipped', { names: skipped.map(s => s.sourceVmName || s.jobId).join(', ') })}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t(skipped.length > 0 ? 'common.close' : 'common.back')}</Button>
        <Button variant="contained" color="warning" disabled={busy || shown.length === 0} onClick={submit} data-testid="bulk-cutover-confirm">
          {t('inventoryPage.esxiMigration.bulkCutoverConfirm', { count: shown.length })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
