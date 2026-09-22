'use client'

import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

/**
 * The one confirmation asked before stopping anything from a task row (#974).
 *
 * Stopping is destructive and often hits work someone else started, so every
 * surface that offers it (the two tabs of the taskbar, the Task Center table,
 * the migration detail dialog) asks the same question with the same buttons
 * instead of growing its own modal.
 */
export default function StopTaskConfirmDialog({
  open,
  busy = false,
  title,
  body,
  warning,
  confirmLabel,
  keepLabel,
  busyLabel,
  onKeep,
  onConfirm,
}: {
  open: boolean
  busy?: boolean
  title?: string
  body?: string
  warning?: string
  confirmLabel?: string
  keepLabel?: string
  busyLabel?: string
  onKeep: () => void
  onConfirm: () => void
}) {
  const t = useTranslations()

  return (
    <Dialog open={open} onClose={() => { if (!busy) onKeep() }} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
        <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
        {title ?? t('tasks.stop.confirmTitle')}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: warning ? 1.5 : 0 }}>
          {body ?? t('tasks.stop.confirmBody')}
        </Typography>
        {warning && <Alert severity="warning">{warning}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onKeep} disabled={busy}>
          {keepLabel ?? t('tasks.stop.keep')}
        </Button>
        <Button variant="contained" color="error" onClick={onConfirm} disabled={busy}>
          {busy ? busyLabel ?? t('tasks.stop.stopping') : confirmLabel ?? t('tasks.stop.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
