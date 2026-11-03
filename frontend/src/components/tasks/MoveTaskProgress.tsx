'use client'

import { Box, LinearProgress, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { MoveProgress } from '@/lib/tasks/moveProgress'
import { formatEta } from '@/lib/tasks/taskProgressDisplay'
import { formatBytes } from '@/utils/format'

/** What the tooltip says about a move: bytes copied, throughput, time left, as far as known. */
export function moveProgressDetails(p: MoveProgress, t: (key: string, values?: Record<string, string>) => string): string {
  const parts: string[] = []
  if (p.doneBytes !== null && p.totalBytes !== null) {
    parts.push(t('tasks.moveProgress.bytes', { done: formatBytes(p.doneBytes, 1), total: formatBytes(p.totalBytes, 1) }))
  }
  if (p.bytesPerSec) parts.push(`${formatBytes(p.bytesPerSec, 1)}/s`)
  if (p.etaSec) parts.push(t('tasks.moveProgress.eta', { eta: formatEta(p.etaSec) }))

  return parts.join(', ')
}

/**
 * Progress of a running disk or volume move (roadmap#196), on one line of a
 * task row: a determinate bar and its percentage, the details in the tooltip.
 */
export default function MoveTaskProgress({ progress }: Readonly<{ progress: MoveProgress }>) {
  const t = useTranslations()
  const percent = Math.round(progress.percent)
  const details = moveProgressDetails(progress, t)

  return (
    <Tooltip title={details || t('tasks.moveProgress.label')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', height: '100%' }}>
        <LinearProgress
          variant="determinate"
          value={percent}
          aria-label={t('tasks.moveProgress.label')}
          sx={{ flex: 1, height: 6, borderRadius: 1 }}
        />
        <Typography variant="caption" noWrap sx={{ minWidth: 32, textAlign: 'right' }}>
          {percent}%
        </Typography>
      </Box>
    </Tooltip>
  )
}
