'use client'

import React, { useEffect, useState, useMemo } from 'react'

import { useTranslations } from 'next-intl'
import { Box, CircularProgress, Typography, useTheme } from '@mui/material'
import { AreaChart, Area, Tooltip as RTooltip } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

import { widgetColors } from './themeColors'
import { useLicense } from '@/contexts/LicenseContext'
import { useDRSStatus, useDRSMetrics, useDRSRecommendations, useDRSAllMigrations } from '@/hooks/useDRS'
import { computeDrsHealthScore } from '@/lib/utils/drs-health'
import { mapTimeRange, formatTime } from './timeRangeUtils'

// ─── Sparkline Tooltip ────────────────────────────────────────────────────────

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

// ─── Score Ring (animated) ───────────────────────────────────────────────────
function ScoreRing({ score, size = 56, strokeWidth = 5, isDark = true }) {
  const c = widgetColors(isDark)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const [mounted, setMounted] = useState(false)
  const offset = mounted ? circumference - (score / 100) * circumference : circumference
  const color = score >= 80 ? '#4caf50' : score >= 50 ? '#ff9800' : '#f44336'

  useEffect(() => { const t = setTimeout(() => setMounted(true), 50);

 

return () => clearTimeout(t) }, [])

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={c.surfaceSubtle} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 14, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color, lineHeight: 1 }}>
          {score}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Imbalance Gauge (small) ─────────────────────────────────────────────────
function ImbalanceGauge({ value, size = 40, strokeWidth = 4, isDark = true }) {
  const c = widgetColors(isDark)
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const [mounted, setMounted] = useState(false)
  const clamped = Math.min(value, 50)
  const offset = mounted ? circumference - (clamped / 50) * circumference : circumference
  const color = value > 20 ? '#f44336' : value > 10 ? '#ff9800' : '#4caf50'

  useEffect(() => { const t = setTimeout(() => setMounted(true), 50);

 

return () => clearTimeout(t) }, [])

  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={c.surfaceSubtle} strokeWidth={strokeWidth} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }} />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ fontSize: 9, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace', color }}>{value}%</Typography>
      </Box>
    </Box>
  )
}

function getGaugeColor(value) {
  if (value >= 90) return '#f44336'
  if (value >= 75) return '#ff9800'
  
return '#4caf50'
}

function getScoreColor(score) {
  if (score >= 80) return '#4caf50'
  if (score >= 50) return '#ff9800'
  
return '#f44336'
}

function timeAgo(ts) {
  if (!ts) return ''
  const now = Date.now()
  const past = typeof ts === 'string' ? new Date(ts).getTime() : ts * 1000
  const diff = Math.floor((now - past) / 1000)

  if (diff < 60) return 'now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  
return `${Math.floor(diff / 86400)}d`
}

// ─── DRS Cluster Card ────────────────────────────────────────────────────────
function DrsClusterCard({ clusterId, clusterMetrics, clusterInfo, drsStatus, theme, recommendations, migrations, trends }) {
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const summary = clusterMetrics?.summary || {}
  const nodes = clusterMetrics?.nodes || []
  const onlineNodes = nodes.filter(n => !n.status || n.status === 'online')

  const breakdown = computeDrsHealthScore(summary, nodes)
  const score = breakdown.score
  const imbalance = Math.round(summary.imbalance || 0)

  const enabled = drsStatus?.enabled ?? false
  const mode = drsStatus?.mode || 'manual'
  const clusterName = clusterInfo?.name || clusterId

  // Filter recommendations and migrations for this cluster
  const clusterRecs = (recommendations || []).filter(r => r.connection_id === clusterId || r.cluster_id === clusterId)
  const clusterMigrations = (migrations || []).filter(m => m.connection_id === clusterId || m.cluster_id === clusterId).slice(0, 3)

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
        borderRadius: 2.5, p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75,
        transition: 'box-shadow 0.2s ease, border-color 0.2s ease',
        '&:hover': { borderColor: c.surfaceActive, boxShadow: isDark ? '0 2px 8px rgba(0,0,0,0.3)' : '0 2px 8px rgba(0,0,0,0.08)' },
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <i className='ri-swap-line' style={{ fontSize: 14, opacity: 0.7 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {clusterName}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: enabled ? (mode === 'automatic' ? '#4caf50' : '#ff9800') : '#9e9e9e' }} />
          <Typography sx={{ fontSize: 9, opacity: 0.7, fontFamily: '"JetBrains Mono", monospace' }}>
            {enabled ? mode : 'off'}
          </Typography>
        </Box>
      </Box>

      {/* DRS label + Score + Imbalance gauges */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, mt: 0.5 }}>
        <Typography sx={{ fontSize: 20, fontWeight: 900, opacity: 0.15, letterSpacing: 2, textTransform: 'uppercase', flexShrink: 0 }}>
          DRS
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
          <ScoreRing score={score} isDark={isDark} />
          <Typography sx={{ fontSize: 8, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase' }}>Health</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.25 }}>
          <ImbalanceGauge value={imbalance} isDark={isDark} />
          <Typography sx={{ fontSize: 8, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase' }}>Imbalance</Typography>
        </Box>
      </Box>

      {/* Per-node bars with color thresholds */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
        {onlineNodes.map((node, idx) => {
          const nodeCpu = Math.round(node.cpu_usage || 0)
          const nodeRam = Math.round(node.memory_usage || 0)

          
return (
            <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Typography sx={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace', width: 55, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.7 }}>
                {node.name || `n-${idx}`}
              </Typography>
              <Box sx={{ flex: 1, display: 'flex', gap: 0.5 }}>
                <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: c.surfaceSubtle, overflow: 'hidden' }}>
                  <Box sx={{ width: `${nodeCpu}%`, height: '100%', borderRadius: 3, bgcolor: getGaugeColor(nodeCpu), transition: 'width 0.6s ease' }} />
                </Box>
                <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: c.surfaceSubtle, overflow: 'hidden' }}>
                  <Box sx={{ width: `${nodeRam}%`, height: '100%', borderRadius: 3, bgcolor: getGaugeColor(nodeRam), transition: 'width 0.6s ease' }} />
                </Box>
              </Box>
              <Typography sx={{ fontSize: 8, fontFamily: '"JetBrains Mono", monospace', opacity: 0.65, width: 48, textAlign: 'right' }}>
                {nodeCpu}% {nodeRam}%
              </Typography>
            </Box>
          )
        })}
      </Box>

      {/* Recommendations */}
      {clusterRecs.length > 0 && (
        <Box sx={{ borderTop: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', pt: 0.5 }}>
          <Typography sx={{ fontSize: 8, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>
            <i className='ri-lightbulb-line' style={{ fontSize: 9, marginRight: 3 }} />
            Recommendations ({clusterRecs.length})
          </Typography>
          {clusterRecs.slice(0, 3).map((rec, idx) => (
            <Box key={idx} title={`${rec.vm_name || rec.vmid} -> ${rec.target_node}: ${rec.reason || ''}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25 }}>
              <i className='ri-arrow-right-line' style={{ fontSize: 9, color: '#ff9800', flexShrink: 0 }} />
              <Typography sx={{ fontSize: 9, fontWeight: 600, flexShrink: 0, maxWidth: 80 }} noWrap>
                {rec.vm_name || `VM ${rec.vmid}`}
              </Typography>
              <i className='ri-arrow-right-s-line' style={{ fontSize: 10, opacity: 0.4, flexShrink: 0 }} />
              <Typography sx={{ fontSize: 9, opacity: 0.7, fontFamily: '"JetBrains Mono", monospace', flexShrink: 0 }}>
                {rec.target_node}
              </Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Recent migrations */}
      {clusterMigrations.length > 0 && (
        <Box sx={{ borderTop: '1px solid', borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', pt: 0.5 }}>
          <Typography sx={{ fontSize: 8, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>
            <i className='ri-history-line' style={{ fontSize: 9, marginRight: 3 }} />{' '}
            Migrations
          </Typography>
          {clusterMigrations.map((mig, idx) => {
            const statusColor = mig.status === 'completed' ? '#4caf50' : mig.status === 'running' ? '#3b82f6' : mig.status === 'failed' ? '#f44336' : '#9e9e9e'

            
return (
              <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25 }}>
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: statusColor, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 9, fontWeight: 600, flexShrink: 0, maxWidth: 80 }} noWrap>
                  {mig.vm_name || `VM ${mig.vmid}`}
                </Typography>
                <i className='ri-arrow-right-s-line' style={{ fontSize: 10, opacity: 0.4, flexShrink: 0 }} />
                <Typography sx={{ fontSize: 9, opacity: 0.7, fontFamily: '"JetBrains Mono", monospace', flexShrink: 0 }}>
                  {mig.target_node}
                </Typography>
                <Typography sx={{ fontSize: 8, opacity: 0.5, fontFamily: '"JetBrains Mono", monospace', ml: 'auto', flexShrink: 0 }}>
                  {timeAgo(mig.created_at || mig.started_at)}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}

      {/* Sparkline CPU/RAM */}
      {trends && trends.length > 2 && (
        <Box>
          <Typography sx={{ fontSize: 8, opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', mb: 0.25 }}>CPU / RAM</Typography>
          <Box sx={{ height: 36, width: '100%' }}>
            <ChartContainer>
              <AreaChart data={trends} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <RTooltip content={<CpuRamTooltip isDark={isDark} />} wrapperStyle={{ backgroundColor: 'transparent', zIndex: 10 }} cursor={{ stroke: '#f97316', strokeWidth: 1, strokeDasharray: '3 3' }} />
                <Area type="monotone" dataKey="cpu" stroke="#f97316" fill="#f97316" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Area type="monotone" dataKey="ram" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} strokeWidth={1.2} dot={false} isAnimationActive={false} />
              </AreaChart>
            </ChartContainer>
          </Box>
        </Box>
      )}

      {/* Footer */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: 0.65, mt: 'auto' }}>
        <Typography sx={{ fontSize: 9, fontFamily: '"JetBrains Mono", monospace' }}>
          {onlineNodes.length} node{onlineNodes.length !== 1 ? 's' : ''}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <Box sx={{ width: 5, height: 5, borderRadius: 0.5, bgcolor: '#f97316' }} />
          <Typography sx={{ fontSize: 8 }}>CPU</Typography>
          <Box sx={{ width: 5, height: 5, borderRadius: 0.5, bgcolor: '#3b82f6' }} />
          <Typography sx={{ fontSize: 8 }}>RAM</Typography>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function DrsStatusWidget({ data, loading, config, timeRange }) {
  const t = useTranslations()
  const theme = useTheme()
  const { isEnterprise } = useLicense()
  const { data: status, isLoading: statusLoading } = useDRSStatus(isEnterprise)
  const { data: metricsData, isLoading: metricsLoading } = useDRSMetrics(isEnterprise)
  const { data: recommendations } = useDRSRecommendations(isEnterprise)
  const { data: allMigrations } = useDRSAllMigrations(isEnterprise)
  const [trendsByCluster, setTrendsByCluster] = useState({})

  const clusterMap = useMemo(() => {
    const map = {}

    for (const c of (data?.clusters || [])) { map[c.id] = c }
    
return map
  }, [data?.clusters])

  // Fetch CPU/RAM trends per cluster
  const clusterIdsKey = metricsData ? Object.keys(metricsData).join(',') : ''

  useEffect(() => {
    if (!metricsData || !data?.nodes) return
    const controller = new AbortController()
    let cancelled = false

    const clusterIds = Object.keys(metricsData)

    Promise.all(
      clusterIds.map(async (connId) => {
        const clusterNodes = metricsData[connId]?.nodes || []
        const nodeNames = clusterNodes.filter(n => !n.status || n.status === 'online').map(n => n.name).filter(Boolean)

        if (nodeNames.length === 0) return null

        try {
          const res = await fetch(`/api/v1/connections/${connId}/nodes/trends`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: nodeNames.map(n => ({ node: n })), timeframe: mapTimeRange(timeRange).trendsTimeframe }),
            signal: controller.signal,
          })

          if (!res.ok) return null
          const json = await res.json()
          const nodeData = json.data || {}

          // Average all nodes per timestamp
          const timeMap = new Map()

          Object.values(nodeData).forEach(points => {
            if (!Array.isArray(points)) return
            points.forEach(p => {
              const key = p.ts || p.t

              if (!timeMap.has(key)) timeMap.set(key, { t: p.t, cpuSum: 0, ramSum: 0, count: 0 })
              const entry = timeMap.get(key)

              entry.cpuSum += p.cpu || 0
              entry.ramSum += p.ram || 0
              entry.count++
            })
          })

          const series = Array.from(timeMap.values())
            .map(e => ({ t: e.t, cpu: Math.round(e.cpuSum / e.count), ram: Math.round(e.ramSum / e.count) }))
            .sort((a, b) => (a.t > b.t ? 1 : -1))

          
return { connId, series }
        } catch { return null }
      })
    ).then(results => {
      if (cancelled) return
      const map = {}

      for (const r of results) { if (r && r.series.length > 0) map[r.connId] = r.series }
      setTrendsByCluster(map)
    })

    return () => { cancelled = true; controller.abort() }
  }, [clusterIdsKey, timeRange]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isEnterprise) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: 32, color: 'var(--mui-palette-warning-main)', marginBottom: 8 }} />
        <Typography variant='caption' sx={{ opacity: 0.75 }}>Enterprise</Typography>
      </Box>
    )
  }

  if (statusLoading || metricsLoading) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  const clusterIds = metricsData
    ? Object.keys(metricsData).filter(id => {
        const info = clusterMap[id]

        
return !info || info.isCluster || info.nodes > 1
      })
    : []

  if (clusterIds.length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.65 }}>
        <i className='ri-swap-line' style={{ fontSize: 28, marginBottom: 4 }} />
        <Typography variant='caption'>{t('common.noData')}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{
      height: '100%', overflow: 'auto',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 1, p: 0.5,
    }}>
      {clusterIds.map((clusterId) => (
        <DrsClusterCard
          key={clusterId}
          clusterId={clusterId}
          clusterMetrics={metricsData[clusterId]}
          clusterInfo={clusterMap[clusterId]}
          drsStatus={status}
          theme={theme}
          recommendations={recommendations}
          migrations={allMigrations}
          trends={trendsByCluster[clusterId] || []}
        />
      ))}
    </Box>
  )
}

export default React.memo(DrsStatusWidget)
