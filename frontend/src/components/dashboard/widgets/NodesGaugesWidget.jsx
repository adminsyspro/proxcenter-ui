'use client'

import React, { useEffect, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Checkbox, Chip, IconButton, ListItemText, Menu, MenuItem, Tooltip, Typography, useTheme } from '@mui/material'
import { AreaChart, Area, Tooltip as RTooltip } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import { widgetColors } from './themeColors'
import { mapTimeRange, sliceToRange, formatTime } from './timeRangeUtils'

// ─── Circular Gauge (animated on mount) ──────────────────────────────────────
function CircularGauge({ value, label, size = 64, strokeWidth = 5, color, theme }) {
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const [mounted, setMounted] = useState(false)
  const offset = mounted ? circumference - (value / 100) * circumference : circumference
  const isDark = theme?.palette?.mode === 'dark'
  const trackColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'

  useEffect(() => { const t = setTimeout(() => setMounted(true), 50);

 

return () => clearTimeout(t) }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
        </svg>
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
            {value}%
          </Typography>
        </Box>
      </Box>
      <Typography sx={{ fontSize: 9, opacity: 0.7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
    </Box>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getGaugeColor(value) {
  if (value >= 90) return '#f44336'
  if (value >= 75) return '#ff9800'
  
return '#4caf50'
}

function formatBytes(bytes) {
  if (!bytes) return '0'
  const gb = bytes / (1024 * 1024 * 1024)

  if (gb >= 1024) return `${(gb / 1024).toFixed(1)}T`
  if (gb >= 1) return `${gb.toFixed(1)}G`
  
return `${(bytes / (1024 * 1024)).toFixed(0)}M`
}

function formatUptime(seconds) {
  if (!seconds) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)

  if (days > 0) return `${days}d ${hours}h`
  
return `${hours}h`
}

function computeNodeScore(node) {
  let score = 100

  if (node.status !== 'online') return 0
  const cpu = node.cpuPct || 0
  const mem = node.memPct || 0

  if (cpu > 90) score -= 20; else if (cpu > 80) score -= 10; else if (cpu > 70) score -= 5
  if (mem > 90) score -= 20; else if (mem > 80) score -= 10; else if (mem > 70) score -= 5
  const storagePct = node._storageMax > 0 ? (node._storageUsed / node._storageMax) * 100 : 0

  if (storagePct > 90) score -= 15; else if (storagePct > 80) score -= 8
  
return Math.max(0, Math.min(100, score))
}

function formatRate(bytes) {
  if (bytes == null) return '-'
  if (bytes < 1024) return `${Math.round(bytes)} B/s`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB/s`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB/s`
  
return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB/s`
}

function getScoreColor(score) {
  if (score >= 80) return '#4caf50'
  if (score >= 50) return '#ff9800'
  
return '#f44336'
}

function buildSeries(raw) {
  const out = []

  for (const p of (raw || [])) {
    const t = p.time || p.t || p.timestamp

    if (!t) continue
    const cpuRaw = p.cpu ?? p.cpu_avg
    const cpu = cpuRaw != null ? Math.max(0, Math.min(100, Math.round(cpuRaw <= 1.5 ? cpuRaw * 100 : cpuRaw))) : 0
    const memRaw = p.mem ?? p.memused
    const maxMem = p.maxmem ?? p.memtotal
    let ram = 0

    if (memRaw != null) {
      if (memRaw <= 1.5) ram = Math.round(memRaw * 100)
      else if (maxMem > 0) ram = Math.round((memRaw / maxMem) * 100)
    }

    out.push({ t, cpu, ram, netin: p.netin ?? 0, netout: p.netout ?? 0, iowait: p.iowait != null ? Math.round(p.iowait * 100 * 10) / 10 : 0 })
  }

  
return out.sort((a, b) => a.t - b.t)
}

// ─── Sparkline Tooltips ──────────────────────────────────────────────────────

function CpuRamTooltip({ active, payload, isDark }) {
  if (!active || !payload?.length) return null
  const cpu = payload.find(p => p.dataKey === 'cpu')?.value
  const ram = payload.find(p => p.dataKey === 'ram')?.value
  const time = formatTime(payload)
  const c = widgetColors(isDark)

  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 80, color: c.tooltipText }}>
      <div style={{ background: '#f97316', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className='ri-cpu-line' style={{ fontSize: 10 }} /> CPU / RAM {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {cpu != null && <div><span style={{ color: '#f97316', fontWeight: 700 }}>CPU</span> {cpu}%</div>}
        {ram != null && <div><span style={{ color: '#3b82f6', fontWeight: 700 }}>RAM</span> {ram}%</div>}
      </div>
    </div>
  )
}

function IoNetTooltip({ active, payload, isDark }) {
  if (!active || !payload?.length) return null
  const netin = payload.find(p => p.dataKey === 'netin')?.value
  const netout = payload.find(p => p.dataKey === 'netout')?.value
  const iowait = payload.find(p => p.dataKey === 'iowait')?.value
  const time = formatTime(payload)
  const c = widgetColors(isDark)

  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 80, color: c.tooltipText }}>
      <div style={{ background: '#ab47bc', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className='ri-exchange-line' style={{ fontSize: 10 }} /> IO / NET {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {netin != null && <div><span style={{ color: '#4caf50', fontWeight: 700 }}>Net In</span> {formatRate(netin)}</div>}
        {netout != null && <div><span style={{ color: '#f97316', fontWeight: 700 }}>Net Out</span> {formatRate(netout)}</div>}
        {iowait != null && <div><span style={{ color: '#ab47bc', fontWeight: 700 }}>IO Wait</span> {iowait}%</div>}
      </div>
    </div>
  )
}

// ─── Node Card ───────────────────────────────────────────────────────────────
function NodeCard({ node, theme, trends }) {
  const cpuPct = node.cpuPct || 0
  const memPct = node.memPct || 0
  const storagePct = node._storageMax > 0 ? Math.round((node._storageUsed / node._storageMax) * 1000) / 10 : 0
  const isOnline = node.status === 'online'
  const score = computeNodeScore(node)
  const scoreColor = getScoreColor(score)
  const isDark = theme.palette.mode === 'dark'
  const hasTrends = trends && trends.length > 2

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5, p: 1.5, display: 'flex', flexDirection: 'column', gap: 1,
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        '&:hover': { borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)', boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ position: 'relative', width: 18, height: 18, flexShrink: 0 }}>
          <img src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={18} height={18} style={{ opacity: 0.8 }} />
          <Box sx={{ position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%', bgcolor: isOnline ? '#4caf50' : '#f44336', border: '1.5px solid', borderColor: isDark ? '#1e1e2d' : '#fff' }} />
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {node.name}
        </Typography>
        {isOnline && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ fontSize: 9, opacity: 0.65, fontFamily: '"JetBrains Mono", monospace' }}>{formatUptime(node.uptime)}</Typography>
            <Box sx={{ px: 0.5, py: 0.15, borderRadius: 0.5, bgcolor: `${scoreColor}18`, color: scoreColor, fontSize: 9, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.4 }}>{score}</Box>
          </Box>
        )}
      </Box>

      {isOnline ? (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'space-around' }}>
            <CircularGauge value={cpuPct} label="CPU" color={getGaugeColor(cpuPct)} theme={theme} />
            <CircularGauge value={memPct} label="RAM" color={getGaugeColor(memPct)} theme={theme} />
            <CircularGauge value={storagePct} label="DISK" color={getGaugeColor(storagePct)} theme={theme} />
          </Box>

          <Box>
            <Typography sx={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>CPU / RAM</Typography>
            <Box sx={{ height: 40, width: '100%' }}>
              {hasTrends ? (
                <ChartContainer>
                  <AreaChart data={trends} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <RTooltip content={<CpuRamTooltip isDark={isDark} />} wrapperStyle={{ backgroundColor: 'transparent', zIndex: 10 }} cursor={{ stroke: '#f97316', strokeWidth: 1, strokeDasharray: '3 3' }} />
                    <Area type="monotone" dataKey="cpu" stroke="#f97316" fill="#f97316" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                    <Area type="monotone" dataKey="ram" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ChartContainer>
              ) : <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.15 }}><Typography sx={{ fontSize: 9 }}>...</Typography></Box>}
            </Box>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>IO / NET</Typography>
            <Box sx={{ height: 40, width: '100%' }}>
              {hasTrends ? (
                <ChartContainer>
                  <AreaChart data={trends} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                    <RTooltip content={<IoNetTooltip isDark={isDark} />} wrapperStyle={{ backgroundColor: 'transparent', zIndex: 10 }} cursor={{ stroke: '#ab47bc', strokeWidth: 1, strokeDasharray: '3 3' }} />
                    <Area type="monotone" dataKey="netin" name="Net In" stroke="#4caf50" fill="#4caf50" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                    <Area type="monotone" dataKey="netout" name="Net Out" stroke="#f97316" fill="#f97316" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                  </AreaChart>
                </ChartContainer>
              ) : <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.15 }}><Typography sx={{ fontSize: 9 }}>...</Typography></Box>}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', opacity: 0.65 }}>
            <Typography sx={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>{node._cpuCores || '-'}c</Typography>
            <Typography sx={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(node._memMax)}</Typography>
            <Typography sx={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>{formatBytes(node._storageMax)}</Typography>
          </Box>
        </>
      ) : (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3 }}>
          <Typography variant='caption' sx={{ color: 'error.main', fontWeight: 700, fontSize: 11 }}>OFFLINE</Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Filter Selector ─────────────────────────────────────────────────────────
function NodeFilter({ nodes, selected, onChange }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const t = useTranslations()
  const allSelected = !selected || selected.length === 0

  const handleToggle = (nodeKey) => {
    if (allSelected) {
      // First click from "all" -> select only this one
      onChange([nodeKey])
    } else if (selected.includes(nodeKey)) {
      const next = selected.filter(k => k !== nodeKey)

      onChange(next.length === 0 ? [] : next) // empty = all
    } else {
      onChange([...selected, nodeKey])
    }
  }

  return (
    <>
      <Tooltip title={t('common.filter')}>
        <IconButton size='small' onClick={(e) => { e.stopPropagation(); setAnchorEl(e.currentTarget) }} sx={{ p: 0.25 }}>
          <i className='ri-filter-3-line' style={{ fontSize: 14, opacity: allSelected ? 0.4 : 1 }} />
        </IconButton>
      </Tooltip>
      {allSelected ? null : (
        <Chip label={selected.length} size='small' sx={{ height: 16, fontSize: 9, ml: -0.25 }} />
      )}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)} slotProps={{ paper: { sx: { maxHeight: 300 } } }}>
        <MenuItem dense onClick={() => { onChange([]); setAnchorEl(null) }}>
          <Checkbox size='small' checked={allSelected} sx={{ p: 0, mr: 1 }} />
          <ListItemText primaryTypographyProps={{ fontSize: 12 }}>{t('common.all')}</ListItemText>
        </MenuItem>
        {nodes.map(n => {
          const key = `${n.connId}:${n.node || n.name}`
          const checked = allSelected || selected.includes(key)

          
return (
            <MenuItem key={key} dense onClick={() => handleToggle(key)}>
              <Checkbox size='small' checked={checked} sx={{ p: 0, mr: 1 }} />
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: n.status === 'online' ? '#4caf50' : '#f44336', mr: 0.75 }} />
              <ListItemText primaryTypographyProps={{ fontSize: 12 }}>{n.name}</ListItemText>
              <Typography sx={{ fontSize: 10, opacity: 0.65, ml: 1 }}>{n.connection}</Typography>
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function NodesGaugesWidget({ data, loading, config, onUpdateSettings, timeRange }) {
  const t = useTranslations()
  const theme = useTheme()
  const allNodes = data?.nodes || []
  const [trends, setTrends] = useState({})

  // Selected nodes from settings (empty = all)
  const selectedNodes = config?.settings?.selectedNodes || []

  // Filter nodes
  const nodes = selectedNodes.length > 0
    ? allNodes.filter(n => selectedNodes.includes(`${n.connId}:${n.node || n.name}`))
    : allNodes

  const handleFilterChange = (newSelected) => {
    if (onUpdateSettings) onUpdateSettings({ selectedNodes: newSelected })
  }

  // Stable key for fetch dependency
  const nodesKey = nodes.map(n => `${n.connId}:${n.node || n.name}`).join(',')

  useEffect(() => {
    if (!nodes.length) return

    const grouped = {}

    for (const n of nodes) {
      if (n.status !== 'online') continue
      if (!grouped[n.connId]) grouped[n.connId] = []
      grouped[n.connId].push(n.node || n.name)
    }

    if (Object.keys(grouped).length === 0) return

    const controller = new AbortController()
    let cancelled = false

    Promise.all(
      Object.entries(grouped).flatMap(([connId, nodeNames]) =>
        nodeNames.map(async (name) => {
          try {
            const res = await fetch(
              `/api/v1/connections/${encodeURIComponent(connId)}/rrd?path=${encodeURIComponent(`/nodes/${name}`)}&timeframe=${mapTimeRange(timeRange).rrdTimeframe}`,
              { cache: 'no-store', signal: controller.signal }
            )

            if (!res.ok) return null
            const json = await res.json()
            let raw = []

            if (Array.isArray(json)) raw = json
            else if (Array.isArray(json?.data)) raw = json.data
            else if (json?.data && typeof json.data === 'object') raw = Object.values(json.data)
            
return { key: `${connId}:${name}`, series: sliceToRange(buildSeries(raw), timeRange) }
          } catch { return null }
        })
      )
    ).then(results => {
      if (cancelled) return
      const map = {}

      for (const r of results) { if (r && r.series.length > 0) map[r.key] = r.series }
      setTrends(map)
    })

    return () => { cancelled = true; controller.abort() }
  }, [nodesKey, timeRange]) // eslint-disable-line react-hooks/exhaustive-deps

  if (allNodes.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant='caption' sx={{ opacity: 0.65 }}>{t('common.noData')}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 4, right: 4, zIndex: 5 }}>
        <NodeFilter nodes={allNodes} selected={selectedNodes} onChange={handleFilterChange} />
      </Box>
      <Box sx={{
        height: '100%', overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
        gap: 1, p: 0.5,
      }}>
        {nodes.map((node) => (
          <NodeCard
            key={`${node.connId}-${node.node}`}
            node={node}
            theme={theme}
            trends={trends[`${node.connId}:${node.node || node.name}`] || []}
          />
        ))}
      </Box>
    </Box>
  )
}

export default React.memo(NodesGaugesWidget)
