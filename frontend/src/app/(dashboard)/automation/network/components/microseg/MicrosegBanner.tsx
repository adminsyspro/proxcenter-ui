'use client'

import { useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Paper, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { microsegApi } from '@/lib/microseg/api'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'
import type { MicrosegPolicy, MicrosegRunSummary, ZoneState } from '@/lib/microseg/types'

import { coverage } from './coverage'
import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PendingChangesBar from './PendingChangesBar'

type Props = {
  connectionId: string
  policy: MicrosegPolicy
  onOpenPlan: () => void
}

type Action = 'stop' | 'resume' | 'confirmWrites'

const KIND_ORDER = ['plan', 'apply', 'remove']
const ZONE_STATES: ZoneState[] = ['disabled', 'observe', 'enforce']
const ZONE_STATE_COLOR: Record<ZoneState, 'default' | 'info' | 'success'> = { disabled: 'default', observe: 'info', enforce: 'success' }

const RUN_ICON: Record<MicrosegRunSummary['status'], { icon: string; color: string }> = {
  done: { icon: 'ri-checkbox-circle-line', color: 'success.main' },
  failed: { icon: 'ri-error-warning-line', color: 'error.main' },
  running: { icon: 'ri-loader-4-line', color: 'info.main' },
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant='caption' color='text.secondary' component='div' sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  )
}

/**
 * Always visible above the sub-tabs: engine state, coverage, zones by state,
 * the Emergency stop, the writes held by the cap and the pending changes (UA4, UA11).
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
  const [leaderNotice, setLeaderNotice] = useState(false)

  const when = (iso: string) => {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })
  }

  const run = async () => {
    const api = microsegApi(connectionId)
    setBusy(true)
    setActionError(null)
    try {
      if (action === 'confirmWrites') {
        await api.confirmWrites()
      } else {
        const result = await api.emergencyStop(action === 'stop')
        setLeaderNotice(result.applied_by === 'leader')
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

  const kindLabel = (kind: string) => (t.has(`microsegPilot.banner.kind.${kind}`) ? t(`microsegPilot.banner.kind.${kind}`) : kind)
  const runs = status
    ? Object.entries(status.engine.last_runs ?? {}).sort(([a], [b]) => {
        const ia = KIND_ORDER.indexOf(a)
        const ib = KIND_ORDER.indexOf(b)
        return (ia < 0 ? KIND_ORDER.length : ia) - (ib < 0 ? KIND_ORDER.length : ib) || a.localeCompare(b)
      })
    : []
  const cov = status ? coverage(status) : null

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

      {leaderNotice && <Alert severity='info' sx={{ mb: 2 }} onClose={() => setLeaderNotice(false)}>{t('microsegPilot.stop.appliedByLeader')}</Alert>}
      {actionError != null && <MicrosegErrorAlert error={actionError} onClose={() => setActionError(null)} />}
      {statusError && !status && <MicrosegErrorAlert error={statusError} onRetry={reload} />}
      {!status && !statusError && <CircularProgress size={20} aria-label={t('microsegPilot.loading')} />}

      {status && cov && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 4 }}>
          <Section label={t('microsegPilot.banner.engine')}>
            {runs.length === 0 && <Typography variant='body2'>{t('microsegPilot.banner.noRun')}</Typography>}
            {runs.map(([kind, last]) => {
              const { icon, color } = RUN_ICON[last.status] ?? RUN_ICON.done
              const line = t('microsegPilot.banner.run', { kind: kindLabel(kind), time: when(last.started_at), calls: last.api_calls })
              return (
                <Box key={kind} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box component='i' className={icon} sx={{ color, fontSize: 16 }} />
                  <Tooltip title={line}><Typography variant='body2' noWrap>{line}</Typography></Tooltip>
                </Box>
              )
            })}
            {status.engine.paused_until && (
              <Chip
                size='small'
                color='warning'
                icon={<i className='ri-pause-circle-line' />}
                label={t('microsegPilot.banner.pausedUntil', { time: when(status.engine.paused_until) })}
                sx={{ mt: 0.5 }}
              />
            )}
          </Section>

          <Section label={t('microsegPilot.banner.coverage')}>
            <Typography variant='body2'>{t('microsegPilot.banner.coverageZoned', { zoned: cov.zoned, running: cov.running })}</Typography>
            <Typography variant='body2'>{t('microsegPilot.banner.coverageProtected', { protected: cov.protected, members: cov.members })}</Typography>
          </Section>

          <Section label={t('microsegPilot.banner.zones')}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {ZONE_STATES.map(state => (
                <Chip
                  key={state}
                  size='small'
                  variant='outlined'
                  color={ZONE_STATE_COLOR[state]}
                  label={t(`microsegPilot.banner.zoneState.${state}`, { count: status.zones_by_state?.[state] ?? 0 })}
                />
              ))}
            </Box>
          </Section>

          {!status.emergency_stop && (
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
      )}

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
