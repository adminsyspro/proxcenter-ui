'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Alert, Box, CircularProgress, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useMicrosegRun } from '@/lib/microseg/useMicroseg'

import type { TrackedRun } from './microsegTabTypes'

/** A finished run stays visible this long (or until dismissed). A removal stays until dismissed. */
export const RUN_LINGER_MS = 10_000

type LineProps = {
  connectionId: string
  run: TrackedRun
  /** Called once when the run has ended (done or failed): refresh what it changed. */
  onFinished: () => void
  onRemove: (runId: string) => void
}

/** One run on one line: running, then the counts of steps done, failed and not run (UA13). */
function RunLine({ connectionId, run: tracked, onFinished, onRemove }: LineProps) {
  const t = useTranslations('microsegPilot.policy.run')
  const tr = useTranslations('microsegPilot.settings.remove')
  const { run, done, error } = useMicrosegRun(connectionId, tracked.runId)
  const lost = !!error && !run

  const finished = useRef(onFinished)
  useEffect(() => { finished.current = onFinished })
  // The removal is rare and undoes everything: its outcome and its notes stay until the admin dismisses them.
  const lingers = tracked.kind !== 'remove'
  useEffect(() => {
    if (!done) return
    finished.current()
    if (!lingers) return
    const timer = setTimeout(() => onRemove(tracked.runId), RUN_LINGER_MS)
    return () => clearTimeout(timer)
  }, [done, tracked.runId, onRemove, lingers])

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

  const extra = [notes, run?.status === 'failed' ? run.error : ''].filter(Boolean).join(' ')
  const detail = extra ? `${text} ${extra}` : text

  return (
    <Alert
      severity={severity}
      icon={icon}
      variant='outlined'
      onClose={done || lost ? () => onRemove(tracked.runId) : undefined}
      sx={{ py: 0, '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden' } }}
    >
      <Tooltip title={detail}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography variant='body2' noWrap sx={{ flexShrink: 0, maxWidth: '100%' }}>{text}</Typography>
          {notes ? <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block', minWidth: 0 }}>{notes}</Typography> : null}
        </Box>
      </Tooltip>
    </Alert>
  )
}

type Props = {
  connectionId: string
  runs: TrackedRun[]
  onFinished: () => void
  onRemove: (runId: string) => void
}

/** The runs in progress or just finished, under the banner on every sub-tab. */
export default function RunStrip({ connectionId, runs, onFinished, onRemove }: Props) {
  if (runs.length === 0) return null
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 2 }}>
      {runs.map(run => (
        <RunLine key={run.runId} connectionId={connectionId} run={run} onFinished={onFinished} onRemove={onRemove} />
      ))}
    </Box>
  )
}
