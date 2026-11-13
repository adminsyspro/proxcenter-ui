'use client'

import React from 'react'

import { useTranslations } from 'next-intl'
import { Box, CircularProgress, Typography, useTheme } from '@mui/material'

import { CapacityBar, deviceLabel } from '@/components/gpu/GpuInventoryPanel'
import { useGpuReport } from '@/components/gpu/useGpuReport'

const GUEST_STATUS_COLORS: Record<string, string> = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }

/**
 * Multi-cluster GPU capacity (#672): allocated against free GPUs in total and
 * per cluster. For a vDC tenant, the GPUs held by its own VMs instead.
 */
export default function GpuCapacityWidget() {
  const t = useTranslations()
  const theme = useTheme()
  const dotBorder = theme.palette.background.paper
  const { report, loading, error } = useGpuReport()

  if (!report) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        {loading ? <CircularProgress size={22} /> : <Typography variant='caption' color='error'>{t('gpu.loadError')}{error ? `: ${error}` : ''}</Typography>}
      </Box>
    )
  }

  if (report.scope === 'tenant') {
    return (
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }} data-testid='gpu-widget' data-scope='tenant'>
        <Typography variant='body2' sx={{ fontWeight: 700 }}>{t('gpu.widgetTenantCount', { count: report.allocations.length })}</Typography>
        {report.allocations.map((a, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <i className='ri-computer-line' style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
              <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: GUEST_STATUS_COLORS[a.vmStatus || ''] || '#616161', border: `1px solid ${dotBorder}` }} />
            </Box>
            <Typography variant='body2' sx={{ fontWeight: 600, flexShrink: 0 }}>{a.vmName}</Typography>
            <Typography variant='caption' color='text.secondary' sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {deviceLabel(a)}
            </Typography>
          </Box>
        ))}
      </Box>
    )
  }

  const cap = report.capacity ?? { total: 0, allocated: 0, free: 0, inUse: 0, consoles: 0 }
  // A cluster without GPU would only add an empty 0 / 0 bar: list the clusters
  // that hold GPUs, plus the unreadable ones so a gap in the totals is explained.
  const listed = report.connections.filter(c => c.error || !c.capacity || c.capacity.total > 0)
  const figures = [
    { key: 'total', label: t('gpu.total'), value: cap.total },
    { key: 'allocated', label: t('gpu.allocated'), value: cap.allocated, color: '#ff9800' },
    { key: 'free', label: t('gpu.free'), value: cap.free, color: '#4caf50' },
    { key: 'inUse', label: t('gpu.inUse'), value: cap.inUse, color: '#2196f3' },
  ]

  return (
    <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25 }} data-testid='gpu-widget' data-scope='infrastructure'>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1 }}>
        {figures.map(f => (
          <Box key={f.key} data-testid={`gpu-widget-${f.key}`} sx={{ textAlign: 'center' }}>
            <Typography variant='h6' sx={{ fontWeight: 700, color: f.color, lineHeight: 1.2 }}>{f.value}</Typography>
            <Typography variant='caption' color='text.secondary'>{f.label}</Typography>
          </Box>
        ))}
      </Box>
      {listed.length === 0 && (
        <Typography variant='caption' color='text.secondary'>{t('gpu.emptyInfra')}</Typography>
      )}
      {listed.map(c => (
        <Box key={c.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
            <i className='ri-server-line' style={{ fontSize: '0.9286rem', flexShrink: 0 }} />
            <Typography variant='body2' sx={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</Typography>
            <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>
              {c.error || !c.capacity ? t('gpu.connectionError') : `${c.capacity.allocated} / ${c.capacity.total}`}
            </Typography>
          </Box>
          {c.capacity && !c.error && <CapacityBar capacity={c.capacity} />}
        </Box>
      ))}
      {cap.consoles > 0 && (
        <Typography variant='caption' color='text.secondary'>{t('gpu.widgetConsoles', { count: cap.consoles })}</Typography>
      )}
    </Box>
  )
}
