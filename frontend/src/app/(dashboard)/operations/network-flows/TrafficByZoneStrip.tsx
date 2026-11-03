'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Card, CardContent, Tooltip, Typography } from '@mui/material'

import { formatBytes } from '@/utils/format'
import { sourceZoneSlices, trafficDistribution, type LensPair, type TrafficShare, type ZoneSlice } from '@/lib/microseg/trafficLens'

import type { TrafficLens } from './useTrafficLens'

const DONUT_SIZE = 96
const DONUT_STROKE = 16
const RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

const percentText = (percent: number) => `${percent.toFixed(percent > 0 && percent < 10 ? 1 : 0)}%`

/** One figure of the strip: its label, its share of the bytes and its volume, on one line each. */
function ShareTile({ label, value, testId }: { label: string; value: TrafficShare; testId: string }) {
  return (
    <Box data-testid={testId} sx={{ minWidth: 0, p: 1.25, borderRadius: 1.5, bgcolor: 'action.hover' }}>
      <Typography variant='caption' color='text.secondary' noWrap component='div'>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
        <Typography variant='h6' fontWeight={700} fontSize={18}>{percentText(value.percent)}</Typography>
        <Typography variant='caption' color='text.secondary' noWrap>{formatBytes(value.bytes)}</Typography>
      </Box>
    </Box>
  )
}

/** A ring of the source zones, each arc in its zone colour (drawn with dashed circles, no chart library). */
function SourceDonut({ slices, lens }: { slices: ZoneSlice[]; lens: TrafficLens }) {
  const t = useTranslations('microsegPilot.trafficLens.summary')
  const lengths = slices.map(s => (s.percent / 100) * CIRCUMFERENCE)
  const offsets = lengths.map((_, i) => lengths.slice(0, i).reduce((sum, l) => sum + l, 0))
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} role='img' aria-label={t('bySourceZone')} style={{ flexShrink: 0 }}>
        <g transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}>
          {slices.map((s, i) => (
              <circle
                key={s.key}
                data-testid={`donut-${s.key}`}
                cx={DONUT_SIZE / 2}
                cy={DONUT_SIZE / 2}
                r={RADIUS}
                fill='none'
                stroke={lens.colorOf(s.key)}
                strokeWidth={DONUT_STROKE}
                strokeDasharray={`${lengths[i]} ${CIRCUMFERENCE - lengths[i]}`}
                strokeDashoffset={-offsets[i]}
              >
                <title>{`${lens.labelOf(s.key)}: ${percentText(s.percent)} · ${formatBytes(s.bytes)}`}</title>
              </circle>
          ))}
        </g>
      </svg>
      <Box sx={{ minWidth: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', columnGap: 1.5, rowGap: 0.25, flex: 1 }}>
        <Typography variant='caption' color='text.secondary' fontWeight={600} sx={{ gridColumn: '1 / -1' }}>{t('bySourceZone')}</Typography>
        {slices.map(s => (
          <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Box component='span' sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: lens.colorOf(s.key), flexShrink: 0 }} />
            <Tooltip title={`${lens.labelOf(s.key)} · ${formatBytes(s.bytes)}`}>
              <Typography variant='caption' noWrap sx={{ minWidth: 0 }}>{lens.labelOf(s.key)}</Typography>
            </Tooltip>
            <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0, ml: 'auto' }}>{percentText(s.percent)}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** Where the observed bytes go, read through the zones: inside a zone, between zones, out, in from unknown sources. */
export default function TrafficByZoneStrip({ pairs, lens }: { pairs: LensPair[]; lens: TrafficLens }) {
  const t = useTranslations('microsegPilot.trafficLens.summary')
  const distribution = useMemo(() => trafficDistribution(pairs, lens.resolve), [pairs, lens])
  const slices = useMemo(() => sourceZoneSlices(pairs, lens.resolve), [pairs, lens])

  return (
    <Card variant='outlined' sx={{ borderRadius: 2 }} data-testid='traffic-by-zone'>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant='subtitle2' fontWeight={700} sx={{ mb: 1.5 }}>
          <i className='ri-shield-keyhole-line' style={{ fontSize: 16, marginRight: 6 }} />
          {t('title')}
        </Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 3fr) minmax(0, 2fr)' }, gap: 2, alignItems: 'center' }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 1.5 }}>
            <ShareTile testId='share-intra' label={t('intra')} value={distribution.intra} />
            <ShareTile testId='share-between' label={t('between')} value={distribution.between} />
            <ShareTile testId='share-outside' label={t('toOutside')} value={distribution.toOutside} />
            <ShareTile testId='share-unknown' label={t('fromUnknown')} value={distribution.fromUnknown} />
          </Box>
          {slices.length > 0 && <SourceDonut slices={slices} lens={lens} />}
        </Box>
      </CardContent>
    </Card>
  )
}
