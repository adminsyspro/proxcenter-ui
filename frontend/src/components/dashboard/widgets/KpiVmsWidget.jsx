'use client'

import React, { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'
import { widgetColors } from './themeColors'

function CircularGauge({ value, max, size = 56, strokeWidth = 4.5, color, trackColor = 'rgba(255,255,255,0.08)' }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const pct = max > 0 ? value / max : 0
  const [mounted, setMounted] = useState(false)
  const offset = mounted ? circumference - pct * circumference : circumference

  useEffect(() => { const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t) }, [])

  return (
    <Box sx={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 14, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color, lineHeight: 1 }}>
          {value}
        </Typography>
        <Typography sx={{ fontSize: 7, opacity: 0.5, fontWeight: 700 }}>/{max}</Typography>
      </Box>
    </Box>
  )
}

function KpiVmsWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const primaryColor = theme.palette.primary.main
  const summary = data?.summary || {}

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5, p: 1.5, height: '100%',
        display: 'flex', alignItems: 'center', gap: 1.5,
      }}
    >
      <CircularGauge value={summary.vmsRunning || 0} max={summary.vmsTotal || 0} color={primaryColor} trackColor={c.surfaceSubtle} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 10, opacity: 0.65, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {t('dashboard.widgets.vms')}
        </Typography>
        <Typography sx={{ fontSize: 18, fontWeight: 800, color: primaryColor, lineHeight: 1.2, fontFamily: '"JetBrains Mono", monospace' }}>
          {summary.vmsRunning || 0} / {summary.vmsTotal || 0}
        </Typography>
        <Typography sx={{ fontSize: 10, opacity: 0.6 }}>
          CPU {summary.cpuPct || 0}% &bull; RAM {summary.ramPct || 0}%
        </Typography>
      </Box>
    </Box>
  )
}

export default React.memo(KpiVmsWidget)
