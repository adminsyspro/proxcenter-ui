'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useLocale, useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography
} from '@mui/material'

import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'

const ROWS_PER_PAGE = 10

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)

  return r.json()
})

function formatDate(value, locale) {
  if (!value) return '—'
  const d = new Date(value)

  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(locale)
}

// What a row needs from the operator: a key waiting for confirmation (a new
// host, or a changed key next to the trusted one), an automatic pin to
// confirm, or nothing.
function rowState(k) {
  if (k.pendingFingerprint) return k.fingerprint ? 'changed' : 'pending'
  if (k.origin === 'automatic') return 'automatic'

  return 'confirmed'
}

const DOT = { confirmed: 'success.main', automatic: 'info.main', pending: 'warning.main', changed: 'error.main' }

export default function HostKeysCard() {
  const t = useTranslations()
  const locale = useLocale()
  const { data, error, isLoading, mutate } = useSWR('/api/v1/ssh/host-keys', fetcher)

  const [page, setPage] = useState(0)
  const [forgetTarget, setForgetTarget] = useState(null)
  const [trustTarget, setTrustTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  const keys = Array.isArray(data?.keys) ? data.keys : []
  const visible = keys.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)

  const statusLabel = k => {
    const state = rowState(k)

    if (state === 'confirmed') return t('settings.sshHostKeys.status.confirmed', { by: k.confirmedBy || '—', date: formatDate(k.confirmedAt, locale) })

    return t(`settings.sshHostKeys.status.${state}`)
  }

  const run = async (request, success) => {
    setBusy(true)
    setActionError('')
    setActionSuccess('')
    try {
      const res = await request()
      const json = await res.json().catch(() => ({}))

      if (!res.ok) setActionError(t('settings.sshHostKeys.actionFailed', { error: json?.error || `HTTP ${res.status}` }))
      else setActionSuccess(success)
      await mutate()
    } catch (e) {
      setActionError(t('settings.sshHostKeys.actionFailed', { error: e?.message || String(e) }))
    } finally {
      setBusy(false)
      setForgetTarget(null)
      setTrustTarget(null)
    }
  }

  const confirmTrust = () => trustTarget && run(
    () => fetch('/api/v1/ssh/host-keys/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: trustTarget.host, fingerprint: trustTarget.trust })
    }),
    t('settings.sshHostKeys.trustSuccess', { host: trustTarget.host })
  )

  const confirmForget = () => forgetTarget && run(
    () => fetch(`/api/v1/ssh/host-keys/${encodeURIComponent(forgetTarget.host)}`, { method: 'DELETE' }),
    t('settings.sshHostKeys.forgetSuccess', { host: forgetTarget.host })
  )

  return (
    <Card variant='outlined'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} gutterBottom>
          {t('settings.sshHostKeys.heading')}
        </Typography>

        <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
          {t('settings.sshHostKeys.description')}
        </Typography>

        {error && <Alert severity='error' sx={{ mb: 2 }}>{t('settings.sshHostKeys.loadError')}</Alert>}
        {actionError && <Alert severity='error' sx={{ mb: 2 }} onClose={() => setActionError('')}>{actionError}</Alert>}
        {actionSuccess && <Alert severity='success' sx={{ mb: 2 }} onClose={() => setActionSuccess('')}>{actionSuccess}</Alert>}

        {isLoading && (
          <Stack spacing={1}>
            <Skeleton variant='rounded' height={40} />
            <Skeleton variant='rounded' height={40} />
          </Stack>
        )}

        {!isLoading && !error && keys.length === 0 && (
          <Typography variant='body2' color='text.secondary'>{t('settings.sshHostKeys.empty')}</Typography>
        )}

        {!isLoading && !error && keys.length > 0 && (
          <>
            <Table size='small'>
              <TableHead>
                <TableRow>
                  <TableCell>{t('settings.sshHostKeys.columns.host')}</TableCell>
                  <TableCell>{t('settings.sshHostKeys.columns.keyType')}</TableCell>
                  <TableCell>{t('settings.sshHostKeys.columns.fingerprint')}</TableCell>
                  <TableCell>{t('settings.sshHostKeys.columns.status')}</TableCell>
                  <TableCell align='right'>{t('settings.sshHostKeys.columns.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map(k => {
                  const state = rowState(k)
                  const trust = k.pendingFingerprint || (state === 'automatic' ? k.fingerprint : null)

                  return (
                    <TableRow key={`${k.host} ${k.keyType}`}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className='ri-key-2-line' />
                          <Box component='span' sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: DOT[state], flexShrink: 0 }} />
                          <Typography variant='body2'>{k.host}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Typography variant='body2'>{k.keyType}</Typography>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip
                          slotProps={tooltipSlotProps}
                          title={k.pendingFingerprint && k.fingerprint
                            ? t('settings.sshHostKeys.newKeyTooltip', { fingerprint: k.pendingFingerprint })
                            : ''}
                        >
                          <Typography variant='body2'>{k.fingerprint || k.pendingFingerprint}</Typography>
                        </Tooltip>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        <Chip size='small' variant='outlined' label={statusLabel(k)} />
                      </TableCell>
                      <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                        {trust && (
                          <Tooltip title={t('settings.sshHostKeys.trust')} slotProps={tooltipSlotProps}>
                            <span>
                              <IconButton
                                size='small'
                                aria-label={t('settings.sshHostKeys.trust')}
                                disabled={busy || k.legacy}
                                onClick={() => setTrustTarget({ host: k.host, keyType: k.keyType, trust, state })}
                              >
                                <i className='ri-shield-check-line' />
                              </IconButton>
                            </span>
                          </Tooltip>
                        )}
                        <Tooltip title={t('settings.sshHostKeys.forget')} slotProps={tooltipSlotProps}>
                          <span>
                            <IconButton
                              size='small'
                              aria-label={t('settings.sshHostKeys.forget')}
                              disabled={busy}
                              onClick={() => setForgetTarget(k)}
                            >
                              <i className='ri-delete-bin-line' />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {keys.length > ROWS_PER_PAGE && (
              <TablePagination
                component='div'
                count={keys.length}
                page={page}
                onPageChange={(_e, p) => setPage(p)}
                rowsPerPage={ROWS_PER_PAGE}
                rowsPerPageOptions={[ROWS_PER_PAGE]}
              />
            )}
          </>
        )}
      </CardContent>

      <Dialog open={!!trustTarget} onClose={() => !busy && setTrustTarget(null)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('settings.sshHostKeys.trustTitle', { host: trustTarget?.host || '' })}</DialogTitle>
        <DialogContent>
          {trustTarget?.state === 'changed' && (
            <Alert severity='warning' sx={{ mb: 2 }}>{t('settings.sshHostKeys.trustChangedWarning')}</Alert>
          )}
          <Typography variant='body2' sx={{ mb: 1 }}>
            {t('settings.sshHostKeys.trustFingerprint', { keyType: trustTarget?.keyType || '', fingerprint: trustTarget?.trust || '' })}
          </Typography>
          <Typography variant='body2' color='text.secondary'>{t('settings.sshHostKeys.trustHow')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTrustTarget(null)} disabled={busy}>{t('settings.sshHostKeys.cancel')}</Button>
          <Button color='warning' variant='contained' onClick={confirmTrust} disabled={busy}>
            {t('settings.sshHostKeys.trustConfirm')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!forgetTarget} onClose={() => !busy && setForgetTarget(null)} maxWidth='sm' fullWidth>
        <DialogTitle>{t('settings.sshHostKeys.forgetTitle', { host: forgetTarget?.host || '' })}</DialogTitle>
        <DialogContent>
          <Typography variant='body2' color='text.secondary'>
            {t('settings.sshHostKeys.forgetWarning', { host: forgetTarget?.host || '' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForgetTarget(null)} disabled={busy}>{t('settings.sshHostKeys.cancel')}</Button>
          <Button color='error' variant='contained' onClick={confirmForget} disabled={busy}>
            {t('settings.sshHostKeys.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
