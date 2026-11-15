'use client'

import { LinearProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegRun } from '@/lib/microseg/types'

type Props = {
  /** The run being followed (null before its first answer). */
  run: MicrosegRun | null
  /** What the bar is the progress of, for assistive technologies. */
  label: string
  /** Put before the caption when the bar follows a sentence on the same line. */
  separator?: string
}

/**
 * The bar of a run in progress, to lay in a row: what the engine says it is doing (waiting behind another
 * run, reading the guests, writing the plan) and how far it is. An engine that does not say (an older
 * orchestrator, the first poll) leaves a bar that only shows the run is alive.
 */
export default function RunBar({ run, label, separator }: Props) {
  const t = useTranslations('microsegPilot.policy.run.progress')
  const progress = run?.status === 'running' ? run.result?.progress : undefined
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
