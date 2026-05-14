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
import { useReactFlow, getNodesBounds, getViewportForBounds } from '@xyflow/react'

import type { TopologyFilters, InventoryCluster } from '../types'

interface TopologyToolbarProps {
  filters: TopologyFilters
  onChange: (filters: TopologyFilters) => void
  connections: InventoryCluster[]
}

export default function TopologyToolbar({ filters, onChange, connections }: TopologyToolbarProps) {
  const t = useTranslations('topology')
  const { fitView, getNodes } = useReactFlow()

  const isNetworkView = filters.viewMode === 'network'
  const isGeoView = filters.viewMode === 'geo'

  // Patch CSSStyleDeclaration.font to prevent html-to-image crash on SVG elements
  const patchFontProperty = () => {
    const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'font')

    if (!desc || !desc.get) return null
    const originalGet = desc.get

    Object.defineProperty(CSSStyleDeclaration.prototype, 'font', {
      get() {
        try {
          const val = originalGet.call(this)


return val || ''
        } catch {
          return ''
        }
      },
      set: desc.set,
      enumerable: desc.enumerable,
      configurable: true,
    })

return originalGet
  }

  const restoreFontProperty = (originalGet: (() => string) | null) => {
    if (!originalGet) return
    const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, 'font')

    Object.defineProperty(CSSStyleDeclaration.prototype, 'font', {
      get: originalGet,
      set: desc?.set,
      enumerable: desc?.enumerable,
      configurable: true,
    })
  }

  const getExportParams = () => {
    const nodes = getNodes()

    if (nodes.length === 0) return null
    const bounds = getNodesBounds(nodes)
    const padding = 80
    const imageWidth = bounds.width + padding * 2
    const imageHeight = bounds.height + padding * 2
    const vp = getViewportForBounds(bounds, imageWidth, imageHeight, 0.5, 2, padding)
    const flowEl = document.querySelector('.react-flow__viewport') as HTMLElement

    if (!flowEl) return null

return { flowEl, imageWidth, imageHeight, vp }
  }

  const captureOpts = (flowEl: HTMLElement, w: number, h: number, vp: { x: number; y: number; zoom: number }) => ({
    backgroundColor: '#1e1e2d',
    width: w,
    height: h,
    pixelRatio: 2,
    style: {
      width: `${w}px`,
      height: `${h}px`,
      transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
    },
    filter: (node: any) => {
      if (node instanceof HTMLElement) {
        const cls = node.className || ''

        if (typeof cls === 'string' && (cls.includes('react-flow__minimap') || cls.includes('react-flow__controls') || cls.includes('react-flow__panel'))) {
          return false
        }
      }


return true
    },
  })

  const handleExport = async () => {
    const params = getExportParams()

    if (!params) return

    const originalFont = patchFontProperty()

    try {
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(params.flowEl, captureOpts(params.flowEl, params.imageWidth, params.imageHeight, params.vp))
      const link = document.createElement('a')

      link.download = 'topology-export.png'
      link.href = dataUrl
      link.click()
    } catch (e) {
      console.error('[PNG export] Error:', e)
    } finally {
      restoreFontProperty(originalFont)
    }
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
      {/* Connection filter — hidden in geo view */}
      {!isGeoView && (
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
      )}

      {/* VM Status filter — hidden in geo view */}
      {!isGeoView && (
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
      )}

      {/* VM Threshold slider — hidden in network/geo view */}
      {!isNetworkView && !isGeoView && (
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

      {/* Group by VLAN toggle — hidden in network/geo view */}
      {!isNetworkView && !isGeoView && (
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

      {/* Group by Tag toggle — hidden in network/geo view */}
      {!isNetworkView && !isGeoView && (
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

      {/* Right side: action buttons + view mode toggle */}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
        {/* Fit view + Export buttons — hidden in geo view */}
        {!isGeoView && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
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
        )}

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
          <ToggleButton value='geo'>
            <Tooltip title={t('geoView')}>
              <i className='ri-map-pin-line' style={{ fontSize: 18 }} />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
    </Box>
  )
}
