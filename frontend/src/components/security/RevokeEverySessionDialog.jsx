'use client'

import { useState } from 'react'

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material'

import { redirectToLoginOnce } from '@/hooks/useSWRFetch'

/* --------------------------------
   Revoke Every Session Confirm Dialog (super-admin, installation-wide)
   (non-destructive — everyone can sign back in right away)

   The collection DELETE is TOTAL by design (a product call, reversing the
   first version's caller-exception): it revokes the caller's own session
   too, so on success this dialog's only correct move is the same
   deterministic /login redirect every other self-revocation flow uses —
   the page behind it can no longer make an authenticated call.

   Named RevokeEverySessionDialog — "Every" = every user of the
   installation — so it cannot be confused with its siblings
   RevokeSessionsDialog (every session of ONE user) and
   RevokeSingleSessionDialog (one session). `t` stays a prop, matching the
   convention of the page that renders it.
-------------------------------- */

export default function RevokeEverySessionDialog({ open, onClose, t }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/admin/sessions', { method: 'DELETE' })
      if (res.ok) {
        // Every session is gone, this tab's included: the session is dead
        // server-side, nothing here can succeed anymore. Straight to /login,
        // no poller wait.
        redirectToLoginOnce()
        return
      }
      let data = {}
      try { data = await res.json() } catch (_) {}
      setError(data.error || t('common.error'))
    } catch (_) {
      setError(t('errors.connectionError'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setError('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-logout-box-line' />
        {t('sessions.adminRevokeEveryConfirmTitle')}
      </DialogTitle>
      <DialogContent sx={{ pt: '20px !important' }}>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        <Typography>{t('sessions.adminRevokeEveryConfirmBody')}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleConfirm}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
