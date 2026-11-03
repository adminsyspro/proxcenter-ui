'use client'

import { Box, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MicrosegRun } from '@/lib/microseg/types'

import { Notice } from './PlanNotices'
import PlanSteps from './PlanSteps'
import type { PolicyGuest } from './zoneModel'

/** The orchestrator's note that a write was made while the emergency stop holds the cluster firewall off. */
const STOP_NOTE_RE = /written while the emergency stop/i

type Props = { run: MicrosegRun; guests: PolicyGuest[] }

/** The outcome of a finished apply run: counts, why it stopped, then the failed steps and the ones not run, per guest. */
export default function ApplyResult({ run, guests }: Props) {
  const t = useTranslations('microsegPilot.plan')
  const result = run.result
  const failed = result?.failed ?? []
  const notRun = result?.not_run ?? []

  // A run that did not complete its plan is `failed` and still carries its whole result.
  const failure = run.status === 'failed' ? <Notice severity='error' text={run.error ? t('applyFailedWith', { error: run.error }) : t('applyFailed')} /> : null
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
      {failed.length > 0 && (
        <Box>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('failedSection')}</Typography>
          <PlanSteps steps={failed} guests={guests} />
        </Box>
      )}
      {notRun.length > 0 && (
        <Box>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('notRunSection')}</Typography>
          <PlanSteps steps={notRun} guests={guests} />
        </Box>
      )}
    </Box>
  )
}
