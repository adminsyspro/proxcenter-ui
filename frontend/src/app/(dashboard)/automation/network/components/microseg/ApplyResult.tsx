'use client'

import { Box, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegRun, PlanStep } from '@/lib/microseg/types'

import ClusterRunRow, { OUTCOME_SEVERITY, clusterRunLine, neverAppliedLeft } from './ClusterRunRow'
import { Notice } from './PlanNotices'
import { isFirewallOffRunError } from './preflightModel'
import PlanSteps from './PlanSteps'
import { stepStates, stepsWithOutcome } from './planStepStates'
import RunBar from './RunBar'
import { polledOutcome, type PolledRun } from './useGroupRunPoll'
import type { PolicyGuest } from './zoneModel'

/** The orchestrator's note that a write was made while the emergency stop holds the cluster firewall off. */
const STOP_NOTE_RE = /written while the emergency stop/i

type Props = {
  run: MicrosegRun
  guests: PolicyGuest[]
  /** The caller lists every step with its outcome itself: the failed and not-run sections are left out. */
  hideSteps?: boolean
}

/** The outcome of a finished apply run: counts, why it stopped, then the failed steps and the ones not run, per guest. */
export default function ApplyResult({ run, guests, hideSteps = false }: Props) {
  const t = useTranslations('microsegPilot.plan')
  const result = run.result
  const failed = result?.failed ?? []
  const notRun = result?.not_run ?? []

  // A run that did not complete its plan is `failed` and still carries its whole result.
  // A cluster whose firewall was switched off meanwhile is said in plain words, not with the engine's text.
  let failedText = run.error ? t('applyFailedWith', { error: run.error }) : t('applyFailed')
  if (isFirewallOffRunError(run.error)) failedText = t('cluster.firewallOffRun')
  const failure = run.status === 'failed' ? <Notice severity='error' text={failedText} /> : null
  if (!result) return failure

  const summary = t('resultSummary', { done: result.done?.length ?? 0, failed: failed.length, notRun: notRun.length })
  const errors = result.errors ?? []
  // The stop warning line says what the orchestrator's own note about the stop says: it is shown once.
  const notes = (result.notes ?? []).filter(note => !(result.stop_active && STOP_NOTE_RE.test(note)))

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {failure}
      <Notice severity={failed.length > 0 ? 'warning' : 'success'} text={summary} />
      {result.truncated && <Notice severity='warning' text={t('truncated')} />}
      {result.interrupted && <Notice severity='warning' text={t('interrupted')} />}
      {result.stop_active && <Notice severity='warning' text={t('stopActive')} />}
      {result.held && <Notice severity='warning' text={t('held')} />}
      {errors.length > 0 && <Notice severity='warning' text={t('errors', { list: errors.join('; ') })} />}
      {notes.length > 0 && <Notice severity='info' text={t('notes', { list: notes.join('; ') })} />}
      {!hideSteps && failed.length > 0 && (
        <Box>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('failedSection')}</Typography>
          <PlanSteps steps={failed} guests={guests} />
        </Box>
      )}
      {!hideSteps && notRun.length > 0 && (
        <Box>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('notRunSection')}</Typography>
          <PlanSteps steps={notRun} guests={guests} />
        </Box>
      )}
    </Box>
  )
}

type GroupProps = {
  /** The application of each cluster, as polled. */
  runs: PolledRun[]
  /** The steps the plan of each cluster showed, by connection ID: each step gets its outcome. */
  steps: Readonly<Record<string, PlanStep[]>>
  /** The guests of every cluster, each with its connection. */
  guests: PolicyGuest[]
  /** The name a cluster is shown with. */
  nameOf: (id: string) => string
  /** The clusters never applied (link inactive): one that could not be reached does not catch up by itself. */
  inactive?: ReadonlySet<string>
}

const NONE: ReadonlySet<string> = new Set()

/**
 * The application of a shared policy: once every cluster has ended, how many clusters it went through ("Applied on 1
 * of 2 clusters"); then one line per cluster with its outcome or its bar, and behind its chevron the outcome of its
 * run and its steps with their marks. An active cluster that could not be reached catches up by itself at its next
 * pass: its line says so. A cluster never applied does not: its line and the headline say to apply again.
 */
export function GroupApplyResult({ runs, steps, guests, nameOf, inactive = NONE }: Readonly<GroupProps>) {
  const t = useTranslations('microsegPilot.plan')
  const ended = runs.every(r => r.ended)
  const outcome = polledOutcome(runs)
  const applied = runs.filter(r => r.run?.status === 'done').length
  const headline = ended && outcome !== 'running'
    ? <Notice severity={OUTCOME_SEVERITY[outcome]} text={t(`cluster.applied.${outcome === 'partial' && neverAppliedLeft(runs, inactive) ? 'partialApplyAgain' : outcome}`, { done: applied, total: runs.length })} />
    : null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {headline}
      <Box role='list'>
        {runs.map(r => {
          const { status, key, values } = clusterRunLine(r, inactive.has(r.connection_id))
          const name = nameOf(r.connection_id)
          const own = guests.filter(g => g.connectionId === r.connection_id)
          const planned = steps[r.connection_id] ?? []
          const states = r.run_id && !r.fatal ? stepStates(planned, r.run) : null
          const text = key ? t(key, values) : ''
          const details = r.run && (r.run.status !== 'running' || states) ? (
            <>
              {r.run.status !== 'running' && <ApplyResult run={r.run} guests={own} hideSteps={!!states} />}
              {states && <PlanSteps steps={stepsWithOutcome(planned, r.run)} guests={own} states={states} />}
            </>
          ) : undefined
          return (
            <ClusterRunRow
              key={r.connection_id}
              connectionId={r.connection_id}
              name={name}
              status={status}
              text={text}
              tip={status === 'failed' && !r.fatal && r.run?.error && key !== 'cluster.firewallOffRun' ? `${text} ${r.run.error}` : undefined}
              extra={status === 'running' ? <RunBar run={r.run} label={`${t('applying')} ${name}`} /> : undefined}
            >
              {details}
            </ClusterRunRow>
          )
        })}
      </Box>
    </Box>
  )
}
