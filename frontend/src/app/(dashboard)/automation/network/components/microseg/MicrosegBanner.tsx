'use client'

import { useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Paper, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'
import type { MicrosegPolicy } from '@/lib/microseg/types'

import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PendingChangesBar from './PendingChangesBar'
import { formatWhen, stillPaused } from './summaryModel'

type Props = {
  connectionId: string
  policy: MicrosegPolicy
  onOpenPlan?: () => void
}

type Action = 'stop' | 'resume' | 'confirmWrites'

/** What the banner tells after an action went through. `stop` is the emergency stop flag the answer was sent against. */
type Notice = { type: 'leader'; stop: boolean | undefined } | { type: 'confirmed' }

/**
 * Always visible above the sub-tabs: the Emergency stop, the writes held by the cap, the pause and the
 * pending changes (UA4, UA11). The engine state and the coverage are on the page's Dashboard tab.
 */
export default function MicrosegBanner({ connectionId, policy, onOpenPlan }: Props) {
  const t = useTranslations()
  const format = useFormatter()
  const { data: status, error: statusError, reload } = useMicrosegStatus(connectionId)

  // `action` outlives the dialog so its text does not blank out during the closing fade.
  const [action, setAction] = useState<Action>('stop')
  const [open, setOpen] = useState(false)
  const ask = (a: Action) => { setAction(a); setOpen(true) }
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<unknown>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const run = async () => {
    const api = microsegApi(connectionId)
    setBusy(true)
    setActionError(null)
    setNotice(null)
    try {
      if (action === 'confirmWrites') {
        await api.confirmWrites()
        setNotice({ type: 'confirmed' })
      } else {
        const result = await api.emergencyStop(action === 'stop')
        if (result.applied_by === 'leader') setNotice({ type: 'leader', stop: status?.emergency_stop })
      }
      await reload()
    } catch (e) {
      setActionError(e)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }

  const dialog: Record<Action, { title: string; body: string; label: string; color: 'primary' | 'warning' | 'error' }> = {
    stop: { title: t('microsegPilot.stop.title'), body: t('microsegPilot.stop.body'), label: t('microsegPilot.stop.button'), color: 'error' },
    resume: { title: t('microsegPilot.stop.resumeTitle'), body: t('microsegPilot.stop.resumeBody'), label: t('microsegPilot.stop.resume'), color: 'primary' },
    confirmWrites: { title: t('microsegPilot.banner.confirmWritesTitle'), body: t('microsegPilot.banner.confirmWritesBody'), label: t('microsegPilot.banner.confirmWrites'), color: 'warning' },
  }

  // "Applied by the leader within a minute" is over once the status has moved.
  const shownNotice = notice?.type === 'leader' && notice.stop !== undefined && status && notice.stop !== status.emergency_stop ? null : notice
  const pausedUntil = status?.engine.paused_until
  const paused = stillPaused(pausedUntil)

  return (
    <Paper variant='outlined' sx={{ p: 2, mb: 2 }}>
      {status?.emergency_stop && (
        <Alert
          severity='error'
          variant='filled'
          sx={{ mb: 2 }}
          action={<Button color='inherit' size='small' onClick={() => ask('resume')}>{t('microsegPilot.stop.resume')}</Button>}
        >
          {t('microsegPilot.stop.active')}
        </Alert>
      )}

      {status?.engine.held && (
        <Alert
          severity='warning'
          sx={{ mb: 2 }}
          action={<Button color='inherit' size='small' onClick={() => ask('confirmWrites')}>{t('microsegPilot.banner.confirmWrites')}</Button>}
        >
          <Typography variant='body2' component='span' sx={{ fontWeight: 600, mr: 1 }}>{t('microsegPilot.banner.held')}</Typography>
          {t('microsegPilot.banner.heldBody')}
        </Alert>
      )}

      {shownNotice?.type === 'leader' && <Alert severity='info' sx={{ mb: 2 }} onClose={() => setNotice(null)}>{t('microsegPilot.stop.appliedByLeader')}</Alert>}
      {shownNotice?.type === 'confirmed' && <Alert severity='success' sx={{ mb: 2 }} onClose={() => setNotice(null)}>{t('microsegPilot.banner.writesConfirmed')}</Alert>}
      {actionError != null && <MicrosegErrorAlert error={actionError} onClose={() => setActionError(null)} />}
      {statusError && !status && <MicrosegErrorAlert error={statusError} onRetry={reload} />}

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 4 }}>
        {!status && !statusError && <CircularProgress size={20} aria-label={t('microsegPilot.loading')} />}
        {paused && pausedUntil && (
          <Chip
            size='small'
            color='warning'
            icon={<i className='ri-pause-circle-line' />}
            label={t('microsegPilot.banner.pausedUntil', { time: formatWhen(format, pausedUntil) })}
          />
        )}

        {statusError && status && (
          <Chip size='small' color='warning' variant='outlined' icon={<i className='ri-wifi-off-line' />} label={t('microsegPilot.banner.statusStale')} />
        )}

        {/* Reachable whatever the status: the stop is idempotent, and it is needed most when the engine misbehaves. */}
        {!status?.emergency_stop && (
          <Button
            sx={{ ml: 'auto' }}
            size='small'
            variant='outlined'
            color='error'
            startIcon={<i className='ri-stop-circle-line' />}
            onClick={() => ask('stop')}
          >
            {t('microsegPilot.stop.button')}
          </Button>
        )}
      </Box>

      <PendingChangesBar connectionId={connectionId} policy={policy} onOpenPlan={onOpenPlan} />

      <MicrosegConfirmDialog
        open={open}
        title={dialog[action].title}
        body={dialog[action].body}
        confirmLabel={dialog[action].label}
        color={dialog[action].color}
        busy={busy}
        onConfirm={run}
        onCancel={() => setOpen(false)}
      />
    </Paper>
  )
}
