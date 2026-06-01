'use client'

import React from 'react'

import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'

import { widgetColors } from './themeColors'
import CircularGauge from './CircularGauge'

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

  // In VM-aggregate mode (non-infra scopes), gauges are computed from the
  // user's visible guests instead of nodes. The "provisioned vs cluster
  // capacity" bars don't apply — they'd render as 0% next to non-zero
  // allocations, which is misleading.
  const isVmScope = resources.scope === 'vm'

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
        borderRadius: 'var(--proxcenter-card-radius)',
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
              size='5.1em'
            >
              <Box component='span' sx={{ fontWeight: 700, fontSize: '0.9em', color: c.textPrimary }}>
                {Math.round(g.pct)}%
              </Box>
            </CircularGauge>
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

      {/* Provisioning stats row — only meaningful when comparing against
          cluster capacity (infra scopes). Hidden in VM-aggregate mode. */}
      {!isVmScope && <Box sx={{
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
      </Box>}
    </Box>
  )
}

export default React.memo(ResourcesGaugesWidget)
