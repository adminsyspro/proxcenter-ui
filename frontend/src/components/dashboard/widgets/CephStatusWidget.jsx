'use client'

import React, { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Box, Typography, useTheme } from '@mui/material'
import { AreaChart, Area, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import { widgetColors } from './themeColors'

// ─── Animated Circular Gauge ─────────────────────────────────────────────────
function CircularGauge({ value, label, size = 56, strokeWidth = 4.5, color, sublabel, isDark = true }) {
  const c = widgetColors(isDark)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const [mounted, setMounted] = useState(false)
  const offset = mounted ? circumference - (value / 100) * circumference : circumference

  useEffect(() => { const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t) }, [])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
      <Box sx={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={c.surfaceSubtle} strokeWidth={strokeWidth} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
        </svg>
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ fontSize: 10, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
            {value}%
          </Typography>
        </Box>
      </Box>
      <Typography sx={{ fontSize: 8, opacity: 0.7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Typography>
      {sublabel && (
        <Typography sx={{ fontSize: 8, opacity: 0.5, fontFamily: '"JetBrains Mono", monospace', mt: -0.25 }}>
          {sublabel}
        </Typography>
      )}
    </Box>
  )
}

// ─── Sparkline Tooltips ──────────────────────────────────────────────────────
function formatTime(payload) {
  const t = payload?.[0]?.payload?.t
  if (!t) return null
  if (typeof t === 'number') return new Date(t > 1e12 ? t : t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return t
}

function ThroughputTooltip({ active, payload, isDark }) {
  if (!active || !payload?.length) return null
  const time = formatTime(payload)
  const c = widgetColors(isDark)
  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 90, color: c.tooltipText }}>
      <div style={{ background: '#3b82f6', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className='ri-speed-line' style={{ fontSize: 10 }} /> Throughput {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px' }}>
        {payload.map(e => (
          <div key={e.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
            <span style={{ color: e.color, fontWeight: 700 }}>{e.dataKey === 'read' ? 'R' : 'W'}</span>
            <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(e.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function IopsTooltip({ active, payload, isDark }) {
  if (!active || !payload?.length) return null
  const time = formatTime(payload)
  const c = widgetColors(isDark)
  return (
    <div style={{ background: c.tooltipBg, border: `1px solid ${c.tooltipBorder}`, borderRadius: 6, overflow: 'hidden', fontSize: 10, minWidth: 90, color: c.tooltipText }}>
      <div style={{ background: '#8b5cf6', color: '#fff', padding: '2px 8px', fontWeight: 700, fontSize: 9, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className='ri-flashlight-line' style={{ fontSize: 10 }} /> IOPS {time && <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: 'auto' }}>{time}</span>}
      </div>
      <div style={{ padding: '4px 8px' }}>
        {payload.map(e => (
          <div key={e.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
            <span style={{ color: e.color, fontWeight: 700 }}>{e.dataKey === 'readIops' ? 'R' : 'W'}</span>
            <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{Math.round(e.value)} op/s</span>
          </div>
        ))}
      </div>
    </div>
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
  if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
}

function formatBps(bps) {
  if (!bps || bps === 0) return '0 B/s'
  const k = 1024
  const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  const i = Math.floor(Math.log(bps) / Math.log(k))
  return Number.parseFloat((bps / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// ─── Ceph Cluster Card ───────────────────────────────────────────────────────
function CephClusterCard({ cluster, isDark, perfData }) {
  const c = widgetColors(isDark)
  const healthColor = cluster.health === 'HEALTH_OK' ? '#4caf50' : cluster.health === 'HEALTH_WARN' ? '#ff9800' : '#f44336'
  const osdPct = cluster.osdsTotal > 0 ? Math.round((cluster.osdsUp / cluster.osdsTotal) * 100) : 0
  const storagePct = cluster.usedPct || 0
  const hasIO = (cluster.readBps > 0 || cluster.writeBps > 0)
  const hasPerfData = perfData && perfData.length > 2

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5, p: 1.5, display: 'flex', flexDirection: 'column',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': { borderColor: c.surfaceActive, boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
      }}
    >
      {/* Top content */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ position: 'relative', width: 18, height: 18, flexShrink: 0 }}>
          <img src="/images/ceph-logo.svg" alt="Ceph" width={18} height={18} style={{ opacity: 0.8 }} />
          <Box sx={{
            position: 'absolute', bottom: -1, right: -1, width: 7, height: 7, borderRadius: '50%',
            bgcolor: healthColor, border: '1.5px solid', borderColor: c.dotBorder,
          }} />
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {cluster.name}
        </Typography>
        <Box sx={{
          px: 0.5, py: 0.15, borderRadius: 0.5,
          bgcolor: `${healthColor}18`, color: healthColor,
          fontSize: 9, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1.4,
        }}>
          {cluster.health?.replace('HEALTH_', '') || '?'}
        </Box>
      </Box>

      {/* Gauges: OSD + Storage */}
      <Box sx={{ display: 'flex', justifyContent: 'space-around' }}>
        <CircularGauge value={osdPct} label="OSDs" color={osdPct >= 100 ? '#4caf50' : osdPct >= 80 ? '#ff9800' : '#f44336'} sublabel={`${cluster.osdsUp}/${cluster.osdsTotal}`} isDark={isDark} />
        <CircularGauge value={storagePct} label="Storage" color={getGaugeColor(storagePct)} sublabel={`${formatBytes(cluster.bytesUsed)} / ${formatBytes(cluster.bytesTotal)}`} isDark={isDark} />
      </Box>

      {/* OSD icons */}
      {cluster.osdsTotal > 0 && cluster.osdsTotal <= 100 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.4, justifyContent: 'center' }}>
          {Array.from({ length: cluster.osdsTotal }, (_, i) => {
            const isUp = i < cluster.osdsUp
            const isIn = i < (cluster.osdsIn || cluster.osdsUp)
            const color = !isUp ? '#ef4444' : !isIn ? '#ff9800' : '#4caf50'
            const status = !isUp ? 'Down' : !isIn ? 'Up / Out' : 'Up / In'
            return (
              <span key={i} title={`OSD.${i} - ${status}`}
                style={{ fontSize: 12, color, opacity: isUp && isIn ? 0.6 : 1, cursor: 'default', lineHeight: 1 }}>
                <i className="ri-hard-drive-3-fill" />
              </span>
            )
          })}
        </Box>
      )}

      </Box>

      {/* Sparklines pushed to bottom */}
      <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', gap: 0.75 }}>

      {/* Sparklines: Throughput */}
      <Box>
        <Typography sx={{ fontSize: 8, opacity: 0.65, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>
          Throughput
        </Typography>
        <Box sx={{ height: 36, width: '100%' }}>
          {hasPerfData ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={perfData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <RTooltip content={<ThroughputTooltip isDark={isDark} />} wrapperStyle={{ backgroundColor: 'transparent' }} cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="read" stroke="#4caf50" fill="#4caf50" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="write" stroke="#f97316" fill="#f97316" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.15 }}>
              <Typography sx={{ fontSize: 9 }}>...</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Sparklines: IOPS */}
      <Box>
        <Typography sx={{ fontSize: 8, opacity: 0.65, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>
          IOPS
        </Typography>
        <Box sx={{ height: 36, width: '100%' }}>
          {hasPerfData ? (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={perfData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <RTooltip content={<IopsTooltip isDark={isDark} />} wrapperStyle={{ backgroundColor: 'transparent', zIndex: 10 }} cursor={{ stroke: '#8b5cf6', strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="readIops" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="writeIops" stroke="#ec4899" fill="#ec4899" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.15 }}>
              <Typography sx={{ fontSize: 9 }}>...</Typography>
            </Box>
          )}
        </Box>
      </Box>

      {/* Footer: PGs + current IO */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.65 }}>
        <Typography sx={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>
          {cluster.pgsTotal || 0} PGs
        </Typography>
        {hasIO && (
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>
              <i className='ri-arrow-down-line' style={{ fontSize: 10, color: '#4caf50' }} />
              {formatBps(cluster.readBps)}
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>
              <i className='ri-arrow-up-line' style={{ fontSize: 10, color: '#f97316' }} />
              {formatBps(cluster.writeBps)}
            </span>
          </Box>
        )}
      </Box>

      </Box>
    </Box>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function CephStatusWidget({ data, loading }) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const [perfByCluster, setPerfByCluster] = useState({})

  const cephClusters = data?.cephClusters || []
  const cephGlobal = data?.ceph

  const clusters = cephClusters.length > 0
    ? cephClusters
    : (cephGlobal && cephGlobal.available ? [{ ...cephGlobal, connId: 'global', name: 'Ceph' }] : [])

  // Poll Ceph perf data from /ceph/status every 30s, accumulate history
  const clustersKey = clusters.map(c => c.connId).join(',')

  useEffect(() => {
    if (!clusters.length) return

    let cancelled = false
    const MAX_POINTS = 120
    const historyRef = {}

    // Seed with current values from dashboard data so sparklines show immediately
    for (const cluster of clusters) {
      if (cluster.readBps > 0 || cluster.writeBps > 0) {
        const now = Date.now()
        // Create a few seed points with slight time offsets so the chart renders
        historyRef[cluster.connId] = Array.from({ length: 5 }, (_, i) => ({
          t: now - (4 - i) * 10000,
          read: cluster.readBps || 0,
          write: cluster.writeBps || 0,
          readIops: 0,
          writeIops: 0,
        }))
      }
    }
    setPerfByCluster({ ...historyRef })

    const fetchAll = async () => {
      const results = await Promise.all(
        clusters.map(async (cluster) => {
          try {
            const res = await fetch(
              `/api/v1/connections/${encodeURIComponent(cluster.connId)}/ceph/status`,
              { cache: 'no-store' }
            )
            if (!res.ok) return null
            const json = await res.json()
            const pgmap = json?.data?.pgmap
            if (!pgmap) return null
            return {
              connId: cluster.connId,
              point: {
                t: Date.now(),
                read: pgmap.read_bytes_sec || 0,
                write: pgmap.write_bytes_sec || 0,
                readIops: pgmap.read_op_per_sec || 0,
                writeIops: pgmap.write_op_per_sec || 0,
              }
            }
          } catch { return null }
        })
      )

      if (cancelled) return

      const newMap = {}
      for (const r of results) {
        if (!r) continue
        const prev = historyRef[r.connId] || []
        const updated = [...prev, r.point].slice(-MAX_POINTS)
        historyRef[r.connId] = updated
        newMap[r.connId] = updated
      }
      setPerfByCluster({ ...newMap })
    }

    // First real fetch after 1s, then every 10s
    const firstTimeout = setTimeout(fetchAll, 1000)
    const interval = setInterval(fetchAll, 10000)

    return () => { cancelled = true; clearTimeout(firstTimeout); clearInterval(interval) }
  }, [clustersKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (clusters.length === 0) {
    return (
      <Box
        sx={{
          height: '100%',
          bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
          border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
          borderRadius: 2.5, p: 1.5,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.65,
        }}
      >
        <i className='ri-database-2-line' style={{ fontSize: 28, marginBottom: 4 }} />
        <Typography variant='caption'>{t('common.notAvailable')}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{
      height: '100%', overflow: 'auto',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
      gap: 1, p: 0.5,
    }}>
      {clusters.map((cluster, idx) => (
        <CephClusterCard
          key={cluster.connId || idx}
          cluster={cluster}
          isDark={isDark}
          perfData={perfByCluster[cluster.connId] || []}
        />
      ))}
    </Box>
  )
}

export default React.memo(CephStatusWidget)
