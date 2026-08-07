'use client'

import { useState } from 'react'

import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useSWRConfig } from 'swr'
import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { SharedTask } from '@/lib/tasks/sharedTask'
import { parseSpeedMBps, etaSeconds, formatEta, stepLabelKey } from '@/lib/tasks/taskProgressDisplay'

type DetailResponse = { data: SharedTask & { logs?: unknown[] } }

export default function SharedTaskDetailDialog({ jobId, onClose }: { jobId: string | null; onClose: () => void }) {
  const t = useTranslations()
  const { mutate } = useSWRConfig()
  const { data, mutate: mutateDetail } = useSWRFetch<DetailResponse>(jobId ? `/api/v1/tasks/shared/${jobId}` : null, { refreshInterval: 5000 })
  const task = data?.data

  // Cancel is the escape hatch for a job whose server process died (#608):
  // the initiator's dialog is gone after a reload, so any viewer must be able
  // to reach the cancel route from here. No client-side permission gate, to
  // match the other migration actions; the server enforces vm.migrate (403).
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const canCancel = !!task && task.kind === 'migration' && !['completed', 'failed', 'cancelled'].includes(task.status)

  // Compact live readout under the progress bar, assembled from fields the
  // SharedTask payload already carries (the warm pipeline keeps currentDisk /
  // bytes / speed up to date). Each piece renders only when its data exists,
  // so a task without transfer telemetry degrades to just the step label.
  const readout: string[] = []
  if (task) {
    const stepKey = stepLabelKey(task.currentStep)
    if (task.currentStep) readout.push(stepKey ? t(`tasks.steps.${stepKey}`) : task.currentStep)
    if (task.currentDisk != null && task.totalDisks) {
      // currentDisk is the pipeline's 0-based loop index.
      readout.push(t('tasks.shared.diskOf', { n: task.currentDisk + 1, m: task.totalDisks }))
    }
    if (task.bytesTransferred != null && task.totalBytes != null) {
      readout.push(t('tasks.shared.gbProgress', {
        done: (task.bytesTransferred / 1073741824).toFixed(1),
        total: (task.totalBytes / 1073741824).toFixed(1),
      }))
    }
    if (task.transferSpeed) readout.push(task.transferSpeed)
    const eta = etaSeconds(task.bytesTransferred, task.totalBytes, parseSpeedMBps(task.transferSpeed))
    if (eta != null) readout.push(t('tasks.shared.eta', { eta: formatEta(eta) }))
  }

  const handleClose = () => {
    setConfirmOpen(false)
    setCancelError(null)
    onClose()
  }

  const cancelJob = async () => {
    setCancelling(true)
    setCancelError(null)
    try {
      const res = await fetch(`/api/v1/migrations/${jobId}/cancel`, { method: 'POST' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        // Includes the 403 from the server-side vm.migrate check. Shown in
        // the detail dialog, so the confirm dialog must not stay on top.
        setCancelError(d.error || t('tasks.shared.cancelFailed'))
        return
      }
      // Refresh both the detail view and the footer list so the row flips to
      // cancelled (or drops out) without a page reload.
      await Promise.all([mutateDetail(), mutate('/api/v1/tasks/shared')])
    } catch (e: any) {
      setCancelError(e?.message || t('tasks.shared.cancelFailed'))
    } finally {
      setCancelling(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
    <Dialog open={!!jobId} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>{task?.label ?? t('tasks.shared.detailTitle')}</span>
        <IconButton onClick={handleClose} size="small"><i className="ri-close-line" /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {!task ? (
          <LinearProgress />
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                size="small"
                label={task.status === 'cancelled' ? t('tasks.status.cancelled') : task.status}
                color={task.status === 'failed' || task.status === 'cancelled' ? 'error' : task.status === 'completed' ? 'success' : 'primary'}
              />
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {t('tasks.shared.startedBy', { name: task.createdByName })}
              </Typography>
            </Box>
            <LinearProgress variant={task.progress > 0 ? 'determinate' : 'indeterminate'} value={task.progress} />
            {readout.length > 0 && (
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {readout.join(' · ')}
              </Typography>
            )}
            {task.error && <Typography variant="body2" color="error">{task.error}</Typography>}
            {cancelError && <Alert severity="error">{cancelError}</Alert>}
            {Array.isArray(task.logs) && task.logs.length > 0 && (
              <Box component="pre" sx={{ fontSize: '0.75rem', maxHeight: 320, overflow: 'auto', bgcolor: 'action.hover', p: 1, borderRadius: 1, whiteSpace: 'pre-wrap' }}>
                {task.logs.map((l: unknown) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      {canCancel && (
        <DialogActions sx={{ px: 3, py: 1.5 }}>
          <Button color="error" onClick={() => setConfirmOpen(true)}>
            {t('tasks.shared.cancelMigration')}
          </Button>
        </DialogActions>
      )}
    </Dialog>

    {/* Confirm Cancel: destructive on a possibly shared job, always ask. */}
    <Dialog open={confirmOpen} onClose={() => { if (!cancelling) setConfirmOpen(false) }} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
        <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
        {t('tasks.shared.cancelConfirmTitle')}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 1.5 }}>
          {t('tasks.shared.cancelConfirmStop')}
        </Typography>
        <Alert severity="warning">
          {t('tasks.shared.cancelConfirmLeftovers')}
        </Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => setConfirmOpen(false)} disabled={cancelling}>
          {t('tasks.shared.cancelConfirmKeep')}
        </Button>
        <Button variant="contained" color="error" onClick={cancelJob} disabled={cancelling}>
          {cancelling ? t('tasks.shared.cancelling') : t('tasks.shared.cancelMigration')}
        </Button>
      </DialogActions>
    </Dialog>
    </>
  )
}
