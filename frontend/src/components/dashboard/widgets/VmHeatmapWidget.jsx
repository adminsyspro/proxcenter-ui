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

// Color gradient: green (low) → yellow (mid) → red (high)
function getHeatColor(pct) {
  const p = Math.max(0, Math.min(100, pct))

  if (p < 30) {
    // Green
    const t = p / 30
    const r = Math.round(34 + t * (100))
    const g = Math.round(197 + t * (7))
    const b = Math.round(94 - t * (72))
    return `rgb(${r},${g},${b})`
  }
  if (p < 60) {
    // Yellow-orange
    const t = (p - 30) / 30
    const r = Math.round(134 + t * (100))
    const g = Math.round(204 - t * (24))
    const b = Math.round(22 - t * (14))
    return `rgb(${r},${g},${b})`
  }
  if (p < 80) {
    // Orange-red
    const t = (p - 60) / 20
    const r = Math.round(234 + t * (5))
    const g = Math.round(180 - t * (112))
    const b = Math.round(8 + t * (60))
    return `rgb(${r},${g},${b})`
  }
  // Deep red
  const t = (p - 80) / 20
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

function TileTooltipContent({ vm, metric }) {
  return (
    <Box sx={{ minWidth: 180 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <i
          className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
          style={{ fontSize: 13, opacity: 0.7 }}
        />
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          {vm.name || `VM ${vm.vmid}`}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', fontSize: 10, mb: 0.75 }}>
        #{vm.vmid} · {vm.type === 'lxc' ? 'LXC' : 'VM'} · {vm.node}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2.5 }}>
        <Box>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>CPU</Typography>
          <Typography variant="caption" sx={{
            display: 'block',
            fontWeight: metric === 'cpu' ? 700 : 400,
            fontFamily: '"JetBrains Mono", monospace',
          }}>
            {vm.cpuPct}%
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>RAM</Typography>
          <Typography variant="caption" sx={{
            display: 'block',
            fontWeight: metric === 'ram' ? 700 : 400,
            fontFamily: '"JetBrains Mono", monospace',
          }}>
            {vm.ramPct}%
          </Typography>
        </Box>
        <Box>
          <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>Alloc</Typography>
          <Typography variant="caption" sx={{ display: 'block', fontFamily: '"JetBrains Mono", monospace' }}>
            {formatBytes(vm.maxmem)}
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}

// Simple squarified-ish treemap layout within a rectangular area
function computeTreemapLayout(items, width, height) {
  if (items.length === 0 || width <= 0 || height <= 0) return []

  const totalValue = items.reduce((s, it) => s + it.value, 0)
  if (totalValue <= 0) return items.map((it, i) => ({ ...it, x: 0, y: 0, w: 0, h: 0 }))

  const rects = []
  let remaining = [...items].sort((a, b) => b.value - a.value)
  let x = 0, y = 0, w = width, h = height
  let remainingValue = totalValue

  while (remaining.length > 0) {
    const isHorizontal = w >= h

    // Find best split for the current strip
    let bestRatio = Infinity
    let bestCount = 1

    for (let count = 1; count <= remaining.length; count++) {
      const stripItems = remaining.slice(0, count)
      const stripValue = stripItems.reduce((s, it) => s + it.value, 0)

      const stripSize = isHorizontal
        ? (stripValue / remainingValue) * w
        : (stripValue / remainingValue) * h

      let worstRatio = 0
      let offset = 0

      for (const item of stripItems) {
        const frac = item.value / stripValue
        const itemLen = isHorizontal ? frac * h : frac * w

        if (stripSize > 0 && itemLen > 0) {
          const ratio = Math.max(stripSize / itemLen, itemLen / stripSize)
          worstRatio = Math.max(worstRatio, ratio)
        }

        offset += itemLen
      }

      if (worstRatio <= bestRatio) {
        bestRatio = worstRatio
        bestCount = count
      } else {
        break // Ratio getting worse, stop
      }
    }

    // Layout the strip
    const stripItems = remaining.slice(0, bestCount)
    const stripValue = stripItems.reduce((s, it) => s + it.value, 0)

    const stripSize = isHorizontal
      ? Math.max(1, (stripValue / remainingValue) * w)
      : Math.max(1, (stripValue / remainingValue) * h)

    let offset = 0

    for (const item of stripItems) {
      const frac = stripValue > 0 ? item.value / stripValue : 1 / stripItems.length
      const itemLen = isHorizontal ? frac * h : frac * w

      rects.push({
        ...item,
        x: isHorizontal ? x : x + offset,
        y: isHorizontal ? y + offset : y,
        w: isHorizontal ? stripSize : itemLen,
        h: isHorizontal ? itemLen : stripSize,
      })

      offset += itemLen
    }

    // Shrink remaining area
    if (isHorizontal) {
      x += stripSize
      w -= stripSize
    } else {
      y += stripSize
      h -= stripSize
    }

    remainingValue -= stripValue
    remaining = remaining.slice(bestCount)
  }

  return rects
}

function VmHeatmapWidget({ data, loading: dashboardLoading }) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const [metric, setMetric] = useState('ram')

  // Combine VMs + LXC, compute metrics
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
    })
  }, [data?.vmList, data?.lxcList])

  // Group by node
  const nodeGroups = useMemo(() => {
    const groups = {}

    guests.forEach((g) => {
      const key = g.node || 'unknown'
      if (!groups[key]) groups[key] = { node: key, vms: [], totalMem: 0 }
      groups[key].vms.push(g)
      groups[key].totalMem += Number(g.maxmem) || 0
    })

    return Object.values(groups).sort((a, b) => b.totalMem - a.totalMem)
  }, [guests])

  // Stats
  const stats = useMemo(() => {
    if (guests.length === 0) return null

    const vals = guests.map(g => metric === 'cpu' ? g.cpuPct : g.ramPct)
    const avg = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
    const max = Math.max(...vals)
    const hot = vals.filter(v => v >= 80).length

    return { avg, max, hot, total: guests.length }
  }, [guests, metric])

  const handleClick = useCallback((vm) => {
    router.push(`/infrastructure/inventory?selected=${vm.connId}&type=${vm.type}&vmid=${vm.vmid}&node=${vm.node}`)
  }, [router])

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

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, gap: 1 }}>
        {stats && (
          <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
              {stats.total} guests
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: 10 }}>
              Avg <Box component="span" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: '"JetBrains Mono", monospace' }}>{stats.avg}%</Box>
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

      {/* Treemap area */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {nodeGroups.map((group) => (
          <Box key={group.node} sx={{ mb: 1 }}>
            {/* Node header */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <i className="ri-server-line" style={{ fontSize: 11, color: theme.palette.text.secondary }} />
              <Typography variant="caption" sx={{ fontWeight: 600, fontSize: 10, color: 'text.secondary' }}>
                {group.node}
              </Typography>
              <Typography variant="caption" sx={{ fontSize: 9, color: 'text.disabled' }}>
                ({group.vms.length})
              </Typography>
            </Box>

            {/* Treemap tiles for this node */}
            <TreemapGroup
              vms={group.vms}
              metric={metric}
              theme={theme}
              onClick={handleClick}
            />
          </Box>
        ))}
      </Box>

      {/* Color scale legend */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, px: 0.5 }}>
        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>0%</Typography>
        <Box
          sx={{
            flex: 1,
            height: 6,
            borderRadius: 3,
            background: `linear-gradient(to right, ${getHeatColor(0)}, ${getHeatColor(30)}, ${getHeatColor(60)}, ${getHeatColor(80)}, ${getHeatColor(100)})`,
          }}
        />
        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>100%</Typography>
        <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary', ml: 0.5 }}>
          {metric.toUpperCase()}
        </Typography>
      </Box>
    </Box>
  )
}

// Sub-component: renders the treemap tiles for a single node group
function TreemapGroup({ vms, metric, theme, onClick }) {
  const containerRef = React.useRef(null)
  const [dims, setDims] = React.useState({ w: 0, h: 0 })

  React.useEffect(() => {
    if (!containerRef.current) return

    const obs = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect
      // Height is proportional to number of VMs, min 60, max 160
      const h = Math.max(60, Math.min(160, 20 + vms.length * 8))
      setDims({ w: width, h })
    })

    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [vms.length])

  const tiles = useMemo(() => {
    if (dims.w <= 0 || dims.h <= 0) return []

    const items = vms.map((vm) => ({
      ...vm,
      value: Math.max(Number(vm.maxmem) || 1, 1), // Size by allocated RAM
    }))

    return computeTreemapLayout(items, dims.w, dims.h)
  }, [vms, dims.w, dims.h])

  return (
    <Box
      ref={containerRef}
      sx={{
        position: 'relative',
        width: '100%',
        height: Math.max(60, Math.min(160, 20 + vms.length * 8)),
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: alpha(theme.palette.divider, 0.15),
      }}
    >
      {tiles.map((tile) => {
        const val = metric === 'cpu' ? tile.cpuPct : tile.ramPct
        const bgColor = getHeatColor(val)
        const showLabel = tile.w > 40 && tile.h > 18

        return (
          <MuiTooltip
            key={tile.id}
            title={<TileTooltipContent vm={tile} metric={metric} />}
            arrow
            placement="top"
            enterDelay={80}
            leaveDelay={0}
          >
            <Box
              onClick={() => onClick(tile)}
              sx={{
                position: 'absolute',
                left: tile.x,
                top: tile.y,
                width: Math.max(tile.w - 1, 1),
                height: Math.max(tile.h - 1, 1),
                bgcolor: bgColor,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                transition: 'filter 0.1s, z-index 0s',
                border: `0.5px solid ${alpha(theme.palette.common.black, 0.15)}`,
                '&:hover': {
                  filter: 'brightness(1.2)',
                  zIndex: 10,
                  outline: `2px solid ${theme.palette.common.white}`,
                },
              }}
            >
              {showLabel && (
                <Typography
                  sx={{
                    fontSize: Math.min(10, tile.h * 0.5),
                    fontWeight: 600,
                    color: val > 60 ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.75)',
                    lineHeight: 1,
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    px: 0.25,
                    textShadow: val > 60
                      ? '0 0 2px rgba(0,0,0,0.3)'
                      : '0 0 2px rgba(255,255,255,0.3)',
                  }}
                >
                  {tile.name || tile.vmid}
                </Typography>
              )}
            </Box>
          </MuiTooltip>
        )
      })}
    </Box>
  )
}

export default React.memo(VmHeatmapWidget)
