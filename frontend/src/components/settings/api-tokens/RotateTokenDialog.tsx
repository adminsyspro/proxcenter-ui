'use client'

// Rotation of a token, shared by the token grid and the service accounts
// panel: a confirmation, then the new secret shown once. The old secret dies
// with the request, so the dialog stays open on the new one until "Done".
import { useState } from 'react'

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import TokenSecretReveal from './TokenSecretReveal'

type Props = {
  /** The token to rotate; null keeps the dialog closed. */
  token: { id: string; name: string } | null
  /** The rotation endpoint of that token. */
  url: string
  /** What the confirmation says changes and what stays. */
  confirm: string
  onClose: () => void
  /** The secret changed: reload what shows the prefix. */
  onRotated: () => void
  /** The rotation was refused or failed (HTTP status, 0 on a network error); the dialog closes. */
  onRefused: (status: number) => void
}

export default function RotateTokenDialog({ token, url, confirm, onClose, onRotated, onRefused }: Props) {
  const t = useTranslations('settings.apiTokens')
  const [rotating, setRotating] = useState(false)
  const [secret, setSecret] = useState('')

  function close() {
    setSecret('')
    onClose()
  }

  async function rotate() {
    setRotating(true)
    try {
      const res = await fetch(url, { method: 'POST' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.data?.secret) {
        onRefused(res.ok ? 500 : res.status)
        return
      }
      setSecret(json.data.secret)
      onRotated()
    } catch {
      onRefused(0)
    } finally {
      setRotating(false)
    }
  }

  return (
    <Dialog open={!!token} onClose={secret || rotating ? undefined : close} fullWidth maxWidth='sm'>
      <DialogTitle>{secret ? t('reveal.title') : t('rotateTitle', { name: token?.name ?? '' })}</DialogTitle>
      <DialogContent>
        {secret ? <TokenSecretReveal secret={secret} /> : <Typography variant='body2'>{confirm}</Typography>}
      </DialogContent>
      <DialogActions>
        {secret ? (
          <Button variant='contained' onClick={close}>{t('reveal.done')}</Button>
        ) : (
          <>
            <Button onClick={close} disabled={rotating}>{t('dialog.cancel')}</Button>
            <Button color='warning' variant='contained' onClick={() => void rotate()} disabled={rotating}>{t('rotate')}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
