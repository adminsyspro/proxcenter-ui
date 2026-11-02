'use client'

import { Box, FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import { useTranslations } from 'next-intl'

import { SMALL_SELECT_SX } from '@/components/settings/destinations/DestinationDialogParts'
import type { MicrosegZone, SuggestionKind, SuggestionStatus } from '@/lib/microseg/types'

export type ObservationFilterValues = { kind: '' | SuggestionKind; status: '' | SuggestionStatus; zone: string }

type Props = {
  values: ObservationFilterValues
  zones: MicrosegZone[]
  onChange: (values: ObservationFilterValues) => void
}

const KINDS: SuggestionKind[] = ['would_block', 'blocked']
const STATUSES: SuggestionStatus[] = ['pending', 'accepted', 'dismissed']

/** The three server-side filters of the list: type, status and zone (source or destination). */
export default function ObservationFilters({ values, zones, onChange }: Props) {
  const t = useTranslations('microsegPilot.observation')
  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1.5 }}>
      <FormControl size='small' sx={{ minWidth: 180 }}>
        <InputLabel shrink>{t('filters.kind')}</InputLabel>
        <Select
          label={t('filters.kind')}
          notched
          displayEmpty
          value={values.kind}
          onChange={e => onChange({ ...values, kind: e.target.value as ObservationFilterValues['kind'] })}
          inputProps={{ 'aria-label': t('filters.kind') }}
          sx={SMALL_SELECT_SX}
        >
          <MenuItem value=''>{t('filters.kindAll')}</MenuItem>
          {KINDS.map(kind => <MenuItem key={kind} value={kind}>{t(`kind.${kind}`)}</MenuItem>)}
        </Select>
      </FormControl>
      <FormControl size='small' sx={{ minWidth: 180 }}>
        <InputLabel shrink>{t('filters.status')}</InputLabel>
        <Select
          label={t('filters.status')}
          notched
          displayEmpty
          value={values.status}
          onChange={e => onChange({ ...values, status: e.target.value as ObservationFilterValues['status'] })}
          inputProps={{ 'aria-label': t('filters.status') }}
          sx={SMALL_SELECT_SX}
        >
          <MenuItem value=''>{t('filters.statusAll')}</MenuItem>
          {STATUSES.map(status => <MenuItem key={status} value={status}>{t(`status.${status}`)}</MenuItem>)}
        </Select>
      </FormControl>
      <FormControl size='small' sx={{ minWidth: 180 }}>
        <InputLabel shrink>{t('filters.zone')}</InputLabel>
        <Select
          label={t('filters.zone')}
          notched
          displayEmpty
          value={values.zone}
          onChange={e => onChange({ ...values, zone: e.target.value })}
          inputProps={{ 'aria-label': t('filters.zone') }}
          sx={SMALL_SELECT_SX}
        >
          <MenuItem value=''>{t('filters.zoneAll')}</MenuItem>
          {zones.map(zone => <MenuItem key={zone.id} value={zone.id}>{zone.name}</MenuItem>)}
        </Select>
      </FormControl>
    </Box>
  )
}
