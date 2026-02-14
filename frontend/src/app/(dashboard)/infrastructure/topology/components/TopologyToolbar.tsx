'use client'

import {
  Box,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  IconButton,
  Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import { useReactFlow } from '@xyflow/react'

import type { TopologyFilters, InventoryCluster } from '../types'

interface TopologyToolbarProps {
  filters: TopologyFilters
  onChange: (filters: TopologyFilters) => void
  connections: InventoryCluster[]
}

export default function TopologyToolbar({ filters, onChange, connections }: TopologyToolbarProps) {
  const t = useTranslations('topology')
  const { fitView } = useReactFlow()

  const isNetworkView = filters.viewMode === 'network'

  const handleExport = async () => {
    const el = document.querySelector('.react-flow') as HTMLElement

    if (!el) return

    const html2canvas = (await import('html2canvas')).default
    const canvas = await html2canvas(el, { backgroundColor: null, useCORS: true })
    const link = document.createElement('a')

    link.download = 'topology-export.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

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
      {/* View mode toggle */}
      <ToggleButtonGroup
        value={filters.viewMode || 'infra'}
        exclusive
        size='small'
        onChange={(_e, value) => {
          if (value !== null) {
            onChange({ ...filters, viewMode: value, groupByVlan: false, groupByTag: false })
          }
        }}
        sx={{
          '& .MuiToggleButton-root': {
            px: 1.25,
            py: 0.5,
          },
        }}
      >
        <ToggleButton value='infra'>
          <Tooltip title={t('infraView')}>
            <i className='ri-organization-chart' style={{ fontSize: 18 }} />
          </Tooltip>
        </ToggleButton>
        <ToggleButton value='network'>
          <Tooltip title={t('networkView')}>
            <i className='ri-router-line' style={{ fontSize: 18 }} />
          </Tooltip>
        </ToggleButton>
      </ToggleButtonGroup>

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

      {/* VM Threshold slider — hidden in network view */}
      {!isNetworkView && (
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
      )}

      {/* Group by VLAN toggle — hidden in network view */}
      {!isNetworkView && (
        <FormControlLabel
          control={
            <Switch
              size='small'
              checked={filters.groupByVlan || false}
              onChange={(e) => onChange({ ...filters, groupByVlan: e.target.checked, groupByTag: false })}
            />
          }
          label={
            <Typography variant='caption' color='text.secondary' sx={{ whiteSpace: 'nowrap' }}>
              {t('groupByVlan')}
            </Typography>
          }
          sx={{ ml: 0 }}
        />
      )}

      {/* Group by Tag toggle — hidden in network view */}
      {!isNetworkView && (
        <FormControlLabel
          control={
            <Switch
              size='small'
              checked={filters.groupByTag || false}
              onChange={(e) => onChange({ ...filters, groupByTag: e.target.checked, groupByVlan: false })}
            />
          }
          label={
            <Typography variant='caption' color='text.secondary' sx={{ whiteSpace: 'nowrap' }}>
              {t('groupByTag')}
            </Typography>
          }
          sx={{ ml: 0 }}
        />
      )}

      {/* Fit view + Export buttons */}
      <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
        <Tooltip title={t('exportPng')}>
          <IconButton
            size='small'
            onClick={handleExport}
            sx={{
              bgcolor: 'action.hover',
              '&:hover': { bgcolor: 'action.selected' },
            }}
          >
            <i className='ri-download-2-line' style={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
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
