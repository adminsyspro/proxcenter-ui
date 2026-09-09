'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'

type DetachTarget = { connId: string; connName?: string | null; storage: string }

type DetachPbsStorageDialogProps = {
  /** Mounted by the parent only while a storage is being detached, so its
   *  state starts clean on every open without a reset effect. */
  target: DetachTarget
  onClose: () => void
  onDetached: () => void
}

/** What became of the scoped token, mapped to the message the operator reads. */
const TOKEN_MESSAGES: Record<string, { key: string; severity: 'success' | 'info' | 'warning' }> = {
  revoked: { key: 'storage.attachPbs.detachTokenRevoked', severity: 'success' },
  'kept-in-use': { key: 'storage.attachPbs.detachTokenKept', severity: 'info' },
  'kept-unmanaged': { key: 'storage.attachPbs.detachTokenUnmanaged', severity: 'info' },
  'kept-unknown-pbs': { key: 'storage.attachPbs.detachTokenUnknownPbs', severity: 'info' },
  'revoke-failed': { key: 'storage.attachPbs.detachTokenRevokeFailed', severity: 'warning' },
}

export default function DetachPbsStorageDialog({ target, onClose, onDetached }: DetachPbsStorageDialogProps) {
  const t = useTranslations()

  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<{ token: string; usedBy?: string[] } | null>(null)

  const detach = async () => {
    setWorking(true)
    setError(null)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(target.connId)}/storage/${encodeURIComponent(target.storage)}`,
        { method: 'DELETE' },
      )

      const json = await res.json()

      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

      // The storage is gone either way, so the list is refreshed before the
      // operator dismisses the token verdict.
      setOutcome({ token: String(json?.data?.token ?? ''), usedBy: json?.data?.usedBy ?? [] })
      onDetached()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setWorking(false)
    }
  }

  const verdict = outcome ? TOKEN_MESSAGES[outcome.token] : null

  return (
    <Dialog open onClose={working ? undefined : onClose} maxWidth='xs' fullWidth>
      <DialogTitle>
        {t('storage.attachPbs.detachTitle', { storage: target.storage })}
      </DialogTitle>
      <DialogContent>
        {outcome ? (
          <Alert severity={verdict?.severity ?? 'info'}>
            {verdict
              ? t(verdict.key as any, { clusters: (outcome.usedBy ?? []).join(', ') })
              : t('storage.attachPbs.detachTokenUnmanaged')}
          </Alert>
        ) : (
          <>
            <Typography variant='body2'>{t('storage.attachPbs.detachWarning')}</Typography>
            {target.connName && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant='caption' sx={{ opacity: 0.6 }}>
                  {t('storage.attachPbs.cluster')}: {target.connName}
                </Typography>
              </Box>
            )}
            {error && <Alert severity='error' sx={{ mt: 2 }}>{error}</Alert>}
          </>
        )}
      </DialogContent>
      <DialogActions>
        {outcome ? (
          <Button variant='contained' onClick={onClose}>{t('common.close')}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={working}>{t('common.cancel')}</Button>
            <Button
              variant='contained'
              color='error'
              onClick={detach}
              disabled={working}
              startIcon={working ? <CircularProgress size={16} color='inherit' /> : <Box component='i' className='ri-link-unlink' />}
            >
              {t('storage.attachPbs.detach')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
