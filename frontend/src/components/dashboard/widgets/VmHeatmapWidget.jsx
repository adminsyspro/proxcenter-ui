'use client'

import React, { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Box,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip as MuiTooltip,
  Typography,
  useTheme,
  alpha,
} from '@mui/material'

// Color stops: 0% → green, 50% → yellow/orange, 80% → red, 100% → deep red
function getHeatColor(pct) {
  const p = Math.max(0, Math.min(100, pct))

  if (p < 25) {
    // Green range
    const t = p / 25
    const r = Math.round(34 + t * (132 - 34))
    const g = Math.round(197 + t * (204 - 197))
    const b = Math.round(94 + t * (22 - 94))
    return `rgb(${r},${g},${b})`
  }
  if (p < 50) {
    // Green-yellow to yellow
    const t = (p - 25) / 25
    const r = Math.round(132 + t * (234 - 132))
    const g = Math.round(204 + t * (179 - 204))
    const b = Math.round(22 + t * (8 - 22))
    return `rgb(${r},${g},${b})`
  }
  if (p < 75) {
    // Yellow-orange to orange-red
    const t = (p - 50) / 25
    const r = Math.round(234 + t * (239 - 234))
    const g = Math.round(179 - t * (111))
    const b = Math.round(8 + t * (60))
    return `rgb(${r},${g},${b})`
  }
  // Red range
  const t = (p - 75) / 25
  const r = Math.round(239 - t * (30))
  const g = Math.round(68 - t * (40))
  const b = Math.round(68 - t * (30))
  return `rgb(${r},${g},${b})`
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

function CellTooltipContent({ vm, metric }) {
  const cpuPct = Math.round((Number(vm.cpu) || 0) * 100)
  const mem = Number(vm.mem) || 0
  const maxmem = Number(vm.maxmem) || 0
  const ramPct = maxmem > 0 ? Math.round((mem / maxmem) * 100) : 0

  return (
    <Box sx={{ minWidth: 160 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <i
          className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
          style={{ fontSize: 12, opacity: 0.7 }}
        />
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {vm.name || `VM ${vm.vmid}`}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontSize: 10, mb: 0.5 }}>
        #{vm.vmid} · {vm.type === 'lxc' ? 'LXC' : 'VM'} · {vm.node}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2 }}>
        <Box>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>CPU</Typography>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: metric === 'cpu' ? 700 : 400, fontFamily: '"JetBrains Mono", monospace' }}>
            {cpuPct}%
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>RAM</Typography>
          <Typography variant="caption" sx={{ display: 'block', fontWeight: metric === 'ram' ? 700 : 400, fontFamily: '"JetBrains Mono", monospace' }}>
            {ramPct}% ({formatBytes(mem)})
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

function VmHeatmapWidget({ data, loading: dashboardLoading }) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const [metric, setMetric] = useState('cpu')

  // Combine VMs + LXC, filter running only, sort by load
  const guests = useMemo(() => {
    const vms = data?.vmList || []
    const lxcs = data?.lxcList || []
    const all = [...vms, ...lxcs].filter(g => g.status === 'running' && !g.template)

    return all.map((g) => {
      const cpuPct = Math.round((Number(g.cpu) || 0) * 100)
      const mem = Number(g.mem) || 0
      const maxmem = Number(g.maxmem) || 0
      const ramPct = maxmem > 0 ? Math.round((mem / maxmem) * 100) : 0

      return { ...g, cpuPct, ramPct }
    }).sort((a, b) => {
      const valA = metric === 'cpu' ? a.cpuPct : a.ramPct
      const valB = metric === 'cpu' ? b.cpuPct : b.ramPct
      return valB - valA
    })
  }, [data?.vmList, data?.lxcList, metric])

  const handleClick = useCallback((vm) => {
    router.push(`/infrastructure/inventory?selected=${vm.connId}&type=${vm.type}&vmid=${vm.vmid}&node=${vm.node}`)
  }, [router])

  // Stats summary
  const stats = useMemo(() => {
    if (guests.length === 0) return null

    const vals = guests.map(g => metric === 'cpu' ? g.cpuPct : g.ramPct)
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
    const max = Math.max(...vals)
    const hot = vals.filter(v => v >= 80).length

    return { avg, max, hot, total: guests.length }
  }, [guests, metric])

  if (!data || dashboardLoading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">Loading...</Typography>
      </Box>
    )
  }

  if (guests.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.secondary">
          {t('common.noData')}
        </Typography>
      </Box>
    )
  }

  // Adaptive cell size based on guest count
  const cellSize = guests.length > 200 ? 10 : guests.length > 100 ? 12 : guests.length > 50 ? 14 : 16
  const gap = 2

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
        {/* Stats */}
        {stats && (
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
              Avg <Box component="span" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: '"JetBrains Mono", monospace' }}>{stats.avg}%</Box>
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
              Max <Box component="span" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: '"JetBrains Mono", monospace' }}>{stats.max}%</Box>
            </Typography>
            {stats.hot > 0 && (
              <Typography variant="caption" sx={{ color: 'error.main', fontSize: 10, fontWeight: 600 }}>
                {stats.hot} hot
              </Typography>
            )}
          </Box>
        )}

        <ToggleButtonGroup
          value={metric}
          exclusive
          onChange={(e, val) => val && setMetric(val)}
          size="small"
        >
          <ToggleButton value="cpu" sx={{ px: 1.5, py: 0.25, fontSize: '0.65rem', minWidth: 40 }}>
            CPU
          </ToggleButton>
          <ToggleButton value="ram" sx={{ px: 1.5, py: 0.25, fontSize: '0.65rem', minWidth: 40 }}>
            RAM
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Heatmap grid */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: `${gap}px`,
            p: 0.5,
          }}
        >
          {guests.map((g) => {
            const val = metric === 'cpu' ? g.cpuPct : g.ramPct
            const bgColor = getHeatColor(val)

            return (
              <MuiTooltip
                key={g.id}
                title={<CellTooltipContent vm={g} metric={metric} />}
                arrow
                placement="top"
                enterDelay={100}
                leaveDelay={0}
              >
                <Box
                  onClick={() => handleClick(g)}
                  sx={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: '2px',
                    bgcolor: bgColor,
                    cursor: 'pointer',
                    transition: 'transform 0.1s, box-shadow 0.1s',
                    '&:hover': {
                      transform: 'scale(1.8)',
                      zIndex: 10,
                      boxShadow: `0 0 6px ${alpha(bgColor, 0.8)}`,
                    },
                  }}
                />
              </MuiTooltip>
            )
          })}
        </Box>
      </Box>

      {/* Color scale legend */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, px: 0.5 }}>
        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>0%</Typography>
        <Box
          sx={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            background: `linear-gradient(to right, ${getHeatColor(0)}, ${getHeatColor(25)}, ${getHeatColor(50)}, ${getHeatColor(75)}, ${getHeatColor(100)})`,
          }}
        />
        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>100%</Typography>
        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', ml: 0.5 }}>
          {guests.length} {metric === 'cpu' ? 'CPU' : 'RAM'}
        </Typography>
      </Box>
    </Box>
  )
}

export default React.memo(VmHeatmapWidget)
