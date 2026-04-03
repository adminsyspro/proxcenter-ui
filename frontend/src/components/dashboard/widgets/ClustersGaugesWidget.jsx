'use client'

import React, { useEffect, useRef, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Checkbox, Chip, IconButton, ListItemText, Menu, MenuItem, Tooltip, Typography, useTheme } from '@mui/material'
import { AreaChart, Area, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'

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

    out.push({ t, cpu, ram, net: (p.netin ?? 0) + (p.netout ?? 0), diskio: (p.diskread ?? 0) + (p.diskwrite ?? 0) })
  }

  
return out.sort((a, b) => a.t - b.t)
}

function mergeNodeTrends(nodeKeys, allTrends) {
  const allSeries = nodeKeys.map(k => allTrends[k] || []).filter(s => s.length > 0)

  if (allSeries.length === 0) return []
  const base = allSeries.reduce((longest, s) => s.length > longest.length ? s : longest, [])

  
return base.map((point, i) => {
    let cpu = 0, ram = 0, net = 0, diskio = 0, count = 0

    for (const s of allSeries) {
      if (s[i]) { cpu += s[i].cpu || 0; ram += s[i].ram || 0; net += s[i].net || 0; diskio += s[i].diskio || 0; count++ }
    }

    if (count === 0) return { t: point.t, cpu: 0, ram: 0, net: 0, diskio: 0 }
    
return { t: point.t, cpu: Math.round(cpu / count), ram: Math.round(ram / count), net: Math.round(net / count), diskio: Math.round(diskio / count) }
  })
}

// ─── Sparkline Tooltips ──────────────────────────────────────────────────────

function CpuRamTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const cpu = payload.find(p => p.dataKey === 'cpu')?.value
  const ram = payload.find(p => p.dataKey === 'ram')?.value
  const time = formatTime(payload)

  
return (
    <div style={{ background: 'var(--mui-palette-background-paper)', border: '1px solid var(--mui-palette-divider)', borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 80 }}>
      <div style={{ background: 'var(--mui-palette-warning-main)', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className='ri-cpu-line' style={{ fontSize: 10 }} /> CPU / RAM {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {cpu != null && <div><span style={{ color: 'var(--mui-palette-warning-main)', fontWeight: 700 }}>CPU</span> {cpu}%</div>}
        {ram != null && <div><span style={{ color: 'var(--mui-palette-info-main)', fontWeight: 700 }}>RAM</span> {ram}%</div>}
      </div>
    </div>
  )
}

function IoNetTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const diskio = payload.find(p => p.dataKey === 'diskio')?.value
  const net = payload.find(p => p.dataKey === 'net')?.value
  const time = formatTime(payload)

  
return (
    <div style={{ background: 'var(--mui-palette-background-paper)', border: '1px solid var(--mui-palette-divider)', borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 80 }}>
      <div style={{ background: '#ab47bc', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className='ri-exchange-line' style={{ fontSize: 10 }} /> IO / NET {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {diskio != null && <div><span style={{ color: '#ab47bc', fontWeight: 700 }}>IO</span> {formatRate(diskio)}</div>}
        {net != null && <div><span style={{ color: '#26a69a', fontWeight: 700 }}>NET</span> {formatRate(net)}</div>}
      </div>
    </div>
  )
}

// ─── Cluster Card ────────────────────────────────────────────────────────────
function ClusterCard({ cluster, clusterNodes, theme, allTrends, vmList, lxcList }) {
  const isDark = theme.palette.mode === 'dark'
  const onlineNodes = clusterNodes.filter(n => n.status === 'online')
  const totalNodes = clusterNodes.length

  const cpuPct = onlineNodes.length > 0
    ? Math.round(onlineNodes.reduce((s, n) => s + (n.cpuPct || 0), 0) / onlineNodes.length * 10) / 10 : 0

  const memPct = onlineNodes.length > 0
    ? Math.round(onlineNodes.reduce((s, n) => s + (n.memPct || 0), 0) / onlineNodes.length * 10) / 10 : 0

  const storageUsed = clusterNodes.reduce((s, n) => s + (n._storageUsed || 0), 0)
  const storageMax = clusterNodes.reduce((s, n) => s + (n._storageMax || 0), 0)
  const storagePct = storageMax > 0 ? Math.round((storageUsed / storageMax) * 1000) / 10 : 0

  const connId = cluster.id
  const vmsRunning = (vmList || []).filter(v => v.connId === connId && !v.template && v.status === 'running').length
  const lxcRunning = (lxcList || []).filter(v => v.connId === connId && !v.template && v.status === 'running').length

  let score = 100

  score -= (totalNodes - onlineNodes.length) * 20
  if (cpuPct > 90) score -= 15; else if (cpuPct > 80) score -= 8
  if (memPct > 90) score -= 15; else if (memPct > 80) score -= 8
  if (storagePct > 90) score -= 10; else if (storagePct > 80) score -= 5
  if (cluster.cephHealth === 'HEALTH_WARN') score -= 10
  else if (cluster.cephHealth === 'HEALTH_ERR') score -= 25
  if (cluster.quorum && !cluster.quorum.quorate) score -= 30
  score = Math.max(0, Math.min(100, score))
  const scoreColor = getScoreColor(score)

  const nodeKeys = onlineNodes.map(n => `${connId}:${n.node || n.name}`)
  const mergedTrends = mergeNodeTrends(nodeKeys, allTrends)
  const hasTrends = mergedTrends.length > 2

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
          <i className='ri-server-line' style={{ fontSize: 18, opacity: 0.7 }} />
          <Box sx={{
            position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%',
            bgcolor: onlineNodes.length === totalNodes ? '#4caf50' : onlineNodes.length > 0 ? '#ff9800' : '#f44336',
            border: '1.5px solid', borderColor: isDark ? '#1e1e2d' : '#fff'
          }} />
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {cluster.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ fontSize: 9, opacity: 0.65, fontFamily: '"JetBrains Mono", monospace' }}>
            {onlineNodes.length}/{totalNodes}
          </Typography>
          <Box sx={{ px: 0.5, py: 0.15, borderRadius: 0.5, bgcolor: `${scoreColor}18`, color: scoreColor, fontSize: 9, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.4 }}>
            {score}
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-around' }}>
        <CircularGauge value={cpuPct} label="CPU" color={getGaugeColor(cpuPct)} theme={theme} />
        <CircularGauge value={memPct} label="RAM" color={getGaugeColor(memPct)} theme={theme} />
        <CircularGauge value={storagePct} label="DISK" color={getGaugeColor(storagePct)} theme={theme} />
      </Box>

      <Box>
        <Typography sx={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>CPU / RAM</Typography>
        <Box sx={{ height: 40, width: '100%' }}>
          {hasTrends ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={mergedTrends} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <RTooltip content={<CpuRamTooltip />} wrapperStyle={{ backgroundColor: 'transparent' }} cursor={{ stroke: theme.palette.warning.main, strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="cpu" stroke={theme.palette.warning.main} fill={theme.palette.warning.main} fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="ram" stroke={theme.palette.info.main} fill={theme.palette.info.main} fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.15 }}><Typography sx={{ fontSize: 9 }}>...</Typography></Box>}
        </Box>
      </Box>

      <Box>
        <Typography sx={{ fontSize: 9, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>IO / NET</Typography>
        <Box sx={{ height: 40, width: '100%' }}>
          {hasTrends ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={mergedTrends} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <RTooltip content={<IoNetTooltip />} wrapperStyle={{ backgroundColor: 'transparent' }} cursor={{ stroke: '#ab47bc', strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="diskio" stroke="#ab47bc" fill="#ab47bc" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="net" stroke="#26a69a" fill="#26a69a" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.15 }}><Typography sx={{ fontSize: 9 }}>...</Typography></Box>}
        </Box>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.7 }}>
        <Typography sx={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>
          {vmsRunning} VM{vmsRunning !== 1 ? 's' : ''} {lxcRunning} LXC
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
          {cluster.cephHealth && cluster.cephHealth !== 'UNKNOWN' && (() => {
            const cephColor = cluster.cephHealth === 'HEALTH_OK' ? '#4caf50' : cluster.cephHealth === 'HEALTH_WARN' ? '#ff9800' : '#f44336'

            
return (
              <span title={`Ceph: ${cluster.cephHealth}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'default' }}>
                <i className='ri-database-2-line' style={{ fontSize: 11, color: cephColor }} />
                <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace', color: cephColor }}>
                  {cluster.cephHealth.replace('HEALTH_', '')}
                </span>
              </span>
            )
          })()}
          {cluster.quorum && cluster.quorum.expected_votes > 0 && (() => {
            const qColor = cluster.quorum.quorate ? '#4caf50' : '#f44336'

            
return (
              <span title={`Quorum: ${cluster.quorum.votes}/${cluster.quorum.expected_votes} votes${cluster.quorum.quorate ? '' : ' (NOT QUORATE)'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'default' }}>
                <i className='ri-shield-check-line' style={{ fontSize: 11, color: qColor }} />
                <span style={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace', color: qColor }}>
                  {cluster.quorum.votes}/{cluster.quorum.expected_votes}
                </span>
              </span>
            )
          })()}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Filter Selector ─────────────────────────────────────────────────────────
function ClusterFilter({ clusters, selected, onChange }) {
  const [anchorEl, setAnchorEl] = useState(null)
  const t = useTranslations()
  const allSelected = !selected || selected.length === 0

  const handleToggle = (id) => {
    if (allSelected) {
      onChange([id])
    } else if (selected.includes(id)) {
      const next = selected.filter(k => k !== id)

      onChange(next.length === 0 ? [] : next)
    } else {
      onChange([...selected, id])
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
        {clusters.map(c => {
          const checked = allSelected || selected.includes(c.id)

          
return (
            <MenuItem key={c.id} dense onClick={() => handleToggle(c.id)}>
              <Checkbox size='small' checked={checked} sx={{ p: 0, mr: 1 }} />
              <ListItemText primaryTypographyProps={{ fontSize: 12 }}>{c.name}</ListItemText>
              <Typography sx={{ fontSize: 10, opacity: 0.65, ml: 1 }}>{c.nodes}n</Typography>
            </MenuItem>
          )
        })}
      </Menu>
    </>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function ClustersGaugesWidget({ data, loading, config, onUpdateSettings, timeRange }) {
  const t = useTranslations()
  const theme = useTheme()
  const allClusters = data?.clusters || []
  const nodes = data?.nodes || []
  const vmList = data?.vmList || []
  const lxcList = data?.lxcList || []
  const [trends, setTrends] = useState({})

  const selectedClusters = config?.settings?.selectedClusters || []

  const clusters = selectedClusters.length > 0
    ? allClusters.filter(c => selectedClusters.includes(c.id))
    : allClusters

  const handleFilterChange = (newSelected) => {
    if (onUpdateSettings) onUpdateSettings({ selectedClusters: newSelected })
  }

  // Only fetch RRD for nodes belonging to selected clusters
  const relevantNodes = selectedClusters.length > 0
    ? nodes.filter(n => selectedClusters.includes(n.connId) || selectedClusters.includes(n.connectionId))
    : nodes

  const nodesKey = relevantNodes.map(n => `${n.connId}:${n.node || n.name}`).join(',')

  useEffect(() => {
    if (!relevantNodes.length) return

    const grouped = {}

    for (const n of relevantNodes) {
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

  if (allClusters.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant='caption' sx={{ opacity: 0.65 }}>{t('common.noData')}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ height: '100%', position: 'relative' }}>
      <Box sx={{ position: 'absolute', top: 4, right: 4, zIndex: 5 }}>
        <ClusterFilter clusters={allClusters} selected={selectedClusters} onChange={handleFilterChange} />
      </Box>
      <Box sx={{
        height: '100%', overflow: 'auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
        gap: 1, p: 0.5,
      }}>
        {clusters.map((cluster) => (
          <ClusterCard
            key={cluster.id}
            cluster={cluster}
            clusterNodes={nodes.filter(n => n.connId === cluster.id || n.connectionId === cluster.id)}
            theme={theme}
            allTrends={trends}
            vmList={vmList}
            lxcList={lxcList}
          />
        ))}
      </Box>
    </Box>
  )
}

export default React.memo(ClustersGaugesWidget)
