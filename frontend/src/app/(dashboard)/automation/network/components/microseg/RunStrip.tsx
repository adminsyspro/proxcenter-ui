'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Box, CircularProgress, Collapse, IconButton, Portal, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useMicrosegRun } from '@/lib/microseg/useMicroseg'

import ClusterRunRow, { OUTCOME_SEVERITY, clusterRunLine, neverAppliedLeft, shownClusterName } from './ClusterRunRow'
import RunBar, { groupProgress } from './RunBar'
import type { TrackedRun } from './microsegTabTypes'
import { polledOutcome, useGroupRunPoll, type PolledRun } from './useGroupRunPoll'

/** A finished run stays visible this long (or until dismissed). A removal stays until dismissed. */
export const RUN_LINGER_MS = 10_000

/** What stands between the summary of a run and the notes of the engine: they are two sentences, not one. */
export const NOTE_SEPARATOR = ' · '

type LineProps = {
  connectionId: string
  run: TrackedRun
  /** Called once when the run has ended (done or failed), with its id: refresh what it changed. */
  onFinished: (runId: string) => void
  onRemove: (runId: string) => void
  /** Where the line is drawn a second time while the strip floats over the scrolled page (null otherwise). */
  floatHost: HTMLElement | null
}

/**
 * What a line does once its run has ended: the refresh of what it changed, once, and its removal after a while.
 * The callbacks are read through refs: a parent handing new functions on each render must not re-run the effects
 * (an onFinished that reloads would then reload, re-render and reload again, without end).
 */
function useRunEnd(done: boolean, tracked: TrackedRun, onFinished: (runId: string) => void, onRemove: (runId: string) => void) {
  const finished = useRef(onFinished)
  const remove = useRef(onRemove)
  useEffect(() => {
    finished.current = onFinished
    remove.current = onRemove
  })
  // Once per run: the refresh of what it changed fires a single time, whatever re-renders follow.
  const finishedRun = useRef<string | null>(null)
  useEffect(() => {
    if (!done || finishedRun.current === tracked.runId) return
    finishedRun.current = tracked.runId
    finished.current(tracked.runId)
  }, [done, tracked.runId])
  // The removal is rare and undoes everything: its outcome and its notes stay until the admin dismisses them.
  const lingers = tracked.kind !== 'remove'
  useEffect(() => {
    if (!done || !lingers) return
    const timer = setTimeout(() => remove.current(tracked.runId), RUN_LINGER_MS)
    return () => clearTimeout(timer)
  }, [done, tracked.runId, lingers])
}

/** One run on one line: running with its progress bar, then the counts of steps done, failed and not run (UA13). */
function RunLine({ connectionId, run: tracked, onFinished, onRemove, floatHost }: LineProps) {
  const t = useTranslations('microsegPilot.policy.run')
  const tr = useTranslations('microsegPilot.settings.remove')
  // A run resumed on another cluster of the group is read through that cluster.
  const only = tracked.runs?.[0]
  const { run, done, error } = useMicrosegRun(only?.connection_id ?? connectionId, only?.run_id ?? tracked.runId)
  const lost = !!error && !run

  useRunEnd(done, tracked, onFinished, onRemove)

  const { label } = tracked
  let text = tracked.runningText
  let severity: 'info' | 'success' | 'warning' | 'error' = 'info'
  let icon: ReactNode = <CircularProgress size={16} />

  let notes = ''

  if (tracked.kind === 'remove' && run?.result && done) {
    // A removal says whether it undid everything (`complete`); the engine keeps the zone tags either way.
    const complete = !!run.result.complete
    text = tr(complete ? 'complete' : 'incomplete', { label })
    severity = complete ? 'success' : run.status === 'failed' ? 'error' : 'warning'
    icon = undefined
    notes = (run.result.notes ?? []).join('; ')
  } else if (run?.status === 'failed') {
    // A lifecycle run that did not complete its plan is `failed` and still carries its result.
    text = run.result
      ? t('done', { label, done: run.result.done?.length ?? 0, failed: run.result.failed?.length ?? 0, notRun: run.result.not_run?.length ?? 0 })
      : t('failed', { label })
    severity = 'error'
    icon = undefined
  } else if (run?.status === 'done') {
    const failed = run.result?.failed?.length ?? 0
    text = t('done', { label, done: run.result?.done?.length ?? 0, failed, notRun: run.result?.not_run?.length ?? 0 })
    severity = failed > 0 ? 'warning' : 'success'
    icon = undefined
  } else if (lost) {
    text = t('unavailable', { label })
    severity = 'warning'
    icon = undefined
  }

  const running = !done && !lost
  const extra = [notes, run?.status === 'failed' ? run.error : ''].filter(Boolean).join(' ')
  const detail = extra ? `${text}${NOTE_SEPARATOR}${extra}` : text

  // The copy over the scrolled page is not announced again: the line in the page already is.
  const line = (floating: boolean) => (
    <Alert
      role={floating ? 'none' : undefined}
      severity={severity}
      icon={icon}
      variant='outlined'
      onClose={done || lost ? () => onRemove(tracked.runId) : undefined}
      // Opaque: the strip floats over the page when it is scrolled past its place.
      sx={{ py: 0, bgcolor: 'background.paper', '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden', flex: 1 } }}
    >
      <Tooltip title={detail}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography variant='body2' noWrap sx={{ flexShrink: 0, maxWidth: '100%' }}>{text}</Typography>
          {notes ? (
            <>
              <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{NOTE_SEPARATOR.trim()}</Typography>
              <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block', minWidth: 0 }}>{notes}</Typography>
            </>
          ) : null}
          {running ? <RunBar run={run} label={text} separator={NOTE_SEPARATOR.trim()} /> : null}
        </Box>
      </Tooltip>
    </Alert>
  )

  return (
    <>
      {line(false)}
      {floatHost ? createPortal(line(true), floatHost) : null}
    </>
  )
}

/** True when a tracked run is followed on several clusters, or carries why a cluster's run did not start. */
const isGroupRun = (run: TrackedRun) => !!run.runs && (run.runs.length > 1 || run.runs.some(r => !!r.error))

type GroupLineProps = LineProps & {
  clusterName?: (id: string) => string
  /** The clusters never applied (link inactive): one that could not be reached does not catch up by itself. */
  inactiveClusters?: ReadonlySet<string>
}

const NO_CLUSTER: ReadonlySet<string> = new Set()

/**
 * One group action (an application, a state change...) of a shared policy on one line: its bar sums the steps of
 * every cluster, its outcome says on how many clusters it went through; the line of each cluster, with its own bar or
 * outcome, is behind the chevron.
 */
function GroupRunLine({ connectionId, run: tracked, onFinished, onRemove, floatHost, clusterName, inactiveClusters = NO_CLUSTER }: GroupLineProps) {
  const t = useTranslations('microsegPilot.policy.run')
  const tp = useTranslations('microsegPilot.plan')
  const polled = useGroupRunPoll(tracked.runs ?? null)
  const [open, setOpen] = useState(false)
  const done = polled.every(p => p.ended)
  const lost = !done && polled.every(p => p.ended || (!!p.readError && !p.run))

  useRunEnd(done, tracked, onFinished, onRemove)

  const { label } = tracked
  const outcome = polledOutcome(polled)
  const applied = polled.filter(p => p.run?.status === 'done').length
  let text = tracked.runningText
  let severity: 'info' | 'success' | 'warning' | 'error' = 'info'
  let icon: ReactNode = <CircularProgress size={16} />
  if (done && outcome !== 'running') {
    text = t(`group.${outcome === 'partial' && neverAppliedLeft(polled, inactiveClusters) ? 'partialApplyAgain' : outcome}`, { label, done: applied, total: polled.length })
    severity = OUTCOME_SEVERITY[outcome]
    icon = undefined
  } else if (lost) {
    text = t('unavailable', { label })
    severity = 'warning'
    icon = undefined
  }
  const running = !done && !lost
  const progress = groupProgress(polled.map(p => p.run))
  const toggle = t(open ? 'group.hideClusters' : 'group.showClusters')
  const nameOf = (id: string) => shownClusterName(id, connectionId, clusterName, tp('cluster.other'))

  const clusterLine = (p: PolledRun) => {
    const { status, key, values } = clusterRunLine(p, inactiveClusters.has(p.connection_id))
    const name = nameOf(p.connection_id)
    const lineText = key ? tp(key, values) : ''
    // The orchestrator's own reason of a failed run is shown on hover, as on a line of one cluster.
    const tip = status === 'failed' && !p.fatal && p.run?.error ? `${lineText}${NOTE_SEPARATOR}${p.run.error}` : undefined
    return (
      <ClusterRunRow
        key={p.connection_id}
        connectionId={p.connection_id}
        name={name}
        status={status}
        text={lineText}
        tip={tip}
        extra={status === 'running' ? <RunBar run={p.run} label={`${tracked.runningText}${NOTE_SEPARATOR}${name}`} /> : undefined}
      />
    )
  }

  const line = (floating: boolean) => (
    <Alert
      role={floating ? 'none' : undefined}
      severity={severity}
      icon={icon}
      variant='outlined'
      onClose={done || lost ? () => onRemove(tracked.runId) : undefined}
      sx={{ py: 0, bgcolor: 'background.paper', '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden', flex: 1 } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Tooltip title={text}>
          <Typography variant='body2' noWrap sx={{ flexShrink: 0, maxWidth: '100%' }}>{text}</Typography>
        </Tooltip>
        {running ? <RunBar run={null} progress={progress} label={text} separator={NOTE_SEPARATOR.trim()} /> : <Box sx={{ flex: 1 }} />}
        {floating ? null : (
          <Tooltip title={toggle}>
            <IconButton size='small' aria-label={toggle} aria-expanded={open} onClick={() => setOpen(v => !v)} sx={{ p: 0.25, flexShrink: 0 }}>
              <i className={open ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {floating ? null : (
        <Collapse in={open} unmountOnExit>
          <Box role='list' sx={{ mt: 0.5 }}>{polled.map(clusterLine)}</Box>
        </Collapse>
      )}
    </Alert>
  )

  return (
    <>
      {line(false)}
      {floatHost ? createPortal(line(true), floatHost) : null}
    </>
  )
}

type Props = {
  connectionId: string
  runs: TrackedRun[]
  onFinished: (runId: string) => void
  onRemove: (runId: string) => void
  /** The name of a cluster of the group, for the lines of an action followed on several clusters. */
  clusterName?: (id: string) => string
  /** The clusters of the policy never applied (link inactive), from the policy already read. */
  inactiveClusters?: ReadonlySet<string>
}

/** The gap between the page header and the strip when it floats under it. */
const FLOAT_GAP = 8

type Floating = { top: number; left: number; width: number }

const sameFloating = (a: Floating | null, b: Floating | null) =>
  a === b || (!!a && !!b && a.top === b.top && a.left === b.left && a.width === b.width)

/**
 * Where the strip floats once its place in the page has scrolled above the page header, null while that place
 * is in view. The page scrolls with the window, under a header that stays: the floating copy is laid just below
 * it, over the width the strip has in the page.
 */
function useFloating(lines: number) {
  const place = useRef<HTMLDivElement | null>(null)
  const [floating, setFloating] = useState<Floating | null>(null)

  useEffect(() => {
    const measure = () => {
      const at = place.current?.getBoundingClientRect()
      if (!at) return
      const top = (document.querySelector('header')?.getBoundingClientRect().bottom ?? 0) + FLOAT_GAP
      // A strip that is not laid out (hidden, or a document without layout) has no place to scroll past.
      const laidOut = at.width > 0 || at.height > 0
      const next = laidOut && at.bottom < top ? { top, left: at.left, width: at.width } : null
      setFloating(prev => (sameFloating(prev, next) ? prev : next))
    }
    // Measured after the paint, then on every scroll (of the window or of a panel) and resize.
    const frame = requestAnimationFrame(measure)
    window.addEventListener('scroll', measure, { passive: true, capture: true })
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', measure, { capture: true })
      window.removeEventListener('resize', measure)
    }
  }, [lines])

  return { place, floating }
}

const STRIP_SX = { display: 'flex', flexDirection: 'column', gap: 1 } as const

/**
 * The runs in progress or just finished, under the banner on every sub-tab. When the page is scrolled past it,
 * a copy of the strip floats under the page header: a run started from a zone far down stays in view. The copy
 * is drawn at the root of the document, where nothing of the page can clip or shift it.
 */
function Strip({ connectionId, runs, onFinished, onRemove, clusterName, inactiveClusters }: Props) {
  const { place, floating } = useFloating(runs.length)
  const [floatHost, setFloatHost] = useState<HTMLElement | null>(null)
  return (
    <Box ref={place} data-testid='microseg-run-strip' sx={{ ...STRIP_SX, mt: 2 }}>
      {runs.map(run => (isGroupRun(run)
        ? <GroupRunLine key={run.runId} connectionId={connectionId} run={run} onFinished={onFinished} onRemove={onRemove} floatHost={floating ? floatHost : null} clusterName={clusterName} inactiveClusters={inactiveClusters} />
        : <RunLine key={run.runId} connectionId={connectionId} run={run} onFinished={onFinished} onRemove={onRemove} floatHost={floating ? floatHost : null} />
      ))}
      {floating ? (
        <Portal>
          <Box
            ref={setFloatHost}
            data-testid='microseg-run-strip-floating'
            sx={{ ...STRIP_SX, position: 'fixed', zIndex: theme => theme.zIndex.appBar - 1, boxShadow: 6, borderRadius: 1 }}
            style={{ top: floating.top, left: floating.left, width: floating.width }}
          />
        </Portal>
      ) : null}
    </Box>
  )
}

export default function RunStrip(props: Props) {
  if (props.runs.length === 0) return null
  return <Strip {...props} />
}
