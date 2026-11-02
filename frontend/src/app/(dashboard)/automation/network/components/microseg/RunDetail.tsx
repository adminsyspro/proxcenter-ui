'use client'

import { Box, CircularProgress } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useMicrosegRunResult } from '@/lib/microseg/useMicrosegLists'

import ApplyResult from './ApplyResult'
import { OneLine } from './dialogParts'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { useZoneGuests } from './useZoneGuests'

type Props = { connectionId: string; runId: string }

/** The result of one run, read when its row is opened (the list does not carry it). */
export default function RunDetail({ connectionId, runId }: Props) {
  const t = useTranslations('microsegPilot.history.runs.detail')
  const { data: run, error, reload } = useMicrosegRunResult(connectionId, runId)
  const { guests } = useZoneGuests(connectionId)

  if (error && !run) return <MicrosegErrorAlert error={error} onRetry={reload} />
  if (!run) return <CircularProgress size={18} />

  const result = run.result
  const hasOutcome = !!result && ((result.done?.length ?? 0) + (result.failed?.length ?? 0) + (result.not_run?.length ?? 0)
    + (result.errors?.length ?? 0) + (result.notes?.length ?? 0) > 0)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      {result && <OneLine text={t('stats', { guests: result.guests ?? 0, members: result.members ?? 0, steps: result.steps ?? 0 })} />}
      {run.kind === 'remove' && result && (
        <OneLine text={result.complete ? t('removeComplete') : t('removeIncomplete')} color={result.complete ? 'success.main' : 'warning.main'} />
      )}
      {(hasOutcome || run.status === 'failed') && <ApplyResult run={run} guests={guests} />}
    </Box>
  )
}
