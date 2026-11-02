'use client'

import { Alert, Box, Button, Chip, Paper, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegPolicy } from '@/lib/microseg/types'

import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PendingChangesBar from './PendingChangesBar'
import { formatWhen, stillPaused } from './summaryModel'
import type { ControlAction, MicrosegControls } from './useMicrosegControls'
import { NOW_REFRESH_MS, useNow } from './useNow'

type Props = {
  connectionId: string
  policy: MicrosegPolicy
  controls: MicrosegControls
  onOpenPlan?: () => void
}

/**
 * Above the sub-tabs, only when something needs the reader: the emergency stop in force, the writes held by the
 * cap, the pause, a stale status, the outcome of an action and the pending changes (UA4, UA11). With none of them
 * nothing is drawn, not even an empty strip (UA27). The Emergency stop button is in the sub-tabs row; the engine
 * state and the coverage are on the page's Dashboard tab. The confirmation dialog is always mounted here.
 */
export default function MicrosegBanner({ connectionId, policy, controls, onOpenPlan }: Props) {
  const t = useTranslations()
  const format = useFormatter()
  const { status, statusError, reload, action, open, busy, actionError, notice } = controls

  const dialog: Record<ControlAction, { title: string; body: string; label: string; color: 'primary' | 'warning' | 'error' }> = {
    stop: { title: t('microsegPilot.stop.title'), body: t('microsegPilot.stop.body'), label: t('microsegPilot.stop.button'), color: 'error' },
    resume: { title: t('microsegPilot.stop.resumeTitle'), body: t('microsegPilot.stop.resumeBody'), label: t('microsegPilot.stop.resume'), color: 'primary' },
    confirmWrites: { title: t('microsegPilot.banner.confirmWritesTitle'), body: t('microsegPilot.banner.confirmWritesBody'), label: t('microsegPilot.banner.confirmWrites'), color: 'warning' },
  }

  // "Applied by the leader within a minute" is over once the status has moved.
  const shownNotice = notice?.type === 'leader' && notice.stop !== undefined && status && notice.stop !== status.emergency_stop ? null : notice
  const now = useNow(NOW_REFRESH_MS, status)
  const pausedUntil = status?.engine.paused_until
  const pausedShown = !!pausedUntil && stillPaused(pausedUntil, now)
  const stale = !!statusError && !!status
  const statusFailed = !!statusError && !status

  const hasContent = !!status?.emergency_stop || !!status?.engine.held || !!shownNotice || actionError != null
    || statusFailed || stale || pausedShown || !!policy.pending_changes

  return (
    <>
      {hasContent && (
        <Paper variant='outlined' sx={{ p: 2, mb: 2, '& > *:not(:last-child)': { mb: 2 }, '& > *:last-child': { mb: 0 } }}>
          {status?.emergency_stop && (
            <Alert
              severity='error'
              variant='filled'
              action={<Button color='inherit' size='small' onClick={() => controls.ask('resume')}>{t('microsegPilot.stop.resume')}</Button>}
            >
              {t('microsegPilot.stop.active')}
            </Alert>
          )}

          {status?.engine.held && (
            <Alert
              severity='warning'
              action={<Button color='inherit' size='small' onClick={() => controls.ask('confirmWrites')}>{t('microsegPilot.banner.confirmWrites')}</Button>}
            >
              <Typography variant='body2' component='span' sx={{ fontWeight: 600, mr: 1 }}>{t('microsegPilot.banner.held')}</Typography>
              {t('microsegPilot.banner.heldBody')}
            </Alert>
          )}

          {shownNotice?.type === 'leader' && <Alert severity='info' onClose={controls.clearNotice}>{t('microsegPilot.stop.appliedByLeader')}</Alert>}
          {shownNotice?.type === 'confirmed' && <Alert severity='success' onClose={controls.clearNotice}>{t('microsegPilot.banner.writesConfirmed')}</Alert>}
          {actionError != null && <MicrosegErrorAlert error={actionError} onClose={controls.clearActionError} />}
          {statusFailed && <MicrosegErrorAlert error={statusError} onRetry={reload} />}

          {(pausedShown || stale) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 4 }}>
              {pausedShown && (
                <Chip
                  size='small'
                  color='warning'
                  icon={<i className='ri-pause-circle-line' />}
                  label={t('microsegPilot.banner.pausedUntil', { time: formatWhen(format, pausedUntil!) })}
                />
              )}

              {stale && (
                <Chip size='small' color='warning' variant='outlined' icon={<i className='ri-wifi-off-line' />} label={t('microsegPilot.banner.statusStale')} />
              )}
            </Box>
          )}

          <PendingChangesBar connectionId={connectionId} policy={policy} onOpenPlan={onOpenPlan} />
        </Paper>
      )}

      <MicrosegConfirmDialog
        open={open}
        title={dialog[action].title}
        body={dialog[action].body}
        confirmLabel={dialog[action].label}
        color={dialog[action].color}
        busy={busy}
        onConfirm={controls.run}
        onCancel={controls.close}
      />
    </>
  )
}
