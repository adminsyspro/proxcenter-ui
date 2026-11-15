'use client'

import { Box, CircularProgress, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { useMicrosegRunResult } from '@/lib/microseg/useMicrosegLists'

import ApplyResult from './ApplyResult'
import { OneLine } from './dialogParts'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { Notice } from './PlanNotices'
import { ENGINE_KINDS } from './historyModel'
import { hasStepOutcome, runDetailRows, type RunDetailRow } from './runDetailModel'
import TruncatedText from './TruncatedText'
import { useZoneGuests } from './useZoneGuests'

type Props = { connectionId: string; runId: string }

function DetailLine({ row }: Readonly<{ row: RunDetailRow }>) {
  const t = useTranslations('microsegPilot.history.runs.detail')
  const format = useFormatter()
  let value: string
  if ('count' in row) value = format.number(row.count)
  else if ('label' in row) value = t(row.label)
  else value = row.text
  const warn = 'warn' in row && row.warn

  return (
    <Box data-testid='run-detail-line' sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, minWidth: 0 }}>
      <Typography variant='body2' color='text.secondary' noWrap sx={{ flexShrink: 0 }}>{t(`rows.${row.key}`)}</Typography>
      <TruncatedText text={value} variant='body2' fontWeight={500} color={warn ? 'warning.main' : 'text.primary'} sx={{ minWidth: 0, fontVariantNumeric: 'tabular-nums' }} />
    </Box>
  )
}

/** The result of one run, read when its row is opened (the list does not carry it): what the run read, then its outcome. */
export default function RunDetail({ connectionId, runId }: Props) {
  const t = useTranslations('microsegPilot.history.runs.detail')
  const { data: run, error, reload } = useMicrosegRunResult(connectionId, runId)
  const { guests } = useZoneGuests(connectionId)

  if (error && !run) return <MicrosegErrorAlert error={error} onRetry={reload} />
  if (!run) return <CircularProgress size={18} />

  const result = run.result
  const engine = ENGINE_KINDS.has(run.kind)
  const errors = result?.errors ?? []
  // An engine run that wrote nothing tells its errors itself; one that carried out steps, a plan,
  // an apply and a removal draw their outcome (errors included) as an apply's.
  const applyOutcome = engine
    ? hasStepOutcome(run)
    : run.status === 'failed' || hasStepOutcome(run) || errors.length + (result?.notes?.length ?? 0) > 0

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      {engine && <TruncatedText text={t(`scope.${run.kind}`)} variant='body2' color='text.secondary' sx={{ minWidth: 0, mb: 0.5 }} />}
      {runDetailRows(run).map(row => <DetailLine key={row.key} row={row} />)}
      {run.kind === 'remove' && result && (
        <OneLine text={result.complete ? t('removeComplete') : t('removeIncomplete')} color={result.complete ? 'success.main' : 'warning.main'} />
      )}
      {engine && !applyOutcome && run.status === 'failed' && (
        <Notice severity='error' text={run.error ? t('failedWith', { error: run.error }) : t('failed')} />
      )}
      {engine && !applyOutcome && errors.length > 0 && <Notice severity='warning' text={t('errors', { list: errors.join('; ') })} />}
      {applyOutcome && <ApplyResult run={run} guests={guests} />}
    </Box>
  )
}
