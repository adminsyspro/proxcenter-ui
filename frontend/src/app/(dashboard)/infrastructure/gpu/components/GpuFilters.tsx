'use client'

import { useTranslations } from 'next-intl'
import { Box, InputAdornment, MenuItem, TextField } from '@mui/material'

import { SMALL_SELECT_SX } from '@/components/backup/restoreDrills/DrillTargetPicker'

export type GpuFilterState = { search: string; cluster: string; status: string }

export const NO_FILTER: GpuFilterState = { search: '', cluster: '', status: '' }

/** Case-insensitive match of the search box against any of the given texts. */
export function matchesSearch(search: string, ...texts: Array<string | null | undefined>): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return texts.some(s => !!s && s.toLowerCase().includes(q))
}

export default function GpuFilters({
  value,
  onChange,
  clusters,
  statuses,
}: {
  value: GpuFilterState
  onChange: (next: GpuFilterState) => void
  clusters: string[]
  statuses: Array<{ value: string; label: string }>
}) {
  const t = useTranslations('gpu.page')
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
      <TextField
        size='small'
        value={value.search}
        onChange={e => onChange({ ...value, search: e.target.value })}
        placeholder={t('search')}
        sx={{ flex: '1 1 220px', maxWidth: 320 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position='start'>
                <i className='ri-search-line' style={{ fontSize: 16 }} />
              </InputAdornment>
            ),
          },
          htmlInput: { 'aria-label': t('search') },
        }}
      />
      {clusters.length > 1 && (
        <TextField
          select
          size='small'
          label={t('filterCluster')}
          value={value.cluster}
          onChange={e => onChange({ ...value, cluster: e.target.value })}
          sx={{ minWidth: 180, ...SMALL_SELECT_SX }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value=''>{t('allClusters')}</MenuItem>
          {clusters.map(c => (
            <MenuItem key={c} value={c}>{c}</MenuItem>
          ))}
        </TextField>
      )}
      <TextField
        select
        size='small'
        label={t('filterStatus')}
        value={value.status}
        onChange={e => onChange({ ...value, status: e.target.value })}
        sx={{ minWidth: 160, ...SMALL_SELECT_SX }}
        slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
      >
        <MenuItem value=''>{t('allStatuses')}</MenuItem>
        {statuses.map(s => (
          <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
        ))}
      </TextField>
    </Box>
  )
}
