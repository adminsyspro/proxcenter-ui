'use client'

import React from 'react'

import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'

import { widgetColors } from './themeColors'

function formatUptime(seconds) {
  if (!seconds || seconds <= 0) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`

  return `${mins}m`
}

function getUptimeColor(seconds) {
  if (!seconds) return '#9e9e9e'
  const days = seconds / 86400

  if (days > 30) return '#4caf50'
  if (days > 7) return '#8bc34a'
  if (days > 1) return '#ff9800'

  return '#f44336'
}

function UptimeNodesWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const nodes = data?.nodes || []

  if (nodes.length === 0) {
    return (
      <Box
        sx={{
          height: '100%',
          bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
          border: '1px solid',
          borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          borderRadius: 2.5,
          p: 1.5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant='caption' sx={{ opacity: 0.65 }}>{t('common.noData')}</Typography>
      </Box>
    )
  }

  const sortedNodes = [...nodes].sort((a, b) => (b.uptime || 0) - (a.uptime || 0))

  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5,
        p: 1.5,
        overflow: 'auto',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)',
          boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
        },
      }}
    >
      {sortedNodes.map((node, idx) => {
        const color = node.status === 'online' ? getUptimeColor(node.uptime) : '#f44336'

        return (
          <Box
            key={idx}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              py: 0.75,
              borderBottom: idx < sortedNodes.length - 1 ? '1px solid' : 'none',
              borderColor: c.surfaceSubtle,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{
                width: 8, height: 8, borderRadius: '50%',
                bgcolor: node.status === 'online' ? '#4caf50' : '#f44336'
              }} />
              <Typography variant='caption' sx={{ fontWeight: 600, fontSize: 11 }}>
                {node.name}
              </Typography>
              <Typography variant='caption' sx={{ opacity: 0.65, fontSize: 10 }}>
                {node.connection}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-time-line' style={{ fontSize: 12, color, opacity: 0.8 }} />
              <Typography variant='caption' sx={{ fontWeight: 700, color, fontSize: 11, fontFamily: '"JetBrains Mono", monospace' }}>
                {node.status === 'online' ? formatUptime(node.uptime) : t('common.offline')}
              </Typography>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

export default React.memo(UptimeNodesWidget)
