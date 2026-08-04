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
   Revoke Sessions Confirm Dialog
   (non-destructive — simple confirm, recoverable by signing back in)

   Extracted out of the admin users page (rather than exported from
   page.jsx) so it can be tested in isolation: Next.js only allows a
   page module to export config/metadata/viewport helpers, never a named
   component — an export there is inert at runtime (the router only
   reads `.default`) and unchecked by tsc (checkJs is off in this repo).
   `t` stays a prop, matching the convention of the page that renders it
   (UsersPage passes t={t} to every dialog), not the profile cards'
   useTranslations() pattern.
-------------------------------- */

export default function RevokeSessionsDialog({ open, onClose, user, onSuccess, t, currentUserId }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}/sessions`, {
        method: 'DELETE',
      })
      if (res.ok) {
        // "Every session of user X" includes the caller's own when X is the
        // caller: this tab's session is already revoked server-side. Navigate
        // now instead of letting the page 401 until a poller reacts.
        if (user?.id && user.id === currentUserId) {
          redirectToLoginOnce()
          return
        }
        onSuccess(user.id)
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
        {t('sessions.adminRevokeConfirmTitle', { email: user?.email || '' })}
      </DialogTitle>
      <DialogContent sx={{ pt: '20px !important' }}>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        <Typography>{t('sessions.adminRevokeConfirmBody')}</Typography>
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
