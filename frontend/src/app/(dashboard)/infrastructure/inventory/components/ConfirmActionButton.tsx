'use client'

import { ReactNode, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

/**
 * A button whose action is irreversible enough to be confirmed first.
 *
 * The migration panel now carries two of them, the cutover and the hard power
 * off, and they are the same object: an accented button, a small dialog stating
 * what is about to happen, an optional warning, and a busy state while the
 * request is in flight. Written once so the second one cannot drift from the
 * first, and so a third does not arrive as a third copy.
 */
export default function ConfirmActionButton({
  label,
  icon,
  color,
  variant = 'contained',
  size = 'small',
  title,
  body,
  alert,
  onConfirm,
}: {
  label: string
  /** Remix icon class, used on both the button and the dialog badge. */
  icon: string
  color: 'primary' | 'error' | 'warning'
  variant?: 'contained' | 'outlined'
  size?: 'small' | 'medium'
  title: string
  body: ReactNode
  /** Shown as a warning inside the dialog when the action deserves a caveat. */
  alert?: ReactNode
  onConfirm: () => Promise<void>
}) {
  const t = useTranslations()
  const theme = useTheme()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={variant}
        color={color}
        disabled={busy}
        startIcon={<i className={icon} style={{ fontSize: 14 }} />}
        onClick={() => setOpen(true)}
        sx={{ textTransform: 'none' }}
      >
        {label}
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            bgcolor: alpha(theme.palette[color].main, 0.12),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className={icon} style={{ fontSize: 22, color: theme.palette[color].main }} />
          </Box>
          {title}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>{body}</DialogContentText>
          {alert && <Alert severity="warning" sx={{ mt: 2 }}>{alert}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setOpen(false)} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color={color}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            onClick={confirm}
          >
            {label}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
