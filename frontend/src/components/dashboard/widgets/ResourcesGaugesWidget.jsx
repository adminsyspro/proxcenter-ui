'use client'

import React, { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'

import { widgetColors } from './themeColors'

function CircularGauge({ value, color, trackColor, textColor, size = 72, strokeWidth = 6 }) {
  const [animatedValue, setAnimatedValue] = useState(0)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2

  useEffect(() => {
    // Small delay so the animation is visible on mount
    const timer = setTimeout(() => {
      setAnimatedValue(Math.min(value || 0, 100))
    }, 50)

    
return () => clearTimeout(timer)
  }, [value])

  const strokeDashoffset = circumference - (animatedValue / 100) * circumference

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        {/* Value arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1), stroke 0.3s ease',
          }}
        />
      </svg>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        textAlign: 'center',
      }}>
        <Typography sx={{
          fontFamily: '"JetBrains Mono", monospace',
          fontWeight: 700,
          fontSize: '0.85rem',
          lineHeight: 1,
          color: textColor,
        }}>
          {Math.round(animatedValue)}%
        </Typography>
      </Box>
    </Box>
  )
}

function getGaugeColor(pct) {
  const v = pct || 0

  if (v >= 90) return '#f44336'
  if (v >= 75) return '#ff9800'
  
return '#4caf50'
}

function ResourcesGaugesWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const resources = data?.resources || {}

  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  const gauges = [
    {
      label: t('monitoring.cpu'),
      pct: resources.cpuPct || 0,
      detail: `${resources.cpuPct || 0}% (${resources.cpuCores || 0} cores)`,
    },
    {
      label: t('monitoring.memory'),
      pct: resources.ramPct || 0,
      detail: `${resources.memUsedFormatted || '0'} / ${resources.memMaxFormatted || '0'}`,
    },
    {
      label: t('storage.title'),
      pct: resources.storagePct || 0,
      detail: `${resources.storageUsedFormatted || '0'} / ${resources.storageMaxFormatted || '0'}`,
    },
  ]

  const provStats = [
    { label: 'vCPU', value: resources.provCpu || 0, pct: resources.provCpuPct || 0 },
    { label: 'Mem', value: resources.provMemFormatted || '0', pct: resources.provMemPct || 0 },
    { label: 'Disk', value: resources.provDiskFormatted || '0', pct: resources.provStoragePct || 0 },
  ]

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5,
        p: 1.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      {/* Gauges row */}
      <Box sx={{
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        flex: 1,
        gap: 1,
      }}>
        {gauges.map((g) => (
          <Box key={g.label} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, flex: 1 }}>
            <CircularGauge
              value={g.pct}
              color={getGaugeColor(g.pct)}
              trackColor={trackColor}
              textColor={c.textPrimary}
              size={72}
              strokeWidth={6}
            />
            <Typography sx={{
              color: c.textPrimary,
              fontWeight: 600,
              fontSize: '0.8rem',
              lineHeight: 1,
            }}>
              {g.label}
            </Typography>
            <Typography sx={{
              fontFamily: '"JetBrains Mono", monospace',
              color: c.textMuted,
              fontSize: '0.65rem',
              lineHeight: 1,
              textAlign: 'center',
            }}>
              {g.detail}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Provisioning stats row */}
      <Box sx={{
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        borderTop: '1px solid', borderColor: c.borderLight,
        pt: 1,
        gap: 1,
      }}>
        {provStats.map((s) => (
          <Box key={s.label} sx={{ textAlign: 'center', flex: 1 }}>
            <Typography sx={{
              color: c.textFaint,
              fontSize: '0.6rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              lineHeight: 1,
              mb: 0.25,
            }}>
              {t('dashboard.widgets.provisioned')} {s.label}
            </Typography>
            <Typography sx={{
              fontFamily: '"JetBrains Mono", monospace',
              color: c.textSecondary,
              fontSize: '0.7rem',
              fontWeight: 600,
              lineHeight: 1,
            }}>
              {s.value} ({s.pct}%)
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export default React.memo(ResourcesGaugesWidget)
