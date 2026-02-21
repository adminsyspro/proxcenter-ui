'use client'

import {
  Box,
  FormControlLabel,
  Switch,
  Tooltip,
  IconButton,
  Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import { useReactFlow } from '@xyflow/react'

import type { SecurityMapFilters } from './types'

interface SecurityMapToolbarProps {
  filters: SecurityMapFilters
  onChange: (filters: SecurityMapFilters) => void
}

export default function SecurityMapToolbar({ filters, onChange }: SecurityMapToolbarProps) {
  const t = useTranslations('networkPage')
  const { fitView } = useReactFlow()

  const handleExport = async () => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement

    if (!viewport) return

    const { toPng } = await import('html-to-image')
    const dataUrl = await toPng(viewport, {
      backgroundColor: '#1e1e2d',
      filter: (node) => {
        if (node instanceof HTMLElement) {
          const cls = node.className || ''

          if (typeof cls === 'string' && (cls.includes('react-flow__minimap') || cls.includes('react-flow__controls'))) {
            return false
          }
        }

        return true
      },
    })

    const link = document.createElement('a')

    link.download = 'security-map-export.png'
    link.href = dataUrl
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
      <FormControlLabel
        control={
          <Switch
            size='small'
            checked={filters.hideInfraNetworks}
            onChange={(e) => onChange({ ...filters, hideInfraNetworks: e.target.checked })}
          />
        }
        label={
          <Typography variant='caption' color='text.secondary' sx={{ whiteSpace: 'nowrap' }}>
            {t('securityMap.hideInfraNetworks')}
          </Typography>
        }
        sx={{ ml: 0 }}
      />

      <FormControlLabel
        control={
          <Switch
            size='small'
            checked={filters.hideStoppedVms}
            onChange={(e) => onChange({ ...filters, hideStoppedVms: e.target.checked })}
          />
        }
        label={
          <Typography variant='caption' color='text.secondary' sx={{ whiteSpace: 'nowrap' }}>
            {t('securityMap.hideStoppedVms')}
          </Typography>
        }
        sx={{ ml: 0 }}
      />

      <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
        <Tooltip title={t('securityMap.exportPng')}>
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
        <Tooltip title={t('securityMap.fitView')}>
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
