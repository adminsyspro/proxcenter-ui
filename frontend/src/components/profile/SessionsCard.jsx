'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'

// Returns the browser/OS parts rather than a single joined string, so the
// caller decides how to compose them (separator only when both exist). It
// lives here, not in the shared server-side lib/auth/deviceLabel.ts, because
// the "unknown device" fallback needs next-intl's t(), which only exists
// client-side.
function deviceLabel(row, t) {
  const { browser, os } = row
  if (!browser && !os) return [t('common.unknown')]
  return [browser, os].filter(Boolean)
}

export default function SessionsCard() {
  const t = useTranslations()

  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const [revoking, setRevoking] = useState(null) // session row pending single revoke
  const [revokeAllOpen, setRevokeAllOpen] = useState(false)

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/auth/sessions')
      const data = await res.json()
      if (res.ok) {
        setSessions(Array.isArray(data?.data) ? data.data : [])
      } else {
        setError(data?.error || t('common.error'))
      }
    } catch {
      setError(t('settings.connectionError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { fetchSessions() }, [fetchSessions])

  // ---- Loading -----------------------------------------------------
  if (loading) {
    return (
      <Card variant='outlined'>
        <CardContent sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={20} />
          <Typography variant='body2' color='text.secondary'>
            {t('sessions.cardTitle')}
          </Typography>
        </CardContent>
      </Card>
    )
  }

  // ---- Handlers ------------------------------------------------------

  const handleRevokeOne = async () => {
    const target = revoking
    if (!target) return
    setRevoking(null)
    setActionError('')
    try {
      const res = await fetch(`/api/v1/auth/sessions/${target.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        fetchSessions()
      } else {
        setActionError(data?.error || t('common.error'))
      }
    } catch {
      setActionError(t('settings.connectionError'))
    }
  }

  const handleRevokeAll = async () => {
    setRevokeAllOpen(false)
    setActionError('')
    try {
      // The collection DELETE excludes the current session server-side by
      // design (Task 11's contract): a single click here must never sign the
      // caller out of the screen they are on. Do not "fix" this to also
      // revoke the current session.
      const res = await fetch('/api/v1/auth/sessions', { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        fetchSessions()
      } else {
        setActionError(data?.error || t('common.error'))
      }
    } catch {
      setActionError(t('settings.connectionError'))
    }
  }

  const otherSessionsCount = sessions.filter(s => !s.current).length

  // ---- Render ----------------------------------------------------

  return (
    <>
      <Card variant='outlined'>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, gap: 2, flexWrap: 'wrap' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-device-line' style={{ fontSize: 20, opacity: 0.7 }} />
              <Typography variant='h6' sx={{ fontWeight: 600 }}>
                {t('sessions.cardTitle')}
              </Typography>
            </Box>
            {otherSessionsCount > 0 && (
              <Button
                variant='outlined'
                color='error'
                size='small'
                startIcon={<i className='ri-logout-box-line' />}
                onClick={() => setRevokeAllOpen(true)}
              >
                {t('sessions.revokeAllButton')}
              </Button>
            )}
          </Box>

          {error && (
            <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError('')}>
              {error}
            </Alert>
          )}

          {actionError && (
            <Alert severity='error' sx={{ mb: 2 }} onClose={() => setActionError('')}>
              {actionError}
            </Alert>
          )}

          {sessions.length === 0 ? (
            <Typography variant='body2' color='text.secondary'>
              {t('sessions.empty')}
            </Typography>
          ) : (
            <Stack divider={<Divider />} spacing={2}>
              {sessions.map(row => (
                <Box
                  key={row.id}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
                    <i className='ri-computer-line' style={{ fontSize: 18, opacity: 0.6, marginTop: 2 }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Tooltip title={row.userAgent || t('common.unknown')} slotProps={tooltipSlotProps}>
                          <Typography variant='body2' sx={{ fontWeight: 500 }}>
                            {deviceLabel(row, t).join(' · ')}
                          </Typography>
                        </Tooltip>
                        {row.current && (
                          <Chip label={t('sessions.currentChip')} size='small' color='success' />
                        )}
                      </Box>
                      <Typography variant='caption' color='text.secondary' display='block'>
                        {t('sessions.ipLabel')}: {row.ipAddress || t('common.unknown')}
                      </Typography>
                      <Typography variant='caption' color='text.secondary' display='block'>
                        {t('sessions.lastActiveLabel')}: {row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : t('common.unknown')}
                        {' · '}
                        {t('sessions.signedInLabel')}: {row.createdAt ? new Date(row.createdAt).toLocaleDateString() : t('common.unknown')}
                      </Typography>
                    </Box>
                  </Box>

                  {!row.current && (
                    <Tooltip title={t('sessions.revokeButton')} slotProps={tooltipSlotProps}>
                      <IconButton
                        size='small'
                        aria-label={t('sessions.revokeButton')}
                        onClick={() => setRevoking(row)}
                      >
                        <i className='ri-logout-circle-r-line' />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      {/* Confirm single revoke */}
      <Dialog open={!!revoking} onClose={() => setRevoking(null)} maxWidth='xs' fullWidth>
        <AppDialogTitle
          onClose={() => setRevoking(null)}
          icon={<i className='ri-logout-circle-r-line' style={{ fontSize: 20 }} />}
        >
          {t('sessions.revokeConfirmTitle')}
        </AppDialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant='body2'>{t('sessions.revokeConfirmBody')}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRevoking(null)}>{t('common.cancel')}</Button>
          <Button variant='contained' color='error' onClick={handleRevokeOne}>
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm revoke-all-others */}
      <Dialog open={revokeAllOpen} onClose={() => setRevokeAllOpen(false)} maxWidth='xs' fullWidth>
        <AppDialogTitle
          onClose={() => setRevokeAllOpen(false)}
          icon={<i className='ri-logout-box-line' style={{ fontSize: 20 }} />}
        >
          {t('sessions.revokeAllConfirmTitle')}
        </AppDialogTitle>
        <DialogContent sx={{ pt: 1 }}>
          <Typography variant='body2'>{t('sessions.revokeAllConfirmBody')}</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRevokeAllOpen(false)}>{t('common.cancel')}</Button>
          <Button variant='contained' color='error' onClick={handleRevokeAll}>
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
