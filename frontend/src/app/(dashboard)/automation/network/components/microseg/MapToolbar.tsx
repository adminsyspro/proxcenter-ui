'use client'

import { useCallback, useState } from 'react'
import { Box, Checkbox, FormControlLabel, IconButton, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { ALL_FLOWS, EDGE_COLORS, type FlowFilters } from './zoneGraph'

const STORAGE_KEY = 'microseg.map.flows'

/** The three checkboxes of the map, kept in this browser (a blocked storage just means the defaults: all on). */
export function useFlowFilters(): [FlowFilters, (next: FlowFilters) => void] {
  const [filters, setFilters] = useState<FlowFilters>(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY)
      const saved = raw ? (JSON.parse(raw) as Partial<FlowFilters>) : {}
      return {
        allowed: saved.allowed !== false,
        unprotected: saved.unprotected !== false,
        blocked: saved.blocked !== false,
      }
    } catch {
      return ALL_FLOWS
    }
  })
  const change = useCallback((next: FlowFilters) => {
    setFilters(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Storage refused: the choice lasts as long as the page.
    }
  }, [])
  return [filters, change]
}

function Swatch({ color, dash }: { color: string; dash: 'solid' | 'dashed' | 'dotted' }) {
  return <Box component='span' aria-hidden sx={{ width: 22, borderTop: `2px ${dash} ${color}`, flexShrink: 0 }} />
}

const FILTERS = [
  { key: 'unprotected', color: EDGE_COLORS.unprotected, dash: 'dashed' },
  { key: 'blocked', color: EDGE_COLORS.blocked, dash: 'solid' },
  { key: 'allowed', color: EDGE_COLORS.allowed, dash: 'solid' },
] as const

type Props = {
  filters: FlowFilters
  onFilters: (next: FlowFilters) => void
  refreshedAt: Date | null
  refreshing: boolean
  onRefresh: () => void
}

/**
 * The toolbar of the map: "Flows:" with its three checkboxes (each with the line it draws, so it is the legend too),
 * then the time of the last read with a refresh button. A time range selector would go between the two.
 */
export default function MapToolbar({ filters, onFilters, refreshedAt, refreshing, onRefresh }: Props) {
  const t = useTranslations('microsegPilot.overview')
  const format = useFormatter()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 36 }}>
      <Box role='group' aria-label={t('filters.title')} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <Typography variant='body2' color='text.secondary' sx={{ mr: 0.5 }}>{t('filters.title')}</Typography>
        {FILTERS.map(f => (
          <FormControlLabel
            key={f.key}
            sx={{ mr: 1.5, ml: 0 }}
            control={<Checkbox size='small' checked={filters[f.key]} onChange={(_e, checked) => onFilters({ ...filters, [f.key]: checked })} sx={{ p: 0.5 }} />}
            label={(
              <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                <Swatch color={f.color} dash={f.dash} />
                <Typography component='span' variant='body2'>{t(`legend.${f.key}`)}</Typography>
              </Box>
            )}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Swatch color={EDGE_COLORS.allowed} dash='dotted' />
          <Typography variant='caption' color='text.secondary'>{t('legend.draft')}</Typography>
        </Box>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Swatch color={EDGE_COLORS.outside} dash='dashed' />
          <Typography variant='caption' color='text.secondary'>{t('legend.outside')}</Typography>
        </Box>
      </Box>
      {/* A time range selector would sit here; v1 shows the cumulative observed flows. */}
      <Box sx={{ flex: 1 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        {refreshedAt && (
          <Typography noWrap variant='caption' color='text.secondary'>
            {t('toolbar.refreshedAt', { time: format.dateTime(refreshedAt, { timeStyle: 'medium' }) })}
          </Typography>
        )}
        <Tooltip title={t('toolbar.refresh')}>
          <span>
            <IconButton size='small' aria-label={t('toolbar.refresh')} disabled={refreshing} onClick={onRefresh}>
              <i className='ri-refresh-line' />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  )
}
