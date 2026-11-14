'use client'

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { MicrosegApiError } from '@/lib/microseg/api'
import type { MicrosegRun } from '@/lib/microseg/types'

import { CheckLog, CheckRowList } from './CheckRows'
import { checkRows, stepLog } from './checkModel'
import { DialogErrorLine, ONE_LINE_SX, OneLine } from './dialogParts'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import type { MicrosegCheck } from './useMicrosegCheck'
import { useNow } from './useNow'
import { StepMark } from './PlanSteps'
import type { StepState } from './planStepStates'
import RunBar from './RunBar'
import { useZoneGuests } from './useZoneGuests'

const seconds = (ms: number) => Math.max(0, Math.round(ms / 1000))

/** The line and the bar of a check that has not ended. */
function Waiting({ text, error }: { text: string; error?: unknown }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <OneLine text={text} />
      <LinearProgress aria-label={text} />
      {!!error && <MicrosegErrorAlert error={error} />}
    </Box>
  )
}

/** The engine takes a queued check at its next pass, a minute at most when nothing else runs. */
export const CHECK_QUEUE_MS = 60_000

/**
 * What the check does, in order, each with its mark: the addresses of the members are collected first (the pass that
 * takes the check), then every guest is read again and compared with the policy, its drifts repaired; the second line
 * carries the bar of the run (guests read, then steps written).
 */
function Stages({ running, run }: { running: boolean; run: MicrosegRun | null }) {
  const t = useTranslations('microsegPilot.check')
  const rows: { key: string; state: StepState; extra?: ReactNode }[] = [
    { key: 'ips', state: running ? 'done' : 'waiting' },
    { key: 'guests', state: running ? 'running' : 'waiting', extra: running ? <RunBar run={run} label={t('stages.guests')} separator='·' /> : undefined },
  ]
  return (
    <Box role='list' aria-label={t('stages.title')} data-testid='check-stages' sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
      {rows.map(row => (
        <Box key={row.key} role='listitem' data-stage={row.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, minHeight: 24 }}>
          <StepMark state={row.state} />
          <Typography variant='body2' noWrap sx={{ flexShrink: 0 }}>{t(`stages.${row.key}`)}</Typography>
          {row.extra}
        </Box>
      ))}
    </Box>
  )
}

/**
 * A check in the queue: how long it has waited, against the minute the engine takes to start it, and what it will do.
 * Past the minute the engine is busy with another operation on the cluster (an application, a pass): the check follows.
 */
function Queued({ since, error }: { since: string | null; error?: unknown }) {
  const t = useTranslations('microsegPilot.check')
  const now = useNow(1000, since)
  const asked = since ? Date.parse(since) : NaN
  const waited = Number.isNaN(asked) ? null : Math.max(0, now - asked)
  let text = t('queued')
  if (waited !== null) text = waited < CHECK_QUEUE_MS ? t('queuedFor', { seconds: seconds(waited) }) : t('queuedLate')
  const counted = waited !== null && waited < CHECK_QUEUE_MS
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <OneLine text={text} />
      <LinearProgress aria-label={text} variant={counted ? 'determinate' : 'indeterminate'} value={counted ? Math.round((waited / CHECK_QUEUE_MS) * 100) : undefined} />
      {!!error && <MicrosegErrorAlert error={error} />}
      <Stages running={false} run={null} />
    </Box>
  )
}

/** The progress of the run while it goes on: what it is doing and how far; the engine records its steps when it ends. */
function Running({ run, error }: { run: MicrosegRun; error: unknown }) {
  const t = useTranslations('microsegPilot.check')
  const now = useNow(1000, run.status)
  const elapsed = seconds(now - Date.parse(run.started_at))
  const text = run.api_calls > 0
    ? t('progress', { calls: run.api_calls, writes: run.writes, seconds: elapsed })
    : t('inProgress', { seconds: elapsed })
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <OneLine text={text} />
      {!!error && <MicrosegErrorAlert error={error} />}
      <Stages running run={run} />
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('log')}</Typography>
      <OneLine text={t('logLater')} />
    </Box>
  )
}

/** The outcome of the check: the rows, the error of a failed run, then the log of its steps. */
function Outcome({ check, connectionId, onOpenDrifts }: { check: MicrosegCheck; connectionId: string; onOpenDrifts: () => void }) {
  const t = useTranslations('microsegPilot.check')
  const { guests } = useZoneGuests(connectionId)
  const run = check.run as MicrosegRun
  const failed = run.status === 'failed'
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <OneLine text={t('doneSummary', { seconds: seconds(run.duration_ms), calls: run.api_calls })} />
      {failed && <DialogErrorLine message={run.error ? t('failed', { error: run.error }) : t('failedNoError')} />}
      <CheckRowList rows={checkRows(run, check.companions)} guests={guests} onOpenDrifts={onOpenDrifts} />
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1 }}>{t('log')}</Typography>
      <CheckLog steps={stepLog(run)} guests={guests} />
    </Box>
  )
}

function Body({ check, connectionId, onOpenDrifts }: { check: MicrosegCheck; connectionId: string; onOpenDrifts: () => void }) {
  const t = useTranslations('microsegPilot.check')
  const { phase, run } = check

  switch (phase.kind) {
    case 'error': {
      // 404: nothing is deployed on the connection, the engine never works on it.
      const notDeployed = phase.error instanceof MicrosegApiError && phase.error.code === 'NOT_FOUND'
      return notDeployed ? <DialogErrorLine message={t('notDeployed')} /> : <MicrosegErrorAlert error={phase.error} />
    }
    case 'lost':
      return <DialogErrorLine message={t('lost')} />
    case 'tracking':
      if (check.done && run) return <Outcome check={check} connectionId={connectionId} onOpenDrifts={onOpenDrifts} />
      if (run) return <Running run={run} error={check.runError} />
      return <Waiting text={t('queued')} error={check.runError} />
    case 'queued':
      return <Queued since={phase.cutoff.since} error={check.pollError} />
    default:
      return <Waiting text={t('queued')} error={check.pollError} />
  }
}

type Props = {
  check: MicrosegCheck
  connectionId: string
  onClose: () => void
  /** Shows the Drifts sub-tab (the window closes). */
  onOpenDrifts: () => void
}

/** The window of a manual check: queued, then running, then its outcome and its log. */
export default function CheckDialog({ check, connectionId, onClose, onOpenDrifts }: Props) {
  const t = useTranslations('microsegPilot.check')
  const tAll = useTranslations()
  const { canWrite } = useMicrosegWrite()
  const ended = !check.active && check.phase.kind !== 'idle'

  return (
    <Dialog open onClose={onClose} maxWidth='md' fullWidth aria-labelledby='microseg-check-title'>
      <DialogTitle id='microseg-check-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <DialogContent>
        {/* MUI sets no top padding under a title: the first line keeps 8 px from it. */}
        <Box sx={{ pt: 1, minWidth: 0 }}>
          <Body check={check} connectionId={connectionId} onOpenDrifts={onOpenDrifts} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {ended && (
          <WriteTip>
            <Button onClick={() => void check.start()} disabled={!canWrite}>{t('runAgain')}</Button>
          </WriteTip>
        )}
        <Button onClick={onClose} variant='contained'>{tAll('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
