'use client'

import React, { useState } from 'react'

import { useRouter } from 'next/navigation'

import { useTranslations } from 'next-intl'
import { Alert, Box, Typography, useTheme } from '@mui/material'

import { widgetColors } from './themeColors'

function getBarColor(value) {
  if (value >= 80) return '#ef4444'
  if (value >= 50) return '#f59e0b'
  
return '#22c55e'
}

function TopConsumersWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const [mode, setMode] = useState(() => {
    if (typeof window !== 'undefined') return localStorage.getItem('dashboard-top-consumers-mode') || 'cpu'

    return 'cpu'
  })

  const handleModeChange = (m) => {
    setMode(m)
    localStorage.setItem('dashboard-top-consumers-mode', m)
  }

  const topCpu = data?.topCpu || []
  const topRam = data?.topRam || []
  const items = mode === 'cpu' ? topCpu : topRam

  if (topCpu.length === 0 && topRam.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='info' sx={{ width: '100%' }}>{t('common.noData')}</Alert>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: c.borderLight,
        borderRadius: 2.5,
        p: 1.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: c.borderHover,
          boxShadow: isDark ? '0 4px 24px rgba(0,0,0,0.2)' : '0 4px 24px rgba(0,0,0,0.06)'
        }
      }}
    >
      {/* Toggle buttons */}
      <Box sx={{ display: 'flex', gap: 0.5, mb: 1.5 }}>
        {['cpu', 'ram'].map(m => (
          <Box
            key={m}
            onClick={() => handleModeChange(m)}
            sx={{
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              userSelect: 'none',
              transition: 'all 0.15s',
              color: mode === m ? c.textPrimary : c.textMuted,
              bgcolor: mode === m ? c.surfaceActive : 'transparent',
              '&:hover': {
                color: c.textPrimary,
                bgcolor: mode === m ? c.surfaceHighlight : c.borderLight
              }
            }}
          >
            {m === 'cpu' ? t('monitoring.cpu') : t('monitoring.memory')}
          </Box>
        ))}
      </Box>

      {/* Consumer list */}
      <Box sx={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {items.slice(0, 10).map((vm, idx) => {
          const val = Math.min(vm.value, 100)
          const color = getBarColor(val)

          return (
            <Box
              key={idx}
              onClick={() =>
                vm.connId &&
                router.push(
                  `/infrastructure/inventory?vmid=${vm.vmid}&connId=${vm.connId}&node=${vm.node}&type=${vm.type || 'qemu'}`
                )
              }
              sx={{
                cursor: vm.connId ? 'pointer' : 'default',
                borderRadius: 1,
                px: 0.75,
                py: 0.5,
                transition: 'background 0.15s',
                '&:hover': vm.connId ? { bgcolor: c.surfaceHover } : {}
              }}
            >
              {/* Name + value */}
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: c.textPrimary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '70%'
                  }}
                >
                  {vm.name}
                </Typography>
                <Typography
                  sx={{
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: '"JetBrains Mono", monospace',
                    color
                  }}
                >
                  {val}%
                </Typography>
              </Box>

              {/* Progress bar */}
              <Box
                sx={{
                  width: '100%',
                  height: 4,
                  borderRadius: 2,
                  bgcolor: c.surfaceSubtle,
                  overflow: 'hidden'
                }}
              >
                <Box
                  sx={{
                    width: `${val}%`,
                    height: '100%',
                    borderRadius: 2,
                    bgcolor: color,
                    transition: 'width 0.4s ease'
                  }}
                />
              </Box>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

export default React.memo(TopConsumersWidget)
