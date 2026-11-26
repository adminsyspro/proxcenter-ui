'use client'

import { Box, LinearProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { ReverseSyncProgress } from '@/lib/orchestrator/site-recovery.types'
import { formatBytes } from '@/utils/format'

/** Whole seconds as "1 h 02 min", "4 min 05 s" or "12 s". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, '0')

  if (h > 0) return `${h} h ${pad(m)} min`
  if (m > 0) return `${m} min ${pad(s % 60)} s`

  return `${s} s`
}

/** Share of the estimate streamed so far, held at 99 until the pass lands. */
export function passPercent(progress: ReverseSyncProgress): number | null {
  if (progress.stage !== 'transferring' || !progress.total_bytes || progress.total_bytes <= 0) return null

  return Math.min(99, Math.max(0, Math.floor((progress.bytes / progress.total_bytes) * 100)))
}

interface Props {
  progress: ReverseSyncProgress
  /** Injected by tests; the dialog re-renders on every execution poll. */
  now?: number
}

/**
 * The reverse sync pass running for one VM of a failback: what it is doing
 * (aligning the source, streaming disk n of N), how much of the disk's stream
 * went through, at what rate, and for how long the pass has run. A pass can
 * take hours on a large image, and before this the dialog stayed unchanged
 * until it landed.
 */
export default function ReverseSyncPassProgress({ progress, now = Date.now() }: Props) {
  const t = useTranslations()
  const percent = passPercent(progress)
  const elapsed = formatElapsed((now - new Date(progress.started_at).getTime()) / 1000)

  const stage = progress.stage === 'aligning'
    ? t('siteRecovery.failback.pass.aligning')
    : t('siteRecovery.failback.pass.transferring', { disk: progress.disk ?? 1, disks: progress.disks ?? 1 })

  const figures: string[] = []

  if (progress.stage === 'transferring') {
    figures.push(progress.total_bytes
      ? t('siteRecovery.failback.pass.sentOf', { sent: formatBytes(progress.bytes), total: formatBytes(progress.total_bytes) })
      : formatBytes(progress.bytes))
    if (progress.throughput_bps) figures.push(`${formatBytes(progress.throughput_bps)}/s`)
  }

  figures.push(t('siteRecovery.failback.pass.elapsed', { elapsed }))

  return (
    <Box data-testid='reverse-sync-pass' sx={{ mt: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.25 }}>
        <Typography variant='caption' sx={{ flex: 1, minWidth: 0, fontSize: '0.7rem', color: 'text.secondary' }}>
          {stage}
        </Typography>
        <Typography variant='caption' sx={{ fontSize: '0.7rem', color: 'text.secondary', textAlign: 'right', whiteSpace: 'nowrap' }}>
          {percent === null ? figures.join(' · ') : `${percent}% · ${figures.join(' · ')}`}
        </Typography>
      </Box>
      <LinearProgress
        variant={percent === null ? 'indeterminate' : 'determinate'}
        value={percent ?? undefined}
        aria-label={stage}
        sx={{ height: 4, borderRadius: 2 }}
      />
    </Box>
  )
}
