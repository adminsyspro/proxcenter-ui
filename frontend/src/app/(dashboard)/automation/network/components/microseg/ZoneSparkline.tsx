'use client'

import { Box, Tooltip, Typography, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { ZoneState } from '@/lib/microseg/types'

/** The drawing box of the bars: one 10-unit slot per bucket (8 of bar, 2 of gap), stretched to the card's width. */
const SLOT = 10
const BAR = 8
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
  const theme = useTheme()

  if (state === 'disabled') {
    return (
      <Box data-zone-sparkline sx={{ minWidth: 0 }}>
        <Typography variant='caption' color='text.disabled' noWrap sx={{ display: 'block' }}>{t('disabled')}</Typography>
      </Box>
    )
  }

  const colour = state === 'enforce' ? 'error.main' : 'warning.main'
  const total = series?.reduce((a, b) => a + b, 0) ?? null
  const peak = series ? Math.max(0, ...series) : 0
  const hour = (i: number) => format.dateTime(new Date(from + i * stepMs), { hour: '2-digit', minute: '2-digit' })
  const label = total === null ? t('loading') : t(state === 'enforce' ? 'blocked' : 'wouldBlock', { count: total })

  return (
    <Box data-zone-sparkline sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
        <Typography variant='caption' color='text.secondary' noWrap>{t('title')}</Typography>
        <Typography variant='caption' color='text.primary' fontWeight={600} noWrap data-testid='zone-sparkline-total'>{label}</Typography>
      </Box>
      <Box
        component='svg'
        role='img'
        aria-label={total === null ? t('loading') : t('aria', { count: total })}
        viewBox={`0 0 ${(series?.length || 24) * SLOT} ${HEIGHT}`}
        preserveAspectRatio='none'
        sx={{ display: 'block', width: '100%', height: HEIGHT, mt: 0.25, color: colour }}
      >
        {(series ?? new Array<number>(24).fill(0)).map((n, i) => {
          const h = peak > 0 && n > 0 ? Math.max(2, (n / peak) * HEIGHT) : 1
          return (
            <Tooltip key={i} title={series ? t('bar', { from: hour(i), to: hour(i + 1), count: n }) : ''} disableInteractive>
              <g data-bucket={i} data-hits={n}>
                {/* The hit target is the whole slot height, bigger than the bar. */}
                <rect x={i * SLOT} y={0} width={SLOT} height={HEIGHT} fill='transparent' />
                <rect x={i * SLOT + (SLOT - BAR) / 2} y={HEIGHT - h} width={BAR} height={h} style={{ fill: n > 0 ? 'currentColor' : theme.palette.divider }} />
              </g>
            </Tooltip>
          )
        })}
      </Box>
    </Box>
  )
}
