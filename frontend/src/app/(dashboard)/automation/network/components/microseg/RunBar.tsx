'use client'

import { LinearProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegRun, MicrosegRunProgress } from '@/lib/microseg/types'

type Props = {
  /** The run being followed (null before its first answer). */
  run: MicrosegRun | null
  /** What the bar is the progress of, for assistive technologies. */
  label: string
  /** Put before the caption when the bar follows a sentence on the same line. */
  separator?: string
  /** Where several runs stand together (`groupProgress`), in place of the progress of `run`. */
  progress?: MicrosegRunProgress
}

/** The phases in the order a run goes through them: the group shows the furthest any of its runs reached. */
const PHASES = ['waiting', 'reading', 'writing']

/**
 * Where the runs of a group action stand together: the furthest phase any of them reached, and the counts of the runs
 * in that phase summed over every cluster (3 of 10 and 5 of 10 written make 8 of 20). While writing, a finished run
 * counts its steps as done. While a running cluster is behind that phase or does not tell (an older orchestrator, the
 * first poll), there is no count: the bar is indeterminate. A run that did not start adds nothing. Undefined while no
 * run tells anything.
 */
export function groupProgress(runs: readonly (MicrosegRun | null)[]): MicrosegRunProgress | undefined {
  const told = runs.flatMap(run => (run?.status === 'running' && run.result?.progress ? [run.result.progress] : []))
  const phase = Math.max(-1, ...told.map(p => PHASES.indexOf(p.phase)))
  if (phase < 0) return undefined
  // A running cluster behind the furthest phase (or not telling where it is) has steps nobody counted yet: the bar
  // shows no figure rather than one that could reach 100% before every cluster is done.
  const running = runs.filter(run => run?.status === 'running')
  if (running.length > told.length || told.some(p => PHASES.indexOf(p.phase) < phase)) return { phase: PHASES[phase], done: 0, total: 0 }
  const current = told.filter(p => PHASES.indexOf(p.phase) === phase)
  let done = current.reduce((n, p) => n + p.done, 0)
  let total = current.reduce((n, p) => n + p.total, 0)
  if (PHASES[phase] === 'writing') {
    for (const run of runs) {
      if (run && run.status !== 'running' && run.result) {
        done += run.result.steps
        total += run.result.steps
      }
    }
  }
  return { phase: PHASES[phase], done, total }
}

export default function RunBar({ run, label, separator, progress: given }: Props) {
  const t = useTranslations('microsegPilot.policy.run.progress')
  const progress = given ?? (run?.status === 'running' ? run.result?.progress : undefined)
  const counted = !!progress && progress.total > 0 && (progress.phase === 'reading' || progress.phase === 'writing')
  const counts = { done: progress?.done ?? 0, total: progress?.total ?? 0 }

  let caption = ''

  if (progress?.phase === 'waiting') caption = t('waiting')
  else if (progress?.phase === 'reading') caption = counted ? t('reading', counts) : t('readingStart')
  else if (progress?.phase === 'writing' && counted) caption = t('writing', counts)

  return (
    <>
      {caption && separator ? (
        <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>{separator}</Typography>
      ) : null}
      {caption ? (
        <Typography variant='caption' color='text.secondary' noWrap sx={{ display: 'block', flexShrink: 0 }}>{caption}</Typography>
      ) : null}
      <LinearProgress
        aria-label={label}
        variant={counted ? 'determinate' : 'indeterminate'}
        value={counted ? Math.min(100, Math.round((counts.done / counts.total) * 100)) : undefined}
        sx={{ flex: 1, minWidth: 48, height: 6, borderRadius: 3, alignSelf: 'center' }}
      />
    </>
  )
}
