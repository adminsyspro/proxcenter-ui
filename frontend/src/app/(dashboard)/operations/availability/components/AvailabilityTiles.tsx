'use client'

import { useTranslations } from 'next-intl'
import { Box, ButtonBase } from '@mui/material'

import { DonutStatCard, DonutTotalCard } from '@/components/charts/DonutStatCards'

import type { OverviewTiles } from '../hooks/useAvailabilityOverview'

export type TileFilter = 'down' | 'maintenance' | 'coverage'

interface Props {
  tiles: OverviewTiles
  /** Nodes whose current state is down. */
  nodesDown: number
  /** Connections measured with a coverage under 100%. */
  lowCoverage: number
  /** Connections of the page, the total the low coverage tile counts against. */
  connectionsTotal: number
  filter: TileFilter | null
  onFilter: (filter: TileFilter | null) => void
}

// The theme colors, as CSS variables the donuts can fill with.
const COLOR = {
  success: 'var(--mui-palette-success-main)',
  error: 'var(--mui-palette-error-main)',
  info: 'var(--mui-palette-info-main)',
  warning: 'var(--mui-palette-warning-main)',
}
const REMAINDER = 'var(--mui-palette-action-hover)'

/** A count out of a total, worded "n / total", the arc in `color` over the remainder. */
const ratio = (value: number, total: number, color: string) => ({
  value: `${value} / ${total}`,
  segments: [{ value, color }, { value: Math.max(0, total - value), color: REMAINDER }],
})

/** The donut stat cards of the Operations pages: three figures, then three that filter the connections. */
export default function AvailabilityTiles({ tiles, nodesDown, lowCoverage, connectionsTotal, filter, onFilter }: Readonly<Props>) {
  const t = useTranslations('availability')

  const info = [
    { key: 'nodesUp', title: t('tiles.nodesUp'), ...ratio(tiles.nodesUp, tiles.nodesTotal, COLOR.success) },
    { key: 'clustersQuorate', title: t('tiles.clustersQuorate'), ...ratio(tiles.clustersQuorate, tiles.clustersTotal, COLOR.success) },
    ...(tiles.coveredGuestsDown === null
      ? []
      : [{ key: 'coveredGuestsDown', title: t('tiles.coveredGuestsDown'), value: String(tiles.coveredGuestsDown), segments: [{ value: tiles.coveredGuestsDown, color: COLOR.error }] }]),
  ]
  const filters: { key: TileFilter; title: string; value: number; total: number; color: string }[] = [
    { key: 'down', title: t('tiles.nodesDown'), value: nodesDown, total: tiles.nodesTotal, color: COLOR.error },
    { key: 'maintenance', title: t('tiles.nodesMaintenance'), value: tiles.nodesMaintenance, total: tiles.nodesTotal, color: COLOR.info },
    { key: 'coverage', title: t('tiles.lowCoverage'), value: lowCoverage, total: connectionsTotal, color: COLOR.warning },
  ]

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: `repeat(${3 + info.length}, 1fr)` }, gap: 1.5 }}>
      {info.map(i => <DonutTotalCard key={i.key} title={i.title} value={i.value} segments={i.segments} />)}
      {filters.map(f => (
        <ButtonBase
          key={f.key}
          aria-pressed={filter === f.key}
          title={filter === f.key ? t('tiles.clearFilter') : undefined}
          onClick={() => onFilter(filter === f.key ? null : f.key)}
          sx={{
            display: 'block',
            textAlign: 'start',
            borderRadius: 1,
            '& > .MuiCard-root': { height: '100%' },
            ...(filter === f.key ? { outline: 2, outlineStyle: 'solid', outlineColor: f.color } : {}),
          }}
        >
          <DonutStatCard title={f.title} value={f.value} total={f.total} color={f.color} />
        </ButtonBase>
      ))}
    </Box>
  )
}
