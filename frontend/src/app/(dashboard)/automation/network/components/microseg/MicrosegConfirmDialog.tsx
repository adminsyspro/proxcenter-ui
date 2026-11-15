'use client'

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack } from '@mui/material'
import { useTranslations } from 'next-intl'

import { DialogErrorLine, ONE_LINE_SX, OneLine } from './dialogParts'
import TruncatedText from './TruncatedText'

/** A line of explanation under the body: an icon and one line of text. */
export type ConfirmInfoLine = { icon: string; text: string }

type Props = {
  open: boolean
  title: string
  /** One line: it is cut with an ellipsis and shown in full as a tooltip. */
  body: string
  /** What the action does, one line each (icon, then text cut with an ellipsis and shown in full as a tooltip). */
  infoLines?: ConfirmInfoLine[]
  confirmLabel: string
  color?: 'primary' | 'warning' | 'error'
  busy?: boolean
  /** A failed confirmation, shown on one line under the body; the dialog stays open. */
  error?: string | null
  /** A second line under the error, such as the wording the server gave. */
  errorDetail?: string | null
  /** Next to Cancel: a way out of the dialog toward what cures the error. */
  extraAction?: { label: string; onClick: () => void }
  onConfirm: () => void
  onCancel: () => void
}

/** Themed confirmation of an action of the Micro-segmentation tab (never a native confirm). */
export default function MicrosegConfirmDialog({ open, title, body, infoLines = [], confirmLabel, color = 'primary', busy = false, error = null, errorDetail = null, extraAction, onConfirm, onCancel }: Props) {
  const t = useTranslations()

  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} maxWidth='sm' fullWidth aria-labelledby='microseg-confirm-title'>
      <DialogTitle id='microseg-confirm-title' sx={ONE_LINE_SX}>
        {title}
      </DialogTitle>
      <DialogContent>
        <TruncatedText text={body} />
        {infoLines.length > 0 && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            {infoLines.map(line => (
              <Box key={line.text} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
                <Box component='i' className={line.icon} aria-hidden sx={{ fontSize: 18, flexShrink: 0, color: 'text.secondary' }} />
                <OneLine text={line.text} />
              </Box>
            ))}
          </Stack>
        )}
        {error && (
          <Stack spacing={1} sx={{ mt: 2 }}>
            <DialogErrorLine message={error} />
            {errorDetail && <OneLine text={errorDetail} />}
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {extraAction && <Button onClick={extraAction.onClick} disabled={busy} sx={{ mr: 'auto' }}>{extraAction.label}</Button>}
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
