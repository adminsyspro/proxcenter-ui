'use client'

import { Box, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { EgressState, ZoneState } from '@/lib/microseg/types'

import HourlyBars from './HourlyBars'
import SparkLine from './SparkLine'
import { EDGE_COLORS } from './zoneGraph'

const HEIGHT = 24

/** The outbound series: the blue of the blocked edges of the map, apart from the amber and red of the inbound states. */
const OUTBOUND_COLOUR = EDGE_COLORS.blocked

function LegendKey({ colour, label }: { colour: string; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Box component='span' aria-hidden sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: colour, flexShrink: 0 }} />
      <Typography variant='caption' color='text.secondary' noWrap sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
    </Box>
  )
}

const OUT_WORDING = { enforce: 'outBlocked', observe: 'outWouldBlock', off: 'outConnections' } as const

type Props = {
  state: ZoneState
  /** The hits per bucket, oldest first; null while the history is read. */
  series: number[] | null
  /** The outbound hits per bucket (the traffic the zone emitted); absent, null or all 0: one series, no legend. */
  outSeries?: number[] | null
  /** The outbound state of the zone: words the outbound part of the total (blocked or would be blocked). */
  outState?: EgressState
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
/** The colour of the zone's state, whether outbound traffic splits the series, the total and the words of the total. */
function useUncoveredWords(state: ZoneState, series: number[] | null, outSeries: number[] | null, outState: EgressState) {
  const t = useTranslations('microsegPilot.policy.zone.sparkline')
  const format = useFormatter()
  const colour = state === 'enforce' ? 'error.main' : 'warning.main'
  // Two series only when outbound traffic exists; the total then counts both, the legend tells which is which.
  const outTotal = outSeries?.reduce((a, b) => a + b, 0) ?? 0
  const split = outTotal > 0
  const inTotal = series?.reduce((a, b) => a + b, 0) ?? null
  const total = inTotal === null ? null : inTotal + outTotal
  // The total in short (278K): the exact count is in the tooltip and the accessible name.
  const compact = (n: number) => format.number(n, { notation: 'compact', maximumFractionDigits: 1 })
  // Each side is worded with its own state: the zone's for the inbound hits, its outbound state for the outbound hits.
  const inLabel = (n: number) => t(state === 'enforce' ? 'blocked' : 'wouldBlock', { count: n, short: compact(n) })
  // Outbound hits still in the 24 h window after the zone's outbound went off are plain traffic, nothing is blocked or would be.
  const outLabel = t(OUT_WORDING[outState], { short: compact(outTotal) })
  let label = t('loading')
  if (inTotal !== null) label = split ? [inTotal > 0 ? inLabel(inTotal) : '', outLabel].filter(Boolean).join(' · ') : inLabel(inTotal)
  return { colour, split, total, label }
}

/**
 * The same 24 hours on one line, for a zone shown as a row: a line instead of the bars (inbound, and outbound in blue
 * when there is some), the total in words at its right; the exact count on hover. A disabled zone logs nothing: the
 * cell says so.
 */
export function ZoneSparkCell({ state, series, outSeries = null, outState = 'observe' }: Readonly<Pick<Props, 'state' | 'series' | 'outSeries' | 'outState'>>) {
  const t = useTranslations('microsegPilot.policy.zone.sparkline')
  const { colour, split, total, label } = useUncoveredWords(state, series, outSeries, outState)
  if (state === 'disabled') return <Typography data-zone-sparkline variant='caption' color='text.disabled' noWrap sx={{ display: 'block', minWidth: 0 }}>{t('disabled')}</Typography>
  const aria = total === null ? t('loading') : t('aria', { count: total })
  // The words have a track of their own, the same width on every row: every line is as long as the others.
  return (
    <Tooltip title={total === null ? '' : <>{label}<br />{aria}</>} disableInteractive>
      <Box data-zone-sparkline sx={{ display: 'grid', gridTemplateColumns: 'minmax(48px, 1fr) minmax(0, 40%)', alignItems: 'center', columnGap: 1, minWidth: 0 }}>
        <Box sx={{ minWidth: 0 }}>
          <SparkLine series={series} colour={colour} second={split ? outSeries : null} secondColour={OUTBOUND_COLOUR} height={20} ariaLabel={aria} />
        </Box>
        <Typography variant='caption' fontWeight={600} noWrap data-testid='zone-sparkline-total' sx={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</Typography>
      </Box>
    </Tooltip>
  )
}

export default function ZoneSparkline({ state, series, outSeries = null, outState = 'observe', from, stepMs }: Readonly<Props>) {
  const t = useTranslations('microsegPilot.policy.zone.sparkline')
  const format = useFormatter()

  const { colour, split, total, label } = useUncoveredWords(state, series, outSeries, outState)

  if (state === 'disabled') {
    return (
      <Box data-zone-sparkline sx={{ minWidth: 0 }}>
        <Typography variant='caption' color='text.disabled' noWrap sx={{ display: 'block' }}>{t('disabled')}</Typography>
      </Box>
    )
  }

  const hour = (i: number) => format.dateTime(new Date(from + i * stepMs), { hour: '2-digit', minute: '2-digit' })

  return (
    <Box data-zone-sparkline sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
        <Typography variant='caption' color='text.secondary' noWrap sx={{ flexShrink: 0 }}>{t('title')}</Typography>
        <Tooltip title={total === null ? '' : t('aria', { count: total })} disableInteractive>
          <Typography variant='caption' color='text.primary' fontWeight={600} noWrap data-testid='zone-sparkline-total' sx={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</Typography>
        </Tooltip>
      </Box>
      <Box sx={{ mt: 0.25 }}>
        <HourlyBars
          series={series}
          colour={colour}
          second={split ? outSeries : null}
          secondColour={OUTBOUND_COLOUR}
          height={HEIGHT}
          ariaLabel={total === null ? t('loading') : t('aria', { count: total })}
          barLabel={(i, n, out) => (split ? t('barBoth', { from: hour(i), to: hour(i + 1), count: n, out }) : t('bar', { from: hour(i), to: hour(i + 1), count: n }))}
        />
      </Box>
      {split && (
        <Box data-testid='zone-sparkline-legend' sx={{ display: 'flex', gap: 1.5, mt: 0.25, minWidth: 0 }}>
          <LegendKey colour={colour} label={t('legendIn')} />
          <LegendKey colour={OUTBOUND_COLOUR} label={t('legendOut')} />
        </Box>
      )}
    </Box>
  )
}
