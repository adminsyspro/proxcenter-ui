'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import {
  Alert,
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
  TableRow,
  Tooltip,
  Typography
} from '@mui/material'

import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

function formatPinnedAt(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

export default function HostKeysCard() {
  const t = useTranslations()
  const { data, error, isLoading, mutate } = useSWR('/api/v1/ssh/host-keys', fetcher)

  const [forgetTarget, setForgetTarget] = useState(null)
  const [forgetting, setForgetting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [actionSuccess, setActionSuccess] = useState('')

  const hosts = Array.isArray(data?.hosts) ? data.hosts : []

  // The source values come from the route ('orchestrator', 'frontend'); an
  // unknown one is shown raw rather than swallowed, so a new store added
  // backend-side never renders as a blank cell.
  const sourceLabel = source => {
    if (source === 'orchestrator') return t('settings.sshHostKeys.sources.orchestrator')
    if (source === 'frontend') return t('settings.sshHostKeys.sources.frontend')
    return source
  }

  const confirmForget = async () => {
    if (!forgetTarget || forgetting) return
    const host = forgetTarget.host
    setForgetting(true)
    setActionError('')
    setActionSuccess('')
    try {
      const res = await fetch(`/api/v1/ssh/host-keys/${encodeURIComponent(host)}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (res.status === 404) {
        // Nothing was pinned any more: the goal is reached, so this is not an
        // error for the operator, only a stale row in front of them.
        setActionSuccess(t('settings.sshHostKeys.forgetNotFound', { host }))
      } else if (!res.ok) {
        setActionError(t('settings.sshHostKeys.forgetFailed', { error: json?.error || `HTTP ${res.status}` }))
      } else if (json?.orchestratorUnavailable) {
        setActionError(t('settings.sshHostKeys.forgetOrchestratorUnavailable', { host }))
      } else {
        setActionSuccess(t('settings.sshHostKeys.forgetSuccess', { host }))
      }
      await mutate()
    } catch (e) {
      setActionError(t('settings.sshHostKeys.forgetFailed', { error: e?.message || String(e) }))
    } finally {
      setForgetting(false)
      setForgetTarget(null)
    }
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <Typography variant='subtitle1' fontWeight={600} gutterBottom>
          {t('settings.sshHostKeys.heading')}
        </Typography>

        <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
          {t('settings.sshHostKeys.description')}
        </Typography>

        {error && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {t('settings.sshHostKeys.loadError')}
          </Alert>
        )}

        {actionError && (
          <Alert severity='error' sx={{ mb: 2 }} onClose={() => setActionError('')}>
            {actionError}
          </Alert>
        )}

        {actionSuccess && (
          <Alert severity='success' sx={{ mb: 2 }} onClose={() => setActionSuccess('')}>
            {actionSuccess}
          </Alert>
        )}

        {!isLoading && !error && data?.orchestratorUnavailable && (
          <Alert severity='warning' sx={{ mb: 2 }}>
            {t('settings.sshHostKeys.orchestratorUnavailable')}
          </Alert>
        )}

        {isLoading && (
          <Stack spacing={1}>
            <Skeleton variant='rounded' height={40} />
            <Skeleton variant='rounded' height={40} />
          </Stack>
        )}

        {!isLoading && !error && hosts.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            {t('settings.sshHostKeys.empty')}
          </Typography>
        )}

        {!isLoading && !error && hosts.length > 0 && (
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell>{t('settings.sshHostKeys.columns.host')}</TableCell>
                <TableCell>{t('settings.sshHostKeys.columns.keyTypes')}</TableCell>
                <TableCell>{t('settings.sshHostKeys.columns.pinnedAt')}</TableCell>
                <TableCell>{t('settings.sshHostKeys.columns.sources')}</TableCell>
                <TableCell align='right'>{t('settings.sshHostKeys.columns.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {hosts.map(h => (
                <TableRow key={h.host}>
                  <TableCell>
                    <Typography variant='body2' sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {h.host}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction='row' spacing={0.5} flexWrap='wrap' useFlexGap>
                      {(h.keyTypes || []).map(kt => (
                        <Chip key={kt} size='small' variant='outlined' label={kt} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Typography variant='caption' color='text.secondary'>
                      {formatPinnedAt(h.pinnedAt)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction='row' spacing={0.5} flexWrap='wrap' useFlexGap>
                      {(h.sources || []).map(s => (
                        <Chip key={s} size='small' label={sourceLabel(s)} />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell align='right'>
                    <Tooltip title={t('settings.sshHostKeys.forget')} slotProps={tooltipSlotProps}>
                      <span>
                        <IconButton
                          size='small'
                          aria-label={t('settings.sshHostKeys.forget')}
                          disabled={forgetting}
                          onClick={() => setForgetTarget(h)}
                        >
                          <i className='ri-delete-bin-line' />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!forgetTarget} onClose={() => !forgetting && setForgetTarget(null)} maxWidth='sm' fullWidth>
        <DialogTitle>
          {t('settings.sshHostKeys.forgetTitle', { host: forgetTarget?.host || '' })}
        </DialogTitle>
        <DialogContent>
          <Alert severity='warning' sx={{ mb: 2 }}>
            {t('settings.sshHostKeys.forgetWarning', { host: forgetTarget?.host || '' })}
          </Alert>
          <Typography variant='body2' color='text.secondary'>
            {t('settings.sshHostKeys.forgetWhen')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForgetTarget(null)} disabled={forgetting}>
            {t('settings.sshHostKeys.cancel')}
          </Button>
          <Button color='error' variant='contained' onClick={confirmForget} disabled={forgetting}>
            {t('settings.sshHostKeys.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
