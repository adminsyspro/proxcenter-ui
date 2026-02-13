import React from 'react'

import { Box, Typography } from '@mui/material'

import { formatBytes } from '@/utils/format'

import { getMetricIcon } from '../helpers'

function UsageBar({
  label,
  used,
  capacity,
  mode,
  icon,
  themeColor,
}: {
  label: string
  used: number
  capacity: number
  mode: 'bytes' | 'pct'
  icon?: string
  themeColor: string
}) {
  const iconClass = icon || getMetricIcon(label)

  if (mode === 'pct') {
    const u = Math.max(0, Math.min(100, Number(used || 0)))
    const free = Math.max(0, 100 - u)

    return (
      <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <i className={iconClass} style={{ fontSize: 14, color: themeColor }} />
            <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
              {label}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
            Free: {Math.round(free)}%
          </Typography>
        </Box>

        <Box
          sx={{
            height: 14,
            borderRadius: 0,
            bgcolor: (theme) => theme.palette.mode === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${u}%`,
              bgcolor: u > 90 ? 'error.main' : themeColor,
              borderRadius: 0,
              transition: 'all 300ms ease',
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 500 }}>
            Used: {Math.round(u)}%
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Capacity: 100%
          </Typography>
        </Box>
      </Box>
    )
  }

  const cap = Math.max(0, Number(capacity || 0))
  const u = Math.max(0, Math.min(Number(used || 0), cap || Number(used || 0)))
  const free = Math.max(0, cap - u)
  const pctVal = cap > 0 ? Math.round((u / cap) * 100) : 0

  return (
    <Box sx={{ mb: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className={iconClass} style={{ fontSize: 14, color: themeColor }} />
          <Typography variant="body2" sx={{ fontWeight: 700, color: 'text.primary' }}>
            {label}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.secondary' }}>
          Free: {formatBytes(free)}
        </Typography>
      </Box>

      <Box
        sx={{
          height: 14,
          borderRadius: 0,
          bgcolor: 'rgba(255,255,255,0.12)',
          overflow: 'hidden',
        }}
      >
        <Box
          sx={{
            height: '100%',
            width: `${pctVal}%`,
            bgcolor: pctVal > 90 ? 'error.main' : themeColor,
            borderRadius: 0,
            transition: 'all 300ms ease',
          }}
        />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, mt: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 500 }}>
          Used: {formatBytes(u)}
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          Capacity: {formatBytes(cap)}
        </Typography>
      </Box>
    </Box>
  )
}

export default UsageBar
