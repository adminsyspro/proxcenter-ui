'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, CircularProgress, Alert
} from '@mui/material'

import type { GuestRef } from '@/hooks/useDiskSnapshotRefs'
import { useDiskSnapshotGuard } from './DiskSnapshotRefsAlert'

interface DeleteUnusedDiskDialogProps {
  open: boolean
  diskId: string
  volume: string
  onClose: () => void
  onConfirm: () => Promise<void>
  /** The guest owning the disk: lets the dialog warn when snapshots still hold it (#1004). */
  guest?: GuestRef | null
  canDeleteSnapshots?: boolean
}

export function DeleteUnusedDiskDialog({ open, diskId, volume, onClose, onConfirm, guest, canDeleteSnapshots = false }: Readonly<DeleteUnusedDiskDialogProps>) {
  const t = useTranslations()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // PVE refuses to remove a volume a snapshot still references.
  const { held: heldBySnapshots, renderAlert } = useDiskSnapshotGuard({ ...guest, open, diskId, canDeleteSnapshots })

  useEffect(() => {
    if (open) {
      setError(null)
      setWorking(false)
    }
  }, [open])

  const handleConfirm = async () => {
    setWorking(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e: any) {
      setError(e?.message || 'Error')
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={open} onClose={working ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: 'error.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="ri-delete-bin-line" style={{ fontSize: 20, color: '#fff' }} />
        </Box>
        {t('hardware.deleteUnusedTitle')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2" sx={{ mb: 1 }}>
          {t('hardware.deleteUnusedConfirm', { volume })}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {diskId}
        </Typography>
        {heldBySnapshots && <Box sx={{ mt: 2 }}>{renderAlert('delete')}</Box>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={working}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color="error"
          onClick={handleConfirm}
          disabled={working || heldBySnapshots}
          startIcon={working ? <CircularProgress size={16} color="inherit" /> : <i className="ri-delete-bin-line" />}
        >
          {t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
