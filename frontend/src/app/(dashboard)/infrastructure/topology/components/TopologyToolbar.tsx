'use client'

import {
  Box,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  IconButton,
  Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import { useReactFlow } from '@xyflow/react'

import type { TopologyFilters, InventoryConnection } from '../types'

interface TopologyToolbarProps {
  filters: TopologyFilters
  onChange: (filters: TopologyFilters) => void
  connections: InventoryConnection[]
}

export default function TopologyToolbar({ filters, onChange, connections }: TopologyToolbarProps) {
  const t = useTranslations('topology')
  const { fitView } = useReactFlow()

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        flexWrap: 'wrap',
        px: 1,
      }}
    >
      {/* Connection filter */}
      <FormControl size='small' sx={{ minWidth: 180 }}>
        <InputLabel>{t('filterByConnection')}</InputLabel>
        <Select
          value={filters.connectionId || ''}
          label={t('filterByConnection')}
          onChange={(e) =>
            onChange({ ...filters, connectionId: e.target.value || undefined })
          }
        >
          <MenuItem value=''>{t('allConnections')}</MenuItem>
          {connections.map((conn) => (
            <MenuItem key={conn.id} value={conn.id}>
              {conn.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* VM Status filter */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant='caption' color='text.secondary' sx={{ whiteSpace: 'nowrap' }}>
          {t('vmStatus')}:
        </Typography>
        <ToggleButtonGroup
          value={filters.vmStatus || 'all'}
          exclusive
          size='small'
          onChange={(_e, value) => {
            if (value !== null) {
              onChange({ ...filters, vmStatus: value })
            }
          }}
          sx={{
            '& .MuiToggleButton-root': {
              px: 1.5,
              py: 0.25,
              fontSize: '0.75rem',
              textTransform: 'none',
            },
          }}
        >
          <ToggleButton value='all'>{t('all')}</ToggleButton>
          <ToggleButton value='running'>{t('running')}</ToggleButton>
          <ToggleButton value='stopped'>{t('stopped')}</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* VM Threshold slider */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 200 }}>
        <Typography variant='caption' color='text.secondary' sx={{ whiteSpace: 'nowrap' }}>
          {t('vmThreshold')}:
        </Typography>
        <Slider
          value={filters.vmThreshold}
          min={1}
          max={20}
          step={1}
          size='small'
          valueLabelDisplay='auto'
          onChange={(_e, value) => onChange({ ...filters, vmThreshold: value as number })}
          sx={{ flex: 1 }}
        />
        <Typography variant='caption' color='text.secondary' sx={{ minWidth: 20, textAlign: 'center' }}>
          {filters.vmThreshold}
        </Typography>
      </Box>

      {/* Fit view button */}
      <Box sx={{ ml: 'auto' }}>
        <Tooltip title={t('fitView')}>
          <IconButton
            size='small'
            onClick={() => fitView({ padding: 0.2, duration: 300 })}
            sx={{
              bgcolor: 'action.hover',
              '&:hover': { bgcolor: 'action.selected' },
            }}
          >
            <i className='ri-fullscreen-line' style={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  )
}
