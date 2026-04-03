'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'
import { widgetColors } from './themeColors'

function GuestsSummaryWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const guests = data?.guests || {}

  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: c.borderLight,
        borderRadius: 2.5,
        p: 1.5,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 2,
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: c.surfaceActive,
          boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
        },
      }}
    >
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.65, fontWeight: 600, fontSize: 10 }}>{t('dashboard.widgets.vms').toUpperCase()}</Typography>
        <Box sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
            <i className='ri-play-fill' style={{ fontSize: 14, color: '#4caf50' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>{t('inventory.running')}: <strong style={{ fontFamily: '"JetBrains Mono", monospace' }}>{guests?.vms?.running || 0}</strong></Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
            <i className='ri-stop-fill' style={{ fontSize: 14, color: '#9e9e9e' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>{t('inventory.stopped')}: <strong style={{ fontFamily: '"JetBrains Mono", monospace' }}>{guests?.vms?.stopped || 0}</strong></Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <i className='ri-file-copy-fill' style={{ fontSize: 14, color: '#2196f3' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>{t('inventory.templates')}: <strong style={{ fontFamily: '"JetBrains Mono", monospace' }}>{guests?.vms?.templates || 0}</strong></Typography>
          </Box>
        </Box>
      </Box>
      <Box>
        <Typography variant='caption' sx={{ opacity: 0.65, fontWeight: 600, fontSize: 10 }}>{t('inventory.containers').toUpperCase()}</Typography>
        <Box sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
            <i className='ri-play-fill' style={{ fontSize: 14, color: '#4caf50' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>{t('inventory.running')}: <strong style={{ fontFamily: '"JetBrains Mono", monospace' }}>{guests?.lxc?.running || 0}</strong></Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <i className='ri-stop-fill' style={{ fontSize: 14, color: '#9e9e9e' }} />
            <Typography variant='body2' sx={{ fontSize: 12 }}>{t('inventory.stopped')}: <strong style={{ fontFamily: '"JetBrains Mono", monospace' }}>{guests?.lxc?.stopped || 0}</strong></Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export default React.memo(GuestsSummaryWidget)
