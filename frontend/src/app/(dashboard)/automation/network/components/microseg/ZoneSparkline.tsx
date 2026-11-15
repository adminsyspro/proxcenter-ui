'use client'

import { Box, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { ZoneState } from '@/lib/microseg/types'

import HourlyBars from './HourlyBars'

const HEIGHT = 24

type Props = {
  state: ZoneState
  /** The hits per bucket, oldest first; null while the history is read. */
  series: number[] | null
  /** Start of the first bucket (ms) and the bucket width. */
  from: number
  stepMs: number
}

/**
 * The uncovered traffic into a zone over the last 24 hours, one bar per hour: what an observed zone would block, what
 * an enforced zone blocks. The bars take the colour of the zone's state (warning, error) and the line above says the
 * same in words with the total, so the colour is never alone; each bar's hour and count show on hover. A disabled
 * zone logs nothing: the line says so and no bars are drawn.
 */
export default function ZoneSparkline({ state, series, from, stepMs }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.policy.zone.sparkline')
  const format = useFormatter()

  if (state === 'disabled') {
    return (
      <Box data-zone-sparkline sx={{ minWidth: 0 }}>
        <Typography variant='caption' color='text.disabled' noWrap sx={{ display: 'block' }}>{t('disabled')}</Typography>
      </Box>
    )
  }

  const colour = state === 'enforce' ? 'error.main' : 'warning.main'
  const total = series?.reduce((a, b) => a + b, 0) ?? null
  const hour = (i: number) => format.dateTime(new Date(from + i * stepMs), { hour: '2-digit', minute: '2-digit' })
  // The total in short (278K): the exact count is in the tooltip and the accessible name.
  const short = total === null ? '' : format.number(total, { notation: 'compact', maximumFractionDigits: 1 })
  const label = total === null ? t('loading') : t(state === 'enforce' ? 'blocked' : 'wouldBlock', { count: total, short })

  return (
    <Box data-zone-sparkline sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
        <Typography variant='caption' color='text.secondary' noWrap>{t('title')}</Typography>
        <Tooltip title={total === null ? '' : t('aria', { count: total })} disableInteractive>
          <Typography variant='caption' color='text.primary' fontWeight={600} noWrap data-testid='zone-sparkline-total' sx={{ flexShrink: 0 }}>{label}</Typography>
        </Tooltip>
      </Box>
      <Box sx={{ mt: 0.25 }}>
        <HourlyBars
          series={series}
          colour={colour}
          height={HEIGHT}
          ariaLabel={total === null ? t('loading') : t('aria', { count: total })}
          barLabel={(i, n) => t('bar', { from: hour(i), to: hour(i + 1), count: n })}
        />
      </Box>
    </Box>
  )
}
