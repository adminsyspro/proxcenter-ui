'use client'

import { useTranslations } from 'next-intl'
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'

interface Props {
  open: boolean
  title: string
  message: string
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}

/** The confirmation of a deletion: a MUI modal, never a browser dialog. */
export default function DeleteConfirmDialog({ open, title, message, busy, error, onConfirm, onClose }: Readonly<Props>) {
  const t = useTranslations('availability')

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth='xs' fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent sx={{ pt: '20px !important' }}>
        <DialogContentText>{message}</DialogContentText>
        {error && <Alert severity='error' sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button color='error' variant='contained' onClick={onConfirm} disabled={busy}>{t('common.delete')}</Button>
      </DialogActions>
    </Dialog>
  )
}
