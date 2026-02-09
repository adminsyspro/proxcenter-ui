'use client'

import React, { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
} from '@mui/material'

// ==================== EDIT SCSI CONTROLLER DIALOG ====================
type EditScsiControllerDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (controller: string) => Promise<void>
  currentController: string
}

export function EditScsiControllerDialog({ open, onClose, onSave, currentController }: EditScsiControllerDialogProps) {
  const t = useTranslations()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [controller, setController] = useState(currentController || 'virtio-scsi-single')

  useEffect(() => {
    if (open) {
      setController(currentController || 'virtio-scsi-single')
    }
  }, [open, currentController])

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      await onSave(controller)
      onClose()
    } catch (e: any) {
      setError(e.message || t('errors.updateError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className="ri-settings-3-line" style={{ fontSize: 24 }} />
        {t('inventory.editScsiController')}
      </DialogTitle>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <FormControl fullWidth size="small" sx={{ mt: 1 }}>
          <InputLabel>Type</InputLabel>
          <Select value={controller} onChange={(e) => setController(e.target.value)} label="Type">
            <MenuItem value="lsi">Default (LSI 53C895A)</MenuItem>
            <MenuItem value="lsi53c895a">LSI 53C895A</MenuItem>
            <MenuItem value="lsi53c810">LSI 53C810</MenuItem>
            <MenuItem value="megasas">MegaRAID SAS 8708EM2</MenuItem>
            <MenuItem value="virtio-scsi-pci">VirtIO SCSI</MenuItem>
            <MenuItem value="virtio-scsi-single">VirtIO SCSI single</MenuItem>
            <MenuItem value="pvscsi">VMware PVSCSI</MenuItem>
          </Select>
        </FormControl>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={20} /> : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
