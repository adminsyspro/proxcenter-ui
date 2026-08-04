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
   Revoke Single Session Confirm Dialog (super-admin, one session)
   (non-destructive — simple confirm, recoverable by signing back in)

   Named RevokeSingleSessionDialog, not RevokeSessionDialog, so it cannot be
   mistaken at a glance (or by grep) for its sibling RevokeSessionsDialog.jsx
   (plural — revokes EVERY session of a user). Getting the two confused
   would silently open the wrong dialog. This one targets exactly one
   session id from the admin-wide sessions listing. Extracted into its own
   file rather than exported from page.jsx for the same reason as its
   sibling — a Next.js page module may only export its default plus
   specific config names, an export there is inert at runtime (the router
   only reads `.default`) and unchecked by tsc (checkJs is off in this
   repo). `t` stays a prop, matching the convention of the page that
   renders it (UsersPage passes t={t} to every dialog).
-------------------------------- */

export default function RevokeSingleSessionDialog({ open, onClose, session, onSuccess, t }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/admin/sessions/${session.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        // Revoking the row this tab is sitting on kills THIS session: every
        // call the page makes from here on will 401. Don't wait for a poller
        // to notice — leave for /login now. Deterministic counterpart of the
        // 401 redirect in useSWRFetch's fetcher, for the one case where the
        // client knows it caused the session's death.
        if (session?.current) {
          redirectToLoginOnce()
          return
        }
        onSuccess(session.id)
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
        {t('sessions.adminRevokeOneConfirmTitle', { email: session?.userEmail || '' })}
      </DialogTitle>
      <DialogContent sx={{ pt: '20px !important' }}>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        {/* The list has no way to hide the caller's own session — it's still
            "every session in the installation" — so a revoke click on that
            row must not be a surprise. Not blocked (a super admin is
            entitled to end their own session), just called out before the
            click. */}
        {session?.current && (
          <Alert severity='warning' sx={{ mb: 2 }}>{t('sessions.adminRevokeOwnConfirmWarning')}</Alert>
        )}
        <Typography>{t('sessions.adminRevokeOneConfirmBody')}</Typography>
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
