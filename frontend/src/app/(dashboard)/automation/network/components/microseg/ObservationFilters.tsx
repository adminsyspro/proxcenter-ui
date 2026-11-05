'use client'

import { useContext, type ReactNode } from 'react'
import { Box, MenuItem, Select } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { FlowDirection, MicrosegZone, SuggestionKind, SuggestionStatus } from '@/lib/microseg/types'

import { MicrosegActionsSlot, SlotActions } from './microsegAccess'

export type ObservationFilterValues = { kind: '' | SuggestionKind; status: '' | SuggestionStatus; zone: string; direction: '' | FlowDirection }

type Props = {
  values: ObservationFilterValues
  zones: MicrosegZone[]
  onChange: (values: ObservationFilterValues) => void
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
  minWidth: 150,
  '& .MuiSelect-select': { py: 0, pl: 1.25, display: 'flex', alignItems: 'center', minHeight: 0 },
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
        <>
          <Box component='span' sx={{ color: 'text.secondary', mr: 0.75 }}>{name}</Box>
          {labelOf(v as T)}
        </>
      )}
      inputProps={{ 'aria-label': name }}
      sx={COMPACT_SELECT_SX}
    >
      {options.map(o => <MenuItem key={o.value || 'all'} value={o.value} sx={{ fontSize: '0.8125rem' }}>{o.label}</MenuItem>)}
    </Select>
  )
}

/**
 * The four server-side filters of the list: type, status, zone (source or destination) and direction. On the row of the
 * sub-tabs, next to Check now (SlotActions), as tall as its buttons; in place, above the table, when the panel has no
 * tab row.
 */
export default function ObservationFilters({ values, zones, onChange }: Props) {
  const t = useTranslations('microsegPilot.observation')
  const inSlot = useContext(MicrosegActionsSlot) !== null
  return (
    <SlotActions order={1}>
      <Box data-testid='observation-filters' sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: inSlot ? 0 : 1.5 }}>
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
      </Box>
    </SlotActions>
  )
}
