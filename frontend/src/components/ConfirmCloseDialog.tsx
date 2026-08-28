'use client'

import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'

import { useTranslations } from 'next-intl'

interface ConfirmCloseDialogProps {
  open: boolean
  title: string
  message: string
  /** Label of the button that goes ahead with the close. */
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Themed replacement for the native window.confirm() that the update dialogs
 * used before letting the operator close them mid-run. Stacks above the
 * parent dialog; the parent stays open until onConfirm.
 */
export default function ConfirmCloseDialog({ open, title, message, confirmLabel, onConfirm, onCancel }: ConfirmCloseDialogProps) {
  const t = useTranslations()

  return (
    <Dialog open={open} onClose={onCancel} maxWidth='xs' fullWidth aria-labelledby='confirm-close-title'>
      <DialogTitle id='confirm-close-title'>{title}</DialogTitle>
      <DialogContent>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} autoFocus>
          {t('common.cancel')}
        </Button>
        <Button onClick={onConfirm} variant='contained' color='warning'>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
