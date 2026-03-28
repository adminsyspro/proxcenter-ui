'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

function GaugeChart({ value, provisionedValue, label, subtitle, provisionedSubtitle, color, provisionedColor, size = 150 }) {
  const used = Math.min(value || 0, 100)
  const provisioned = Math.min(provisionedValue || 0, 999)

  // Outer ring: provisioned (capped at 100 visually, but show real % in text)
  const provVisual = Math.min(provisioned, 100)
  const outerData = [
    { value: provVisual },
    { value: Math.max(100 - provVisual, 0) },
  ]

  // Inner ring: actual usage
  const innerData = [
    { value: used },
    { value: Math.max(100 - used, 0) },
  ]

  return (
    <Box sx={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <PieChart>
            {/* Outer ring — provisioned */}
            <Pie
              data={outerData}
              innerRadius="75%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              <Cell fill={provisionedColor || 'rgba(255,255,255,0.15)'} />
              <Cell fill="rgba(255,255,255,0.05)" />
            </Pie>
            {/* Inner ring — actual usage */}
            <Pie
              data={innerData}
              innerRadius="52%"
              outerRadius="72%"
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              stroke="none"
              isAnimationActive={false}
            >
              <Cell fill={color || '#4caf50'} />
              <Cell fill="rgba(255,255,255,0.05)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <Box sx={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          textAlign: 'center',
        }}>
          <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1 }}>{used}%</Typography>
        </Box>
      </Box>
      <Typography variant="body1" sx={{ fontWeight: 700, mt: 1.5, display: 'block' }}>{label}</Typography>
      {subtitle && (
        <Typography variant="body2" sx={{ opacity: 0.6, display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}>
          <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, display: 'inline-block', flexShrink: 0 }} />
          {subtitle}
        </Typography>
      )}
      {provisionedSubtitle && (
        <Typography variant="body2" sx={{ opacity: 0.6, display: 'flex', alignItems: 'center', gap: 0.5, justifyContent: 'center' }}>
          <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: provisionedColor, display: 'inline-block', flexShrink: 0 }} />
          {provisionedSubtitle}
        </Typography>
      )}
    </Box>
  )
}

function ResourcesGaugesWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const primaryColor = theme.palette.primary.main
  const provColor = theme.palette.warning.main
  const resources = data?.resources || {}

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      p: 2,
      gap: 2,
    }}>
      <GaugeChart
        value={resources.cpuPct}
        provisionedValue={resources.provCpuPct}
        label={t('monitoring.cpu')}
        subtitle={`${t('dashboard.widgets.used')}: ${resources.cpuPct || 0}% (${resources.cpuCores || 0} cores)`}
        provisionedSubtitle={`${t('dashboard.widgets.provisioned')}: ${resources.provCpuPct || 0}% (${resources.provCpu || 0} vCPU)`}
        color={primaryColor}
        provisionedColor={provColor}
      />
      <GaugeChart
        value={resources.ramPct}
        provisionedValue={resources.provMemPct}
        label={t('monitoring.memory')}
        subtitle={`${t('dashboard.widgets.used')}: ${resources.memUsedFormatted || '0'} / ${resources.memMaxFormatted || '0'}`}
        provisionedSubtitle={`${t('dashboard.widgets.provisioned')}: ${resources.provMemFormatted || '0'} (${resources.provMemPct || 0}%)`}
        color={primaryColor}
        provisionedColor={provColor}
      />
      <GaugeChart
        value={resources.storagePct}
        provisionedValue={resources.provStoragePct}
        label={t('storage.title')}
        subtitle={`${t('dashboard.widgets.used')}: ${resources.storageUsedFormatted || '0'} / ${resources.storageMaxFormatted || '0'}`}
        provisionedSubtitle={`${t('dashboard.widgets.provisioned')}: ${resources.provDiskFormatted || '0'} (${resources.provStoragePct || 0}%)`}
        color={primaryColor}
        provisionedColor={provColor}
      />
    </Box>
  )
}

export default React.memo(ResourcesGaugesWidget)
