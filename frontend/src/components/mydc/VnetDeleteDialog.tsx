'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import { Dialog, DialogContent, DialogActions, Button, Alert, Typography, Stack } from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

interface Props {
  vnet: any
  vdcId: string
  onClose: () => void
  onDeleted: () => void
}

export default function VnetDeleteDialog({ vnet, vdcId, onClose, onDeleted }: Props) {
  const t = useTranslations()
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setDeleting(true); setError(null)

    try {
      const segment = vnet.displayName ?? vnet.pveName

      const res = await fetch(
        `/api/v1/vdcs/${encodeURIComponent(vdcId)}/vnets/${encodeURIComponent(segment)}`,
        { method: 'DELETE' }
      )

      const json = await res.json()

      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      onDeleted()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open onClose={deleting ? undefined : onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={onClose}>{t('myVdc.deleteVnetTitle')}</AppDialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Typography>{t('myVdc.deleteVnetConfirm', { name: vnet.displayName ?? vnet.pveName })}</Typography>
          <Typography variant="caption" color="text.secondary">{t('myVdc.deleteVnetHint')}</Typography>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>{t('common.cancel')}</Button>
        <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>{t('common.delete')}</Button>
      </DialogActions>
    </Dialog>
  )
}
