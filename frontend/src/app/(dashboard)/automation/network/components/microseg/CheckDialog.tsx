'use client'

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegErrorKeyOf } from '@/lib/microseg/api'
import type { MicrosegRun } from '@/lib/microseg/types'

import { CheckLog, CheckRowList } from './CheckRows'
import { checkRows, stepLog, type CheckCompanions } from './checkModel'
import ClusterRunRow, { clusterRunStatus, shownClusterName, type ClusterRunStatus } from './ClusterRunRow'
import { DialogErrorLine, ONE_LINE_SX, OneLine } from './dialogParts'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { WriteTip, useMicrosegClusterWrite } from './microsegAccess'
import type { ClusterCheck, GroupCheck, MicrosegCheck } from './useMicrosegCheck'
import type { PolledRun } from './useGroupRunPoll'
import { useGroupGuests } from './useGroupGuests'
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

/** The figures of a pass the window of a shared policy does not read per cluster (the IP collection, the log read). */
const NOT_READ: CheckCompanions = { ipsReady: true, ips: null, logReady: true, log: null }
const PER_CLUSTER_ROWS = new Set(['inventory', 'objects', 'drifts', 'unread', 'truncated', 'errors'])

/** What the line of one cluster says while its check goes on, once it ended, or why it did not happen. */
function useClusterLine() {
  const t = useTranslations('microsegPilot.check')
  const tAll = useTranslations()
  return (c: ClusterCheck, p: PolledRun | undefined): { status: ClusterRunStatus; text: string } => {
    if (c.phase === 'failed') {
      const error = c.error
      if (error instanceof Error && error.message === 'lost') return { status: 'failed', text: t('lost') }
      if (error instanceof MicrosegApiError && error.code === 'NOT_FOUND') return { status: 'failed', text: t('notDeployed') }
      return { status: 'failed', text: tAll(microsegErrorKeyOf(error)) }
    }
    // A failed read of its status or its runs is said on its line while it is retried (the error of one cluster's window).
    if (c.phase !== 'found' && c.pollError) return { status: 'running', text: tAll(microsegErrorKeyOf(c.pollError)) }
    if (c.phase !== 'found' || !p) return { status: 'running', text: c.phase === 'searching' ? t('group.searching') : t('queued') }
    const run = p.run
    if (p.fatal || !run) return { status: p.fatal ? 'failed' : 'running', text: p.fatal ? tAll('microsegPilot.plan.cluster.unreadable') : t('group.searching') }
    if (run.status === 'running') return { status: 'running', text: run.api_calls > 0 ? t('progress', { calls: run.api_calls, writes: run.writes, seconds: seconds(Date.now() - Date.parse(run.started_at)) }) : t('group.searching') }
    if (run.status === 'failed') return { status: 'failed', text: run.error ? t('failed', { error: run.error }) : t('failedNoError') }
    return { status: clusterRunStatus(run), text: t('doneSummary', { seconds: seconds(run.duration_ms), calls: run.api_calls }) }
  }
}

/**
 * The window of a check on a shared policy: one line per cluster (queued, its run found, its progress, its outcome),
 * the rows of its outcome behind its chevron. The IP collection and the log read of each pass are not read here.
 */
function GroupBody({ group, connectionId, clusterName, onOpenDrifts }: { group: GroupCheck; connectionId: string; clusterName?: (id: string) => string; onOpenDrifts: () => void }) {
  const t = useTranslations('microsegPilot.check')
  const tAll = useTranslations()
  const lineOf = useClusterLine()
  // The clusters checked; none yet (the group not read, the check not asked): the tab's connection, as other screens.
  const guestIds = group.clusters.length > 0 ? group.clusters.map(c => c.connection_id) : [connectionId]
  const { guests } = useGroupGuests(guestIds)
  const ended = group.clusters.filter(c => c.phase === 'failed' || group.polled.find(p => p.connection_id === c.connection_id)?.ended)
  const checked = group.polled.filter(p => p.run?.status === 'done').length
  const summary = group.done ? t('group.done', { done: checked, total: group.clusters.length }) : t('group.running', { count: group.clusters.length })
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <OneLine text={summary} />
      {!group.done && <LinearProgress aria-label={summary} variant='determinate' value={Math.round((ended.length / Math.max(1, group.clusters.length)) * 100)} />}
      <Box role='list' aria-label={t('group.clusters')}>
        {group.clusters.map(c => {
          const p = group.polled.find(r => r.connection_id === c.connection_id)
          const { status, text } = lineOf(c, p)
          const run = p?.run
          const name = shownClusterName(c.connection_id, connectionId, clusterName, tAll('microsegPilot.plan.cluster.other'))
          const finished = !!run && run.status !== 'running'
          return (
            <ClusterRunRow
              key={c.connection_id}
              connectionId={c.connection_id}
              name={name}
              status={status}
              text={text}
              extra={status === 'running' && run ? <RunBar run={run} label={`${t('runningText')} · ${name}`} /> : undefined}
            >
              {finished ? (
                <CheckRowList
                  rows={checkRows(run, NOT_READ).filter(row => PER_CLUSTER_ROWS.has(row.id))}
                  guests={guests.filter(g => g.connectionId === c.connection_id)}
                  onOpenDrifts={onOpenDrifts}
                />
              ) : undefined}
            </ClusterRunRow>
          )
        })}
      </Box>
    </Box>
  )
}

type Props = {
  check: MicrosegCheck
  /** The check of every cluster of a shared policy; absent on one cluster. */
  group?: GroupCheck
  connectionId: string
  clusterName?: (id: string) => string
  onClose: () => void
  /** Shows the Drifts sub-tab (the window closes). */
  onOpenDrifts: () => void
}

/** The window of a manual check: queued, then running, then its outcome and its log. */
export default function CheckDialog({ check, group, connectionId, clusterName, onClose, onOpenDrifts }: Props) {
  const t = useTranslations('microsegPilot.check')
  const tAll = useTranslations()
  // Runs the same check again, on the clusters the first one was allowed on (a write of each cluster alone).
  const { canWriteOn, canWriteSome } = useMicrosegClusterWrite()
  const canWrite = group ? canWriteSome : canWriteOn(connectionId)
  const ended = group ? group.started && !group.active : !check.active && check.phase.kind !== 'idle'

  return (
    <Dialog open onClose={onClose} maxWidth='md' fullWidth aria-labelledby='microseg-check-title'>
      <DialogTitle id='microseg-check-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <DialogContent>
        {/* MUI sets no top padding under a title: the first line keeps 8 px from it. */}
        <Box sx={{ pt: 1, minWidth: 0 }}>
          {group
            ? <GroupBody group={group} connectionId={connectionId} clusterName={clusterName} onOpenDrifts={onOpenDrifts} />
            : <Body check={check} connectionId={connectionId} onOpenDrifts={onOpenDrifts} />}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {ended && (
          <WriteTip allowed={canWrite}>
            <Button onClick={() => void (group ? group.start() : check.start())} disabled={!canWrite}>{t('runAgain')}</Button>
          </WriteTip>
        )}
        <Button onClick={onClose} variant='contained'>{tAll('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
