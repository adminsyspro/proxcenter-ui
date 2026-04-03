'use client'

import React, { useMemo, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Box, Checkbox, IconButton, ListItemText, Menu, MenuItem,
  Tooltip as MuiTooltip, Typography, useTheme,
} from '@mui/material'
import { widgetColors } from './themeColors'

// ─── Colors ──────────────────────────────────────────────────────────────────
function getHeatColor(pct) {
  const p = Math.max(0, Math.min(100, pct))
  if (p < 30) { const t = p / 30; return `rgb(${Math.round(34 + t * 100)},${Math.round(197 + t * 7)},${Math.round(94 - t * 72)})` }
  if (p < 60) { const t = (p - 30) / 30; return `rgb(${Math.round(134 + t * 100)},${Math.round(204 - t * 24)},${Math.round(22 - t * 14)})` }
  if (p < 80) { const t = (p - 60) / 20; return `rgb(${Math.round(234 + t * 5)},${Math.round(180 - t * 112)},${Math.round(8 + t * 60)})` }
  const t = (p - 80) / 20; return `rgb(${Math.round(239 - t * 30)},${Math.round(68 - t * 40)},${Math.round(68 - t * 30)})`
}

const STATUS_COLORS = {
  running: '#4caf50',
  stopped: '#9e9e9e',
  paused: '#ff9800',
  suspended: '#ff9800',
  unknown: '#616161',
}

function getStatusColor(status) {
  return STATUS_COLORS[status] || STATUS_COLORS.unknown
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`
}

// ─── Tooltip ─────────────────────────────────────────────────────────────────
function TileTooltip({ vm, mode, isDark }) {
  const headerColor = mode === 'status' ? getStatusColor(vm.status) : getHeatColor(mode === 'cpu' ? vm.cpuPct : vm.ramPct)
  const c = widgetColors(isDark)
  const labelColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'
  const footerColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)'
  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 140, color: c.tooltipText }}>
      <div style={{ background: headerColor, color: '#fff', padding: '3px 8px', fontWeight: 700, fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, textShadow: '0 0 2px rgba(0,0,0,0.4)' }}>
        <i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: 11 }} />
        {vm.name || `VM ${vm.vmid}`}
      </div>
      <div style={{ padding: '5px 8px', display: 'flex', gap: 12 }}>
        <div>
          <div style={{ color: labelColor, fontSize: 9 }}>Status</div>
          <div style={{ fontWeight: 600, color: getStatusColor(vm.status), fontFamily: '"JetBrains Mono", monospace' }}>{vm.status}</div>
        </div>
        {vm.status === 'running' && (
          <>
            <div>
              <div style={{ color: labelColor, fontSize: 9 }}>CPU</div>
              <div style={{ fontWeight: mode === 'cpu' ? 700 : 400, fontFamily: '"JetBrains Mono", monospace' }}>{vm.cpuPct}%</div>
            </div>
            <div>
              <div style={{ color: labelColor, fontSize: 9 }}>RAM</div>
              <div style={{ fontWeight: mode === 'ram' ? 700 : 400, fontFamily: '"JetBrains Mono", monospace' }}>{vm.ramPct}%</div>
            </div>
          </>
        )}
        <div>
          <div style={{ color: labelColor, fontSize: 9 }}>Alloc</div>
          <div style={{ fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(vm.maxmem)}</div>
        </div>
      </div>
      <div style={{ padding: '0 8px 4px', fontSize: 9, color: footerColor }}>
        #{vm.vmid} · {vm.type === 'lxc' ? 'LXC' : 'VM'} · {vm.node}
      </div>
    </div>
  )
}

// ─── Connection Filter ───────────────────────────────────────────────────────
function ConnectionFilter({ connections, selected, onChange }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const allSelected = !selected || selected.length === 0

  const handleToggle = (id) => {
    if (allSelected) onChange([id])
    else if (selected.includes(id)) { const next = selected.filter(k => k !== id); onChange(next.length === 0 ? [] : next) }
    else onChange([...selected, id])
  }

  return (
    <>
      <IconButton size='small' onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget) }} sx={{ p: 0.25 }}>
        <i className='ri-filter-3-line' style={{ fontSize: 14, opacity: allSelected ? 0.5 : 1, color: '#fff' }} />
      </IconButton>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} slotProps={{ paper: { sx: { maxHeight: 300 } } }}>
        <MenuItem dense onClick={() => { onChange([]); setAnchorEl(null) }}>
          <Checkbox size='small' checked={allSelected} sx={{ p: 0, mr: 1 }} />
          <ListItemText primaryTypographyProps={{ fontSize: 12 }}>All</ListItemText>
        </MenuItem>
        {connections.map(c => (
          <MenuItem key={c.id} dense onClick={() => handleToggle(c.id)}>
            <Checkbox size='small' checked={allSelected || selected.includes(c.id)} sx={{ p: 0, mr: 1 }} />
            <ListItemText primaryTypographyProps={{ fontSize: 12 }}>{c.name}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
const TILE_SIZE = 22
const TILE_GAP = 2
const MODES = ['status', 'cpu', 'ram']

function VmHeatmapWidget({ data, loading: dashboardLoading, config, onUpdateSettings }) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const [mode, setMode] = useState('status')
  const [minThreshold, setMinThreshold] = useState(0)

  const selectedConnections = config?.settings?.selectedConnections || []
  const handleFilterChange = (newSelected) => { if (onUpdateSettings) onUpdateSettings({ selectedConnections: newSelected }) }
  const allConnections = useMemo(() => (data?.clusters || []).map(c => ({ id: c.id, name: c.name })), [data?.clusters])

  // Combine VMs + LXC
  const guests = useMemo(() => {
    const vms = data?.vmList || []
    const lxcs = data?.lxcList || []
    let all = [...vms, ...lxcs].filter(g => !g.template)

    if (selectedConnections.length > 0) all = all.filter(g => selectedConnections.includes(g.connId))

    const mapped = all.map((g) => {
      const cpuPct = Math.round((Number(g.cpu) || 0) * 100)
      const mem = Number(g.mem) || 0
      const maxmem = Number(g.maxmem) || 0
      const ramPct = maxmem > 0 ? Math.round((mem / maxmem) * 100) : 0
      return { ...g, cpuPct, ramPct }
    })

    // In status mode: show all (running + stopped). In cpu/ram mode: only running + threshold
    let filtered = mode === 'status'
      ? mapped
      : mapped.filter(g => g.status === 'running')

    if (mode !== 'status' && minThreshold > 0) {
      filtered = filtered.filter(g => (mode === 'cpu' ? g.cpuPct : g.ramPct) >= minThreshold)
    }

    // Sort: status mode by status then name, cpu/ram mode by value desc
    if (mode === 'status') {
      filtered.sort((a, b) => {
        if (a.status !== b.status) return a.status === 'running' ? -1 : 1
        return (a.name || '').localeCompare(b.name || '')
      })
    } else {
      filtered.sort((a, b) => (mode === 'cpu' ? b.cpuPct - a.cpuPct : b.ramPct - a.ramPct))
    }

    return filtered
  }, [data?.vmList, data?.lxcList, selectedConnections, mode, minThreshold])

  // Group by node
  const nodeGroups = useMemo(() => {
    const groups = {}
    guests.forEach((g) => {
      const key = g.node || 'unknown'
      if (!groups[key]) groups[key] = { node: key, connId: g.connId, vms: [] }
      groups[key].vms.push(g)
    })
    return Object.values(groups).sort((a, b) => b.vms.length - a.vms.length)
  }, [guests])

  // Stats
  const stats = useMemo(() => {
    if (guests.length === 0) return null
    const running = guests.filter(g => g.status === 'running').length
    const stopped = guests.filter(g => g.status !== 'running').length
    if (mode === 'status') return { total: guests.length, running, stopped }
    const vals = guests.map(g => mode === 'cpu' ? g.cpuPct : g.ramPct)
    return { total: guests.length, avg: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length), hot: vals.filter(v => v >= 80).length }
  }, [guests, mode])

  const handleClick = useCallback((vm) => { router.push(`/infrastructure/inventory?vmid=${vm.vmid}&connId=${vm.connId}&node=${vm.node}&type=${vm.type}`) }, [router])
  const cycleThreshold = () => setMinThreshold(prev => prev === 0 ? 20 : prev === 20 ? 50 : 0)

  // Tile color based on mode
  const getTileColor = (vm) => {
    if (mode === 'status') return getStatusColor(vm.status)
    return getHeatColor(mode === 'cpu' ? vm.cpuPct : vm.ramPct)
  }

  // Tile label
  const getTileLabel = (vm) => {
    if (mode === 'status') return vm.status === 'running' ? '' : ''
    return mode === 'cpu' ? vm.cpuPct : vm.ramPct
  }

  const darkCard = {
    bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
    border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    borderRadius: 2.5, p: 1.5,
    transition: 'border-color 0.2s, box-shadow 0.2s',
    '&:hover': { borderColor: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)', boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
  }

  if (!data || dashboardLoading) {
    return <Box sx={{ height: '100%', ...darkCard, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Typography sx={{ opacity: 0.4, fontSize: 11 }}>Loading...</Typography></Box>
  }

  if (guests.length === 0) {
    return <Box sx={{ height: '100%', ...darkCard, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Typography sx={{ opacity: 0.4, fontSize: 11 }}>{t('common.noData')}</Typography></Box>
  }

  return (
    <Box sx={{ height: '100%', ...darkCard, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75, gap: 0.5, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          {stats && (
            <>
              <Typography sx={{ fontSize: 10, opacity: 0.6 }}>{stats.total} guests</Typography>
              {mode === 'status' && (
                <>
                  <Typography sx={{ fontSize: 10, color: '#4caf50', fontWeight: 600 }}>{stats.running} <span style={{ fontWeight: 400, opacity: 0.7 }}>running</span></Typography>
                  {stats.stopped > 0 && <Typography sx={{ fontSize: 10, color: '#9e9e9e', fontWeight: 600 }}>{stats.stopped} <span style={{ fontWeight: 400, opacity: 0.7 }}>stopped</span></Typography>}
                </>
              )}
              {mode !== 'status' && (
                <>
                  <Typography sx={{ fontSize: 10, opacity: 0.6 }}>
                    Avg <span style={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>{stats.avg}%</span>
                  </Typography>
                  {stats.hot > 0 && <Typography sx={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>{stats.hot} hot</Typography>}
                </>
              )}
            </>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {/* Mode toggle */}
          {MODES.map((v) => (
            <Box key={v} onClick={() => setMode(v)} sx={{
              px: 0.75, py: 0.2, borderRadius: 1, cursor: 'pointer', fontSize: 10, fontWeight: mode === v ? 700 : 400,
              color: mode === v ? '#fff' : c.textMuted, bgcolor: mode === v ? c.surfaceActive : 'transparent',
              '&:hover': { bgcolor: c.surfaceSubtle },
            }}>{v === 'status' ? 'Status' : v.toUpperCase()}</Box>
          ))}

          {/* Threshold (only in cpu/ram mode) */}
          {mode !== 'status' && (
            <Box onClick={cycleThreshold} sx={{
              px: 0.75, py: 0.2, borderRadius: 1, cursor: 'pointer', fontSize: 10, fontWeight: 600,
              color: minThreshold > 0 ? '#fff' : c.textMuted,
              bgcolor: minThreshold > 0 ? c.surfaceActive : c.borderLight,
              '&:hover': { bgcolor: c.surfaceSubtle },
            }}>{minThreshold > 0 ? `>${minThreshold}%` : 'All'}</Box>
          )}

          {allConnections.length > 1 && <ConnectionFilter connections={allConnections} selected={selectedConnections} onChange={handleFilterChange} />}
        </Box>
      </Box>

      {/* Grid by node */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {nodeGroups.map((group) => (
          <Box key={group.node} sx={{ mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.4 }}>
              <Box sx={{ position: 'relative', width: 14, height: 14, flexShrink: 0 }}>
                <img src='/images/proxmox-logo-dark.svg' alt="" width={12} height={12} style={{ opacity: 0.6 }} />
                <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 5, height: 5, borderRadius: '50%', bgcolor: '#4caf50', border: `1px solid ${isDark ? '#1e1e2d' : '#fff'}` }} />
              </Box>
              <Typography sx={{ fontWeight: 600, fontSize: 10, opacity: 0.6 }}>{group.node}</Typography>
              <Typography sx={{ fontSize: 9, opacity: 0.35 }}>({group.vms.length})</Typography>
            </Box>

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: `${TILE_GAP}px` }}>
              {group.vms.map((vm) => {
                const tileColor = getTileColor(vm)
                const label = getTileLabel(vm)
                const isRunning = vm.status === 'running'
                return (
                  <MuiTooltip key={vm.id} title={<TileTooltip vm={vm} mode={mode} isDark={isDark} />} arrow placement="top" enterDelay={80} leaveDelay={0}
                    slotProps={{ tooltip: { sx: { bgcolor: 'transparent', p: 0, maxWidth: 'none' } }, arrow: { sx: { color: c.tooltipBg } } }}
                  >
                    <Box
                      onClick={() => handleClick(vm)}
                      sx={{
                        width: TILE_SIZE, height: TILE_SIZE, borderRadius: 0.5,
                        bgcolor: tileColor, cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: mode === 'status' && !isRunning ? 0.5 : 1,
                        transition: 'transform 0.1s, box-shadow 0.1s',
                        '&:hover': { transform: 'scale(1.3)', zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.4)', outline: '1px solid rgba(255,255,255,0.5)' },
                      }}
                    >
                      {mode !== 'status' && (
                        <Typography sx={{
                          fontSize: 7, fontWeight: 700, lineHeight: 1,
                          color: (mode === 'cpu' ? vm.cpuPct : vm.ramPct) > 50 ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)',
                          textShadow: (mode === 'cpu' ? vm.cpuPct : vm.ramPct) > 50 ? '0 0 1px rgba(0,0,0,0.3)' : 'none',
                        }}>
                          {label}
                        </Typography>
                      )}
                      {mode === 'status' && !isRunning && (
                        <i className='ri-stop-fill' style={{ fontSize: 8, color: c.textSecondary }} />
                      )}
                    </Box>
                  </MuiTooltip>
                )
              })}
            </Box>
          </Box>
        ))}
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
        {mode === 'status' ? (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: '#4caf50' }} />
              <Typography sx={{ fontSize: 9, opacity: 0.6 }}>Running</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: '#9e9e9e', opacity: 0.5 }} />
              <Typography sx={{ fontSize: 9, opacity: 0.6 }}>Stopped</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
              <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: '#ff9800' }} />
              <Typography sx={{ fontSize: 9, opacity: 0.6 }}>Paused</Typography>
            </Box>
          </>
        ) : (
          <>
            <Typography sx={{ fontSize: 9, opacity: 0.5 }}>0%</Typography>
            <Box sx={{ flex: 1, height: 5, borderRadius: 3, background: `linear-gradient(to right, ${getHeatColor(0)}, ${getHeatColor(30)}, ${getHeatColor(60)}, ${getHeatColor(80)}, ${getHeatColor(100)})` }} />
            <Typography sx={{ fontSize: 9, opacity: 0.5 }}>100%</Typography>
            <Typography sx={{ fontSize: 9, opacity: 0.5, ml: 0.5 }}>{mode.toUpperCase()}</Typography>
          </>
        )}
      </Box>
    </Box>
  )
}

export default React.memo(VmHeatmapWidget)
