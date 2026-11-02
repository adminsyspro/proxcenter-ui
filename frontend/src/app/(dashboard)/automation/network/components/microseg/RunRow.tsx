'use client'

import { useState } from 'react'
import { Box, Chip, Collapse, IconButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegRun } from '@/lib/microseg/types'

import RunDetail from './RunDetail'

const KNOWN_KINDS = new Set(['light', 'ips', 'full', 'log', 'targeted', 'plan', 'apply', 'remove'])
const STATUS_COLOR: Record<string, 'success' | 'error' | 'info'> = { done: 'success', failed: 'error', running: 'info' }

type Props = { connectionId: string; run: MicrosegRun }

/** One run on one line: status, kind, start, duration, API calls, writes and the error; its result sits under the chevron. */
export default function RunRow({ connectionId, run }: Props) {
  const t = useTranslations('microsegPilot.history.runs')
  const tb = useTranslations('microsegPilot.banner.runStatus')
  const tp = useTranslations('microsegPilot.policy')
  const format = useFormatter()
  const [open, setOpen] = useState(false)

  const kind = KNOWN_KINDS.has(run.kind) ? t(`kind.${run.kind}`) : run.kind
  const started = format.dateTime(new Date(run.started_at), { dateStyle: 'medium', timeStyle: 'short' })
  const duration = format.number(run.duration_ms / 1000, { style: 'unit', unit: 'second', unitDisplay: 'narrow', maximumFractionDigits: 1 })

  return (
    <Box role='listitem' aria-label={t('rowLabel', { kind, time: started })} sx={{ borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 44, pr: 1, minWidth: 0 }}>
        <IconButton size='small' aria-expanded={open} aria-label={open ? tp('hideDetails') : tp('showDetails')} onClick={() => setOpen(v => !v)}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
        <Chip size='small' variant='outlined' color={STATUS_COLOR[run.status] ?? 'default'} label={tb(run.status)} sx={{ flexShrink: 0 }} />
        <Tooltip title={kind}><Typography noWrap fontWeight={600} sx={{ flex: '0 1 auto', maxWidth: 160 }}>{kind}</Typography></Tooltip>
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{started}</Typography>
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{duration}</Typography>
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{t('calls', { count: run.api_calls })}</Typography>
        <Typography noWrap color='text.secondary' sx={{ flexShrink: 0 }}>{t('writes', { count: run.writes })}</Typography>
        <Tooltip title={run.error}>
          <Typography noWrap variant='body2' color='error' sx={{ flex: '1 1 0', minWidth: 0 }}>{run.error}</Typography>
        </Tooltip>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ pl: 7, pr: 2, pb: 1.5, minWidth: 0 }}>
          <RunDetail connectionId={connectionId} runId={run.id} />
        </Box>
      </Collapse>
    </Box>
  )
}
