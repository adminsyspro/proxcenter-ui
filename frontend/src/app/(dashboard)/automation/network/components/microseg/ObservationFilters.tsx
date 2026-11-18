'use client'

import { useContext, type ReactNode } from 'react'
import { Box, MenuItem, Select } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { FlowDirection, MicrosegZone, SuggestionKind, SuggestionStatus } from '@/lib/microseg/types'

import { MicrosegActionsSlot, SlotActions } from './microsegAccess'

/** `cluster`: the flows of one cluster of a shared policy, '' (or absent) for every cluster. */
export type ObservationFilterValues = { kind: '' | SuggestionKind; status: '' | SuggestionStatus; zone: string; direction: '' | FlowDirection; cluster?: string }

type Props = {
  values: ObservationFilterValues
  zones: MicrosegZone[]
  onChange: (values: ObservationFilterValues) => void
  /** The clusters of a shared policy the user sees (`clusterFilterOptions`): none, and the Cluster filter is not shown. */
  clusters?: { value: string; label: string }[]
}

const KINDS: SuggestionKind[] = ['would_block', 'blocked']
const STATUSES: SuggestionStatus[] = ['pending', 'accepted', 'dismissed']
const DIRECTIONS: FlowDirection[] = ['in', 'out']

/**
 * The height and type of the small buttons of the row (Check now, Emergency stop): a select of the row is as tall and
 * writes as large, its name in grey before the value ("Type All types") instead of a floating label above the frame.
 */
const COMPACT_SELECT_SX = {
  height: 30,
  // The type of a small button (pxToRem(13)), so it follows the root size the way the buttons do.
  fontSize: '0.8125rem',
  // The filters share the room left on the row of the tabs, each growing from the width of its own content (its name and
  // value), so a longer one takes more than a short one; never narrower than a short value, then its value is cut.
  flex: '1 1 auto',
  minWidth: 130,
  // The right padding is the room of the arrow: the value is cut by an ellipsis (in its own box below) before it.
  '& .MuiSelect-select': { py: 0, pl: 1.25, pr: '32px !important', display: 'flex', alignItems: 'center', minHeight: 0, minWidth: 0 },
} as const

function FilterSelect<T extends string>({ name, value, options, onChange }: Readonly<{
  name: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}>) {
  const labelOf = (v: T): ReactNode => options.find(o => o.value === v)?.label ?? v
  return (
    <Select
      size='small'
      displayEmpty
      value={value}
      onChange={e => onChange(e.target.value as T)}
      renderValue={v => (
        <Box component='span' sx={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Box component='span' sx={{ color: 'text.secondary', mr: 0.75 }}>{name}</Box>
          {labelOf(v as T)}
        </Box>
      )}
      inputProps={{ 'aria-label': name }}
      sx={COMPACT_SELECT_SX}
    >
      {options.map(o => <MenuItem key={o.value || 'all'} value={o.value} sx={{ fontSize: '0.8125rem' }}>{o.label}</MenuItem>)}
    </Select>
  )
}

/**
 * The server-side filters of the list: type, status, zone (source or destination), direction, and the cluster on a
 * shared policy. On the row of the sub-tabs, next to Check now (SlotActions), as tall as its buttons; in place, above
 * the table, when the panel has no tab row.
 */
export default function ObservationFilters({ values, zones, onChange, clusters = [] }: Props) {
  const t = useTranslations('microsegPilot.observation')
  const inSlot = useContext(MicrosegActionsSlot) !== null
  return (
    <SlotActions order={1} grow>
      <Box data-testid='observation-filters' sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0, mb: inSlot ? 0 : 1.5 }}>
        <FilterSelect
          name={t('filters.kind')}
          value={values.kind}
          options={[{ value: '', label: t('filters.kindAll') }, ...KINDS.map(kind => ({ value: kind, label: t(`kind.${kind}`) }))]}
          onChange={kind => onChange({ ...values, kind })}
        />
        <FilterSelect
          name={t('filters.status')}
          value={values.status}
          options={[{ value: '', label: t('filters.statusAll') }, ...STATUSES.map(status => ({ value: status, label: t(`status.${status}`) }))]}
          onChange={status => onChange({ ...values, status })}
        />
        <FilterSelect
          name={t('filters.zone')}
          value={values.zone}
          options={[{ value: '', label: t('filters.zoneAll') }, ...zones.map(zone => ({ value: zone.id, label: zone.name }))]}
          onChange={zone => onChange({ ...values, zone })}
        />
        <FilterSelect
          name={t('filters.direction')}
          value={values.direction}
          options={[{ value: '', label: t('filters.directionAll') }, ...DIRECTIONS.map(d => ({ value: d, label: t(d === 'in' ? 'filters.directionIn' : 'filters.directionOut') }))]}
          onChange={direction => onChange({ ...values, direction })}
        />
        {clusters.length > 0 && (
          <FilterSelect
            name={t('filters.cluster')}
            value={values.cluster ?? ''}
            options={[{ value: '', label: t('filters.clusterAll') }, ...clusters]}
            onChange={cluster => onChange({ ...values, cluster })}
          />
        )}
      </Box>
    </SlotActions>
  )
}
