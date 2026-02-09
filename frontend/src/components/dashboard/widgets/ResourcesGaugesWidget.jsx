'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'

function GaugeChart({ value, label, subtitle, color, size = 150 }) {
  return (
    <Box sx={{ textAlign: 'center', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={[
                { value: Math.min(value || 0, 100) },
                { value: Math.max(100 - (value || 0), 0) }
              ]}
              innerRadius="70%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              dataKey="value"
              stroke="none"
            >
              <Cell fill={color || '#4caf50'} />
              <Cell fill="rgba(255,255,255,0.08)" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <Box sx={{ 
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          textAlign: 'center'
        }}>
          <Typography variant='h5' sx={{ fontWeight: 800, lineHeight: 1 }}>{value || 0}%</Typography>
        </Box>
      </Box>
      <Typography variant='body1' sx={{ fontWeight: 700, mt: 1.5, display: 'block' }}>{label}</Typography>
      {subtitle && <Typography variant='body2' sx={{ opacity: 0.5 }}>{subtitle}</Typography>}
    </Box>
  )
}

function ResourcesGaugesWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const primaryColor = theme.palette.primary.main
  const resources = data?.resources || {}

  return (
    <Box sx={{
      height: '100%',
      display: 'flex',
      justifyContent: 'space-around',
      alignItems: 'center',
      p: 2,
      gap: 2
    }}>
      <GaugeChart
        value={resources.cpuPct}
        label={t('monitoring.cpu')}
        subtitle={`${resources.cpuCores || 0} cores`}
        color={primaryColor}
      />
      <GaugeChart
        value={resources.ramPct}
        label={t('monitoring.memory')}
        subtitle={resources.memUsedFormatted ? `${resources.memUsedFormatted}` : '0'}
        color={primaryColor}
      />
      <GaugeChart
        value={resources.storagePct}
        label={t('storage.title')}
        subtitle={resources.storageUsedFormatted ? `${resources.storageUsedFormatted}` : '0'}
        color={primaryColor}
      />
    </Box>
  )
}

export default React.memo(ResourcesGaugesWidget)
