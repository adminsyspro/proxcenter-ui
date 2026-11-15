'use client'

import type { ReactNode } from 'react'
import { Box, Checkbox, FormControlLabel, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useStored, useStoredChoice } from './useStoredChoice'
import { ALL_FLOWS, EDGE_COLORS, type FlowFilters } from './zoneGraph'

const STORAGE_KEY = 'microseg.map.flows'
const VIEW_KEY = 'microseg.map.view'

/** The renderings of the map; Groups (circles holding their guests) is the reference and the default. */
export const MAP_VIEWS = ['groups', 'compact', 'matrix', 'guests', 'sankey', 'nodes'] as const
export type MapView = (typeof MAP_VIEWS)[number]
const VIEW_ICONS: Record<MapView, string> = { groups: 'ri-bubble-chart-line', compact: 'ri-flow-chart', matrix: 'ri-grid-line', guests: 'ri-focus-3-line', sankey: 'ri-git-branch-line', nodes: 'ri-server-line' }

/** The rendering of the map, kept in this browser (a blocked storage, or an unknown value, just means Groups). */
export function useMapView(): [MapView, (next: MapView) => void] {
  return useStoredChoice(VIEW_KEY, MAP_VIEWS, 'groups')
}

/** The rendering selector: one icon button per rendering, its name in a tooltip and for screen readers. */
export function ViewSwitch({ view, onView }: { view: MapView; onView: (next: MapView) => void }) {
  const t = useTranslations('microsegPilot.overview.view')
  return (
    <ToggleButtonGroup
      exclusive
      size='small'
      value={view}
      aria-label={t('label')}
      onChange={(_e, next: MapView | null) => { if (next) onView(next) }}
      sx={{ mr: 1, '& .MuiToggleButton-root': { px: 1, py: 0.5 } }}
    >
      {MAP_VIEWS.map(v => (
        <Tooltip key={v} title={`${t(v)}: ${t(`${v}Hint`)}`}>
          <ToggleButton value={v} aria-label={t(v)}>
            <i className={VIEW_ICONS[v]} aria-hidden style={{ fontSize: 18 }} />
          </ToggleButton>
        </Tooltip>
      ))}
    </ToggleButtonGroup>
  )
}

/** The stored checkboxes: each one on unless stored off (nothing stored, or unreadable: all on). */
function decodeFilters(raw: string | null): FlowFilters {
  try {
    const saved = raw ? (JSON.parse(raw) as Partial<FlowFilters>) : {}
    return { allowed: saved.allowed !== false, unprotected: saved.unprotected !== false, blocked: saved.blocked !== false }
  } catch {
    return ALL_FLOWS
  }
}
const encodeFilters = (filters: FlowFilters) => JSON.stringify(filters)

/** The three checkboxes of the map, kept in this browser (a blocked storage just means the defaults: all on). */
export function useFlowFilters(): [FlowFilters, (next: FlowFilters) => void] {
  return useStored(STORAGE_KEY, decodeFilters, encodeFilters)
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
  /** The rendering selector is drawn only when both are given. */
  view?: MapView
  onView?: (next: MapView) => void
  /** Drawn after the rendering selector (the Overview puts its "Target a VM" search there). */
  lead?: ReactNode
  filters: FlowFilters
  onFilters: (next: FlowFilters) => void
}

/**
 * The toolbar of the map: the rendering selector, "Flows:" with its three checkboxes (each with the line it draws, so it is the legend too),
 * then the three lines it draws without a checkbox (allowed not applied yet, exception between guests, to the outside).
 */
export default function MapToolbar({ view, onView, lead, filters, onFilters }: Props) {
  const t = useTranslations('microsegPilot.overview')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', minHeight: 36 }}>
      {view && onView && <ViewSwitch view={view} onView={onView} />}
      {lead}
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
          <Swatch color={EDGE_COLORS.exception} dash='dashed' />
          <Typography variant='caption' color='text.secondary'>{t('legend.exception')}</Typography>
        </Box>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
          <Swatch color={EDGE_COLORS.outside} dash='dashed' />
          <Typography variant='caption' color='text.secondary'>{t('legend.outside')}</Typography>
        </Box>
      </Box>
    </Box>
  )
}
