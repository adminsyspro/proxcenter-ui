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

/* --------------------------------
   Revoke Every Session Confirm Dialog (super-admin, installation-wide)
   (non-destructive — everyone can sign back in right away)

   The collection DELETE excludes the caller's current session server-side
   by design: this is an incident action ("everyone out") and signing the
   operator out mid-incident would slow the response. Their own row stays
   one click away in the listing behind this dialog, with its own warning
   and /login redirect. Do not "fix" this to also revoke the caller.

   Named RevokeEverySessionDialog — "Every" = every user of the
   installation — so it cannot be confused with its siblings
   RevokeSessionsDialog (every session of ONE user) and
   RevokeSingleSessionDialog (one session). `t` stays a prop, matching the
   convention of the page that renders it.
-------------------------------- */

export default function RevokeEverySessionDialog({ open, onClose, onSuccess, t }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/admin/sessions', { method: 'DELETE' })
      if (res.ok) {
        onSuccess()
        onClose()
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
