'use client'

import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError } from '@/lib/microseg/api'
import type { MicrosegRun } from '@/lib/microseg/types'

import { CheckLog, CheckRowList } from './CheckRows'
import { checkRows, stepLog } from './checkModel'
import { DialogErrorLine, ONE_LINE_SX, OneLine } from './dialogParts'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import type { MicrosegCheck } from './useMicrosegCheck'
import { useNow } from './useNow'
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

/** The progress of the run while it goes on: the engine records its figures and its steps when it ends. */
function Running({ run, error }: { run: MicrosegRun; error: unknown }) {
  const t = useTranslations('microsegPilot.check')
  const now = useNow(1000, run.status)
  const elapsed = seconds(now - Date.parse(run.started_at))
  const text = run.api_calls > 0
    ? t('progress', { calls: run.api_calls, writes: run.writes, seconds: elapsed })
    : t('inProgress', { seconds: elapsed })
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <Waiting text={text} error={error} />
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
    default:
      return <Waiting text={t('queued')} error={check.pollError} />
  }
}

type Props = {
  check: MicrosegCheck
  connectionId: string
  onClose: () => void
  /** Shows the Drifts sub-tab (the window closes). */
  onOpenDrifts: () => void
}

/** The window of a manual check: queued, then running, then its outcome and its log. */
export default function CheckDialog({ check, connectionId, onClose, onOpenDrifts }: Props) {
  const t = useTranslations('microsegPilot.check')
  const tAll = useTranslations()
  const { canWrite } = useMicrosegWrite()
  const ended = !check.active && check.phase.kind !== 'idle'

  return (
    <Dialog open onClose={onClose} maxWidth='md' fullWidth aria-labelledby='microseg-check-title'>
      <DialogTitle id='microseg-check-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <DialogContent>
        {/* MUI sets no top padding under a title: the first line keeps 8 px from it. */}
        <Box sx={{ pt: 1, minWidth: 0 }}>
          <Body check={check} connectionId={connectionId} onOpenDrifts={onOpenDrifts} />
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {ended && (
          <WriteTip>
            <Button onClick={() => void check.start()} disabled={!canWrite}>{t('runAgain')}</Button>
          </WriteTip>
        )}
        <Button onClick={onClose} variant='contained'>{tAll('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
