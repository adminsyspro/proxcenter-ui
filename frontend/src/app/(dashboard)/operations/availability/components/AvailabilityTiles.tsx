'use client'

import { useTranslations } from 'next-intl'
import { Box, ButtonBase, Typography } from '@mui/material'

import type { OverviewTiles } from '../hooks/useAvailabilityOverview'

import { GlyphIcon, PROXMOX } from './RowGlyph'

export type TileFilter = 'down' | 'maintenance' | 'coverage'

interface Props {
  tiles: OverviewTiles
  /** Nodes whose current state is down. */
  nodesDown: number
  /** Connections measured with a coverage under 100%. */
  lowCoverage: number
  filter: TileFilter | null
  onFilter: (filter: TileFilter | null) => void
}

const tileSx = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 0.5,
  p: 2,
  textAlign: 'start',
  border: 1,
  borderColor: 'divider',
  borderRadius: 1,
  bgcolor: 'background.paper',
  borderTopWidth: 3,
}

export default function AvailabilityTiles({ tiles, nodesDown, lowCoverage, filter, onFilter }: Props) {
  const t = useTranslations('availability')

  const info = [
    { key: 'nodesUp', icon: PROXMOX, label: t('tiles.nodesUp'), value: `${tiles.nodesUp} / ${tiles.nodesTotal}`, color: 'success.main' },
    { key: 'clustersQuorate', icon: 'ri-server-line', label: t('tiles.clustersQuorate'), value: `${tiles.clustersQuorate} / ${tiles.clustersTotal}`, color: 'success.main' },
    ...(tiles.coveredGuestsDown === null
      ? []
      : [{ key: 'coveredGuestsDown', icon: 'ri-computer-line', label: t('tiles.coveredGuestsDown'), value: String(tiles.coveredGuestsDown), color: 'error.main' }]),
  ]
  const filters: { key: TileFilter; icon: string; label: string; value: number; color: string }[] = [
    { key: 'down', icon: 'ri-error-warning-line', label: t('tiles.nodesDown'), value: nodesDown, color: 'error.main' },
    { key: 'maintenance', icon: 'ri-tools-line', label: t('tiles.nodesMaintenance'), value: tiles.nodesMaintenance, color: 'info.main' },
    { key: 'coverage', icon: 'ri-eye-off-line', label: t('tiles.lowCoverage'), value: lowCoverage, color: 'warning.main' },
  ]

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: `repeat(${3 + info.length}, 1fr)` }, gap: 1.5 }}>
      {info.map(i => (
        <Box key={i.key} sx={{ ...tileSx, borderTopColor: i.color }}>
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
            <GlyphIcon icon={i.icon} /> {i.label}
          </Typography>
          <Typography variant='h5'>{i.value}</Typography>
        </Box>
      ))}
      {filters.map(f => (
        <ButtonBase
          key={f.key}
          aria-pressed={filter === f.key}
          title={filter === f.key ? t('tiles.clearFilter') : undefined}
          onClick={() => onFilter(filter === f.key ? null : f.key)}
          sx={{ ...tileSx, borderTopColor: f.color, ...(filter === f.key ? { outline: 2, outlineStyle: 'solid', outlineColor: f.color } : {}) }}
        >
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
            <i className={f.icon} aria-hidden='true' /> {f.label}
          </Typography>
          <Typography variant='h5'>{f.value}</Typography>
        </ButtonBase>
      ))}
    </Box>
  )
}
