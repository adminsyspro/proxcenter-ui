'use client'

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { DialogErrorLine, ONE_LINE_SX } from './dialogParts'

type Props = {
  open: boolean
  title: string
  /** One line: it is cut with an ellipsis and shown in full as a tooltip. */
  body: string
  confirmLabel: string
  color?: 'primary' | 'warning' | 'error'
  busy?: boolean
  /** A failed confirmation, shown on one line under the body; the dialog stays open. */
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** Themed confirmation of an action of the Micro-segmentation tab (never a native confirm). */
export default function MicrosegConfirmDialog({ open, title, body, confirmLabel, color = 'primary', busy = false, error = null, onConfirm, onCancel }: Props) {
  const t = useTranslations()

  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth='sm' fullWidth aria-labelledby='microseg-confirm-title'>
      <DialogTitle id='microseg-confirm-title' sx={ONE_LINE_SX}>
        {title}
      </DialogTitle>
      <DialogContent>
        <Tooltip title={body}>
          <Typography noWrap>{body}</Typography>
        </Tooltip>
        {error && <DialogErrorLine message={error} />}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={busy} autoFocus>
          {t('common.cancel')}
        </Button>
        <Button onClick={onConfirm} disabled={busy} variant='contained' color={color}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
