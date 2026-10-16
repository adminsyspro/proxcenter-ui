'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Box, CircularProgress, Typography } from '@mui/material'

import type { RecoveryExecutionEvent } from '@/lib/orchestrator/site-recovery.types'

/** The steps of a failover and of a failback cutover, in the order they run. */
export const FAILOVER_STEPS = ['fencing', 'restoring', 'starting']
export const CUTOVER_STEPS = ['fencing_dr', 'final_sync', 'starting_source', 'reprotect']

/** A rollback only happens when a restore point was chosen: listed once it shows up. */
const OPTIONAL_STEPS = new Set(['restoring'])

export type StepState = 'pending' | 'active' | 'done' | 'failed'

export interface StepView {
  step: string
  state: StepState
  /** Seconds between the first and the last event of the step. */
  seconds: number | null
}

/**
 * Where each step stands, from the events and the step the orchestrator
 * reports now. A step with an error failed; the current step is active while
 * the run lasts; a step left behind, or every step of a completed run, is done.
 */
export function stepViews(
  steps: string[],
  events: RecoveryExecutionEvent[],
  currentStep: string | undefined,
  status: string | undefined,
): StepView[] {
  const seen = (step: string) => events.filter(e => e.step === step)
  const listed = steps.filter(step => !OPTIONAL_STEPS.has(step) || seen(step).length > 0)
  const reached = listed.map(step => seen(step).length > 0 || step === currentStep)
  const lastReached = reached.lastIndexOf(true)

  return listed.map((step, i) => {
    const own = seen(step)
    const seconds = own.length > 1
      ? Math.max(0, Math.round((new Date(own[own.length - 1].at).getTime() - new Date(own[0].at).getTime()) / 1000))
      : null
    let state: StepState = 'pending'

    if (own.some(e => e.level === 'error')) state = 'failed'
    else if (status === 'completed') state = 'done'
    else if (status === 'running' && step === currentStep) state = 'active'
    else if (i < lastReached || (reached[i] && status !== 'running')) state = 'done'

    return { step, state, seconds }
  })
}

const LEVEL_ICONS: Record<RecoveryExecutionEvent['level'], { icon: string; color: string }> = {
  check: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  info: { icon: 'ri-arrow-right-circle-line', color: 'info.main' },
  warning: { icon: 'ri-error-warning-fill', color: 'warning.main' },
  error: { icon: 'ri-close-circle-fill', color: 'error.main' },
}

const STEP_ICONS: Record<StepState, { icon: string; color: string }> = {
  pending: { icon: 'ri-checkbox-blank-circle-line', color: 'text.disabled' },
  active: { icon: '', color: 'primary.main' },
  done: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  failed: { icon: 'ri-close-circle-fill', color: 'error.main' },
}

const POLL_MS = 2000

interface ExecutionTraceProps {
  executionId: string
  /** Steps listed as checks; empty for the reverse sync, which only logs. */
  steps: string[]
  currentStep?: string
  /** Execution status: polling stops once it is no longer running. */
  status?: string
}

/**
 * The checks and the log of a failover or failback (ui#943): each step with
 * its state and duration, then every line the orchestrator wrote, newest at
 * the bottom, kept on screen once the run is over. Mount it with the
 * execution id as key: a new run starts from an empty log.
 */
export default function ExecutionTrace({ executionId, steps, currentStep, status }: ExecutionTraceProps) {
  const t = useTranslations()
  const [events, setEvents] = useState<RecoveryExecutionEvent[]>([])
  const lastId = useRef(0)
  const logRef = useRef<HTMLDivElement | null>(null)
  const running = status === 'running'

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch(`/api/v1/orchestrator/replication/executions/${encodeURIComponent(executionId)}/events?after=${lastId.current}`)
        const fresh: RecoveryExecutionEvent[] = res.ok ? await res.json() : []

        if (cancelled || !Array.isArray(fresh) || fresh.length === 0) return
        lastId.current = fresh[fresh.length - 1].id
        setEvents(previous => [...previous, ...fresh.filter(e => !previous.some(p => p.id === e.id))])
      } catch {
        // The next tick tries again; the log is a view, never a blocker.
      }
    }

    void load()
    // One more read after the run ends catches its last lines.
    const timer = running ? setInterval(() => void load(), POLL_MS) : null

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [executionId, running])

  useEffect(() => {
    const el = logRef.current

    if (el) el.scrollTop = el.scrollHeight
  }, [events.length])

  const views = stepViews(steps, events, currentStep, status)
  const time = (at: string) => new Date(at).toLocaleTimeString()
  const stepLabel = (step: string) => (t.has(`siteRecovery.failover.step.${step}`) ? t(`siteRecovery.failover.step.${step}`) : step)

  return (
    <Box data-testid='execution-trace' sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {views.length > 0 && (
        <Box>
          <Typography variant='overline' sx={{ color: 'text.secondary', lineHeight: 1.6 }}>{t('siteRecovery.guestDR.traceChecks')}</Typography>
          <Box component='ol' sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {views.map(view => (
              <Box
                component='li'
                key={view.step}
                data-testid={`trace-step-${view.step}`}
                data-state={view.state}
                sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Box sx={{ width: 18, display: 'flex', justifyContent: 'center', color: STEP_ICONS[view.state].color }}>
                  {view.state === 'active'
                    ? <CircularProgress size={14} thickness={5} />
                    : <i className={STEP_ICONS[view.state].icon} style={{ fontSize: 16 }} />}
                </Box>
                <Typography
                  variant='body2'
                  sx={{ fontSize: '0.8rem', flex: 1, fontWeight: view.state === 'active' ? 600 : 400, color: view.state === 'pending' ? 'text.disabled' : 'text.primary' }}
                >
                  {stepLabel(view.step)}
                </Typography>
                {view.seconds !== null && view.state !== 'pending' && (
                  <Typography variant='caption' sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{view.seconds} s</Typography>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Box>
        <Typography variant='overline' sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
          {t('siteRecovery.guestDR.traceLog')}
        </Typography>
        <Box
          ref={logRef}
          data-testid='trace-log'
          sx={{
            maxHeight: 180,
            overflowY: 'auto',
            px: 1.25,
            py: 1,
            borderRadius: 1,
            bgcolor: 'action.hover',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '0.72rem',
          }}
        >
          {events.length === 0 && (
            <Typography variant='caption' sx={{ color: 'text.secondary', fontFamily: 'inherit' }}>{t('siteRecovery.guestDR.traceEmpty')}</Typography>
          )}
          {events.map(event => (
            <Box key={event.id} data-level={event.level} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 0.25 }}>
              <Box component='span' sx={{ color: 'text.secondary', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{time(event.at)}</Box>
              <Box component='i' className={LEVEL_ICONS[event.level]?.icon || LEVEL_ICONS.info.icon} sx={{ color: LEVEL_ICONS[event.level]?.color || 'info.main', fontSize: 13, mt: '1px', flexShrink: 0 }} />
              <Box component='span' sx={{ color: event.level === 'error' ? 'error.main' : 'text.primary', wordBreak: 'break-word' }}>{event.message}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}
