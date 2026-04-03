'use client'

import React, { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'

import { widgetColors } from './themeColors'

function HealthRing({ score, size = 100, strokeWidth = 8, trackColor = 'rgba(255,255,255,0.08)' }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const [mounted, setMounted] = useState(false)
  const offset = mounted ? circumference - (score / 100) * circumference : circumference

  const color = score >= 80 ? '#4caf50' : score >= 50 ? '#ff9800' : '#f44336'

  useEffect(() => { const t = setTimeout(() => setMounted(true), 100);

 

return () => clearTimeout(t) }, [])

  return (
    <Box sx={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={trackColor} strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1)' }}
        />
      </svg>
      <Box sx={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ fontSize: 24, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color }}>
          {score}
        </Typography>
      </Box>
    </Box>
  )
}

function StatBox({ label, value, unit }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography sx={{ fontSize: 16, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.2 }}>
        {value}{unit && <Typography component='span' sx={{ fontSize: 10, opacity: 0.65 }}>{unit}</Typography>}
      </Typography>
      <Typography variant='caption' sx={{ fontSize: 9, opacity: 0.65, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
    </Box>
  )
}

function ClusterHealthWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)

  const summary = data?.summary || {}
  const resources = data?.resources || {}
  const alertsSummary = data?.alertsSummary || {}
  const nodes = data?.nodes || []

  // Compute health score
  const nodesOnline = summary.nodesOnline || 0
  const nodesTotal = summary.nodes || 0
  const cpuPct = resources.cpuPct || summary.cpuPct || 0
  const ramPct = resources.ramPct || summary.ramPct || 0
  const critAlerts = alertsSummary.crit || 0
  const warnAlerts = alertsSummary.warn || 0

  // Score calculation:
  // Start at 100, deduct for issues
  let score = 100


  // Offline nodes: -20 per offline node
  score -= (nodesTotal - nodesOnline) * 20

  // Critical alerts: -15 each
  score -= critAlerts * 15

  // Warning alerts: -5 each
  score -= warnAlerts * 5

  // High CPU: deduct if > 80%
  if (cpuPct > 90) score -= 15
  else if (cpuPct > 80) score -= 8

  // High RAM: deduct if > 80%
  if (ramPct > 90) score -= 15
  else if (ramPct > 80) score -= 8

  score = Math.max(0, Math.min(100, score))

  const vmsRunning = summary.vmsRunning || 0
  const lxcRunning = summary.lxcRunning || 0
  const totalGuests = vmsRunning + lxcRunning

  return (
    <Box
      sx={{
        height: '100%',
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: c.borderLight,
        borderRadius: 2.5,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1.5,
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: c.surfaceActive,
          boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)',
        },
      }}
    >
      {/* Health ring */}
      <HealthRing score={score} trackColor={c.surfaceSubtle} />

      {/* Stats grid */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: 1.5,
        width: '100%',
        maxWidth: 220,
      }}>
        <StatBox label={t('dashboard.widgets.nodes')} value={`${nodesOnline}/${nodesTotal}`} />
        <StatBox label="Guests" value={totalGuests} />
        <StatBox label="CPU" value={cpuPct} unit="%" />
        <StatBox label="RAM" value={ramPct} unit="%" />
      </Box>
    </Box>
  )
}

export default React.memo(ClusterHealthWidget)
