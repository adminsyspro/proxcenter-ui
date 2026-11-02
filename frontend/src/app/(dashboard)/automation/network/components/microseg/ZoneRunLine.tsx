'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Alert, CircularProgress, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { ZoneState } from '@/lib/microseg/types'
import { useMicrosegRun } from '@/lib/microseg/useMicroseg'

type Props = {
  connectionId: string
  runId: string
  zoneName: string
  state: ZoneState
  /** Called once when the run has ended (done or failed). */
  onFinished: () => void
  onDismiss: () => void
}

/** The progress of a zone state change, on one line: running, then the counts of steps done, failed and not run (UA13). */
export default function ZoneRunLine({ connectionId, runId, zoneName, state, onFinished, onDismiss }: Props) {
  const t = useTranslations('microsegPilot.policy.run')
  const { run, done, error } = useMicrosegRun(connectionId, runId)

  const finished = useRef(onFinished)
  useEffect(() => { finished.current = onFinished })
  useEffect(() => {
    if (done) finished.current()
  }, [done, runId])

  let text: string
  let severity: 'info' | 'success' | 'warning' | 'error' = 'info'
  let icon: ReactNode = <CircularProgress size={16} />
  let detail: string | undefined

  if (run?.status === 'failed') {
    text = t('failed', { zone: zoneName })
    severity = 'error'
    icon = undefined
    detail = run.error || undefined
  } else if (run?.status === 'done') {
    const failed = run.result?.failed?.length ?? 0
    text = t('done', { zone: zoneName, done: run.result?.done?.length ?? 0, failed, notRun: run.result?.not_run?.length ?? 0 })
    severity = failed > 0 ? 'warning' : 'success'
    icon = undefined
  } else if (error && !run) {
    text = t('unavailable', { zone: zoneName })
    severity = 'warning'
    icon = undefined
  } else {
    text = t(`running.${state}`, { zone: zoneName })
  }

  return (
    <Alert
      severity={severity}
      icon={icon}
      variant='outlined'
      onClose={done || (error && !run) ? onDismiss : undefined}
      sx={{ mb: 2, py: 0, '& .MuiAlert-message': { minWidth: 0, overflow: 'hidden' } }}
    >
      <Tooltip title={detail ? `${text} ${detail}` : text}>
        <Typography variant='body2' noWrap>{text}</Typography>
      </Tooltip>
    </Alert>
  )
}
