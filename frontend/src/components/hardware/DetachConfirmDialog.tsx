'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Typography, Button, CircularProgress, Alert
} from '@mui/material'

interface DetachConfirmDialogProps {
  open: boolean
  diskId: string
  onClose: () => void
  onConfirm: () => Promise<void>
}

export function DetachConfirmDialog({ open, diskId, onClose, onConfirm }: DetachConfirmDialogProps) {
  const t = useTranslations()
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
        <Box sx={{ width: 36, height: 36, borderRadius: 1, bgcolor: 'warning.main', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <i className="ri-link-unlink" style={{ fontSize: 20, color: '#fff' }} />
        </Box>
        {t('hardware.detachTitle')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant="body2">
          {t('hardware.detachConfirm', { id: diskId })}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={working}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={handleConfirm}
          disabled={working}
          startIcon={working ? <CircularProgress size={16} color="inherit" /> : <i className="ri-link-unlink" />}
        >
          {t('hardware.detach')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
