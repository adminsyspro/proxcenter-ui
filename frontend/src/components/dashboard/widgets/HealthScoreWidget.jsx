'use client'

import React, { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

function HealthScoreWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()

  const { score, cpuOk, ramOk, storageOk, nodesOk } = useMemo(() => {
    const resources = data?.resources || {}
    const summary = data?.summary || {}
    const alertsSummary = data?.alertsSummary || {}

    let s = 0

    // CPU score (25pts max)
    const cpu = resources.cpuPct || 0
    if (cpu < 80) s += 25
    else if (cpu < 90) s += 15
    else s += 5

    // RAM score (25pts max)
    const ram = resources.ramPct || 0
    if (ram < 80) s += 25
    else if (ram < 90) s += 15
    else s += 5

    // Storage score (25pts max)
    const storage = resources.storagePct || 0
    if (storage < 80) s += 25
    else if (storage < 90) s += 15
    else s += 5

    // Nodes score (25pts max)
    const totalNodes = summary.nodes || 0
    const onlineNodes = summary.nodesOnline ?? (totalNodes - (summary.nodesOffline || 0))
    const nodeScore = totalNodes > 0 ? Math.round((onlineNodes / totalNodes) * 25) : 25
    s += nodeScore

    // Alerts bonus/malus
    const crit = alertsSummary.crit || 0
    if (crit > 0) s = Math.max(0, s - Math.min(15, crit * 5))

    return {
      score: Math.min(100, Math.max(0, s)),
      cpuOk: cpu < 80,
      ramOk: ram < 80,
      storageOk: storage < 80,
      nodesOk: totalNodes > 0 ? onlineNodes === totalNodes : true,
    }
  }, [data])

  const scoreColor = score > 75
    ? theme.palette.success.main
    : score >= 50
      ? theme.palette.warning.main
      : theme.palette.error.main

  const scoreLabel = score > 75
    ? t('dashboard.healthy')
    : score >= 50
      ? t('dashboard.degraded')
      : t('dashboard.critical')

  const donutData = [
    { value: score },
    { value: 100 - score }
  ]

  const indicators = [
    { label: 'CPU', ok: cpuOk },
    { label: 'RAM', ok: ramOk },
    { label: t('dashboard.widgets.storage'), ok: storageOk },
    { label: t('dashboard.widgets.nodes'), ok: nodesOk },
  ]

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 1.5 }}>
      {/* Donut chart */}
      <Box sx={{ position: 'relative', width: 120, height: 120 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={donutData}
              innerRadius="70%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              stroke="none"
            >
              <Cell fill={scoreColor} />
              <Cell fill={theme.palette.action.hover} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          textAlign: 'center'
        }}>
          <Typography variant='h5' sx={{ fontWeight: 800, lineHeight: 1, color: scoreColor }}>
            {score}
          </Typography>
          <Typography variant='caption' sx={{ opacity: 0.5, fontSize: 9 }}>/ 100</Typography>
        </Box>
      </Box>

      {/* Score label */}
      <Typography variant='caption' sx={{ fontWeight: 700, color: scoreColor, mt: 1 }}>
        {scoreLabel}
      </Typography>

      {/* Mini indicators */}
      <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5 }}>
        {indicators.map((ind) => (
          <Box key={ind.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%',
              bgcolor: ind.ok ? theme.palette.success.main : theme.palette.error.main
            }} />
            <Typography variant='caption' sx={{ fontSize: 10, opacity: 0.7 }}>
              {ind.label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

export default React.memo(HealthScoreWidget)
