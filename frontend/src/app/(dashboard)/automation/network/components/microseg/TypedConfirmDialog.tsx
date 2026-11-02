'use client'

import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import { useTranslations } from 'next-intl'

import { DialogErrorLine, ONE_LINE_SX, OneLine } from './dialogParts'

type Props = {
  title: string
  /** Each line of explanation, on one line (ellipsis, full text as tooltip). */
  lines: string[]
  /** Label of the input; the admin has to type `expected`, exactly. */
  inputLabel: string
  expected: string
  confirmLabel: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** A confirmation that is only given by typing a name: for an action that cannot be taken back easily. */
export default function TypedConfirmDialog({ title, lines, inputLabel, expected, confirmLabel, busy = false, error = null, onConfirm, onCancel }: Props) {
  const tc = useTranslations('common')
  const [typed, setTyped] = useState('')

  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth='sm' fullWidth aria-labelledby='microseg-typed-confirm-title'>
      <DialogTitle id='microseg-typed-confirm-title' sx={ONE_LINE_SX}>{title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {lines.map(line => <OneLine key={line} text={line} />)}
          <TextField
            label={inputLabel}
            value={typed}
            onChange={e => setTyped(e.target.value)}
            disabled={busy}
            size='small'
            fullWidth
            autoFocus
            autoComplete='off'
          />
          {error && <DialogErrorLine message={error} />}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={busy}>{tc('cancel')}</Button>
        <Button onClick={onConfirm} variant='contained' color='error' disabled={busy || typed !== expected}>{confirmLabel}</Button>
      </DialogActions>
    </Dialog>
  )
}
