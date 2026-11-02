'use client'

import { useState } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField } from '@mui/material'
import { useTranslations } from 'next-intl'

import { DialogErrorLine, ONE_LINE_SX, OneLine } from './dialogParts'

type Props = {
  /** The connection the admin must type. */
  connectionName: string
  busy: boolean
  error: string | null
  /** Starts the removal; it is only called once the name has been typed. */
  onConfirm: () => void
  onCancel: () => void
}

/** Confirmation of the removal of the micro-segmentation: the name of the connection has to be typed, exactly. */
export default function RemoveDialog({ connectionName, busy, error, onConfirm, onCancel }: Props) {
  const t = useTranslations('microsegPilot.settings.remove')
  const tc = useTranslations('common')
  const [typed, setTyped] = useState('')

  return (
    <Dialog open onClose={busy ? undefined : onCancel} maxWidth='sm' fullWidth aria-labelledby='microseg-remove-title'>
      <DialogTitle id='microseg-remove-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <OneLine text={t('body')} />
          <OneLine text={t('tagsKept')} />
          <TextField
            label={t('typeName', { name: connectionName })}
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
        <Button onClick={onConfirm} variant='contained' color='error' disabled={busy || typed !== connectionName}>{t('confirm')}</Button>
      </DialogActions>
    </Dialog>
  )
}
