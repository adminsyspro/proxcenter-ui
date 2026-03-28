'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  Stack,
  Chip,
  alpha,
  useTheme,
  IconButton,
} from '@mui/material'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts'
import { formatBytes } from '@/utils/format'
import { buildSeriesFromRrd } from './helpers'

type PbsServer = {
  connId: string
  name: string
  status: string
  datastores: Array<{
    name: string
    path?: string
    comment?: string
    total: number
    used: number
    available: number
    usagePercent: number
    backupCount: number
  }>
  stats: { backupCount: number; totalSize?: number }
}

type Props = {
  pbsServers: PbsServer[]
  onPbsClick?: (sel: { type: 'pbs'; id: string }) => void
  onDatastoreClick?: (sel: { type: 'pbs-datastore' | 'datastore'; id: string }) => void
}

type RrdTimeframe = 'hour' | 'day' | 'week' | 'month' | 'year'

const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1']

const TF_OPTIONS: { label: string; value: RrdTimeframe }[] = [
  { label: '1h', value: 'hour' },
  { label: '24h', value: 'day' },
  { label: '7d', value: 'week' },
  { label: '30d', value: 'month' },
  { label: '1y', value: 'year' },
]

function KpiCard({ label, value }: { label: string; value: string | number }) {
  const theme = useTheme()
  return (
    <Card variant="outlined" sx={{ flex: 1, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="caption" sx={{ opacity: 0.6 }}>{label}</Typography>
        <Typography variant="h5" fontWeight={700}>{value}</Typography>
      </CardContent>
    </Card>
  )
}

function getUsageColor(pct: number): string {
  if (pct >= 90) return '#f44336'
  if (pct >= 70) return '#ff9800'
  return '#4caf50'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatNetworkValue(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} Gb/s`
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mb/s`
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} Kb/s`
  return `${bps.toFixed(0)} b/s`
}

async function fetchPbsRrd(connId: string, timeframe: RrdTimeframe, signal?: AbortSignal) {
  const url = `/api/v1/pbs/${encodeURIComponent(connId)}/rrd?timeframe=${encodeURIComponent(timeframe)}`
  const res = await fetch(url, { cache: 'no-store', signal })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error || `PBS RRD HTTP ${res.status}`)
  // Unwrap nested data
  let data = json
  while (data && typeof data === 'object' && 'data' in data) data = data.data
  return Array.isArray(data) ? data : []
}

// ── Graph component (reusable for all 4 metric types) ──
function MetricGraph({
  title,
  icon,
  iconColor,
  series,
  serverNames,
  serverColors,
  hiddenServers,
  onToggle,
  dataKeyPrefix,
  yDomain,
  yFormatter,
  tooltipFormatter,
  onExpand,
  height = 120,
}: {
  title: string
  icon: string
  iconColor: string
  series: any[]
  serverNames: string[]
  serverColors: Record<string, string>
  hiddenServers: Set<string>
  onToggle: (name: string) => void
  dataKeyPrefix: string
  yDomain?: [number, number]
  yFormatter: (v: number) => string
  tooltipFormatter: (v: number) => string
  onExpand?: () => void
  height?: number
}) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" fontWeight={600}>{title}</Typography>
        {onExpand && (
          <IconButton size="small" onClick={onExpand} sx={{ opacity: 0.4, p: 0.25, '&:hover': { opacity: 1 } }}>
            <i className="ri-expand-diagonal-line" style={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Box>
      <Box sx={{ height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={series}>
            <defs>
              {serverNames.map(name => (
                <linearGradient key={`g_${dataKeyPrefix}_${name}`} id={`pbsGrad_${dataKeyPrefix}_${name}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={serverColors[name]} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={serverColors[name]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
            <YAxis domain={yDomain || ['auto', 'auto']} tickFormatter={v => yFormatter(Number(v))} tick={{ fontSize: 9 }} width={30} />
            <RechartsTooltip
              wrapperStyle={{ zIndex: 10 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                return (
                  <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                    <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha(iconColor, 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className={icon} style={{ fontSize: 13, color: iconColor }} />
                      <Typography variant="caption" sx={{ fontWeight: 700, color: iconColor }}>{title}</Typography>
                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                    </Box>
                    <Box sx={{ px: 1.5, py: 0.75 }}>
                      {sorted.map(entry => (
                        <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                          <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replaceAll(`${dataKeyPrefix}_`, '')}</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>
                            {tooltipFormatter(Number(entry.value))}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )
              }}
            />
            {serverNames.map(name => (
              <Area
                key={name}
                type="monotone"
                dataKey={`${dataKeyPrefix}_${name}`}
                hide={hiddenServers.has(name)}
                name={`${dataKeyPrefix}_${name}`}
                stroke={serverColors[name]}
                fill={`url(#pbsGrad_${dataKeyPrefix}_${name})`}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Box>
      {serverNames.length > 1 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {serverNames.map(name => (
            <Box
              key={name}
              onClick={() => onToggle(name)}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: hiddenServers.has(name) ? 0.3 : 1, '&:hover': { opacity: hiddenServers.has(name) ? 0.5 : 0.8 } }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: serverColors[name] }} />
              <Typography variant="caption" sx={{ fontSize: 9, textDecoration: hiddenServers.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// ── Network graph (dual: in + out) ──
function NetworkGraph({
  series,
  serverNames,
  serverColors,
  hiddenServers,
  onToggle,
  onExpand,
  height = 120,
}: {
  series: any[]
  serverNames: string[]
  serverColors: Record<string, string>
  hiddenServers: Set<string>
  onToggle: (name: string) => void
  onExpand?: () => void
  height?: number
}) {
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="caption" fontWeight={600}>Network Traffic</Typography>
        {onExpand && (
          <IconButton size="small" onClick={onExpand} sx={{ opacity: 0.4, p: 0.25, '&:hover': { opacity: 1 } }}>
            <i className="ri-expand-diagonal-line" style={{ fontSize: 14 }} />
          </IconButton>
        )}
      </Box>
      <Box sx={{ height }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart data={series}>
            <defs>
              {serverNames.map(name => (
                <linearGradient key={`gNetIn_${name}`} id={`pbsGradNetIn_${name}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={serverColors[name]} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={serverColors[name]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
            <YAxis tickFormatter={v => formatNetworkValue(Number(v))} tick={{ fontSize: 9 }} width={50} />
            <RechartsTooltip
              wrapperStyle={{ zIndex: 10 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                    <Box sx={{ px: 1.5, py: 0.75, bgcolor: alpha('#06b6d4', 0.1), borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <i className="ri-exchange-line" style={{ fontSize: 13, color: '#06b6d4' }} />
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#06b6d4' }}>Network Traffic</Typography>
                      <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                    </Box>
                    <Box sx={{ px: 1.5, py: 0.75 }}>
                      {payload.map(entry => {
                        const name = String(entry.dataKey)
                        const isIn = name.startsWith('netIn_')
                        const serverName = name.replace(/^net(In|Out)_/, '')
                        return (
                          <Box key={String(entry.dataKey)} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                            <Typography variant="caption" sx={{ flex: 1 }}>{serverName} {isIn ? 'IN' : 'OUT'}</Typography>
                            <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>
                              {formatNetworkValue(Number(entry.value))}
                            </Typography>
                          </Box>
                        )
                      })}
                    </Box>
                  </Box>
                )
              }}
            />
            {serverNames.map(name => (
              <Area key={`in_${name}`} type="monotone" dataKey={`netIn_${name}`} hide={hiddenServers.has(name)} name={`netIn_${name}`} stroke={serverColors[name]} fill={`url(#pbsGradNetIn_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
            ))}
            {serverNames.map(name => (
              <Area key={`out_${name}`} type="monotone" dataKey={`netOut_${name}`} hide={hiddenServers.has(name)} name={`netOut_${name}`} stroke={serverColors[name]} fill="none" strokeWidth={1} strokeDasharray="4 2" dot={false} isAnimationActive={false} connectNulls />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </Box>
      {serverNames.length > 1 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {serverNames.map(name => (
            <Box
              key={name}
              onClick={() => onToggle(name)}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: hiddenServers.has(name) ? 0.3 : 1, '&:hover': { opacity: hiddenServers.has(name) ? 0.5 : 0.8 } }}
            >
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: serverColors[name] }} />
              <Typography variant="caption" sx={{ fontSize: 9, textDecoration: hiddenServers.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// ════════════════════════════════════════════════════════════════════
// Main component
// ════════════════════════════════════════════════════════════════════
export default function BackupDashboard({ pbsServers, onPbsClick, onDatastoreClick }: Props) {
  const theme = useTheme()

  // ── RRD state ──
  const [rrdTf, setRrdTf] = useState<RrdTimeframe>('hour')
  const [rrdSeries, setRrdSeries] = useState<any[]>([])
  const [rrdServerNames, setRrdServerNames] = useState<string[]>([])
  const [rrdHidden, setRrdHidden] = useState<Set<string>>(new Set())
  const [expandedGraph, setExpandedGraph] = useState<string | null>(null)

  const serverColors = useMemo(() => {
    const map: Record<string, string> = {}
    rrdServerNames.forEach((name, i) => { map[name] = PALETTE[i % PALETTE.length] })
    return map
  }, [rrdServerNames])

  const toggleServer = useCallback((name: string) => {
    setRrdHidden(prev => {
      const allOthersHidden = rrdServerNames.every(n => n === name || prev.has(n))
      if (allOthersHidden) return new Set()
      return new Set(rrdServerNames.filter(n => n !== name))
    })
  }, [rrdServerNames])

  // Stable key for PBS server list
  const pbsRef = useRef(pbsServers)
  pbsRef.current = pbsServers
  const pbsKey = useMemo(() =>
    pbsServers.filter(s => s.status === 'online').map(s => s.connId).sort().join(','),
    [pbsServers]
  )

  // Fetch and merge RRD data from all online PBS servers
  useEffect(() => {
    const servers = pbsRef.current.filter(s => s.status === 'online')
    if (servers.length === 0) {
      setRrdSeries([])
      setRrdServerNames([])
      return
    }

    const ac = new AbortController()

    ;(async () => {
      const perServer: Record<string, any[]> = {}

      await Promise.allSettled(servers.map(async (s) => {
        try {
          const raw = await fetchPbsRrd(s.connId, rrdTf, ac.signal)
          if (!ac.signal.aborted) {
            perServer[s.name] = buildSeriesFromRrd(raw)
          }
        } catch (e) {
          if (!ac.signal.aborted) console.warn(`[pbs-rrd] Failed for ${s.name}:`, e)
        }
      }))

      if (ac.signal.aborted) return

      const names = Object.keys(perServer).sort()
      setRrdServerNames(names)

      // Merge into unified time series
      const resolutionMs: Record<string, number> = {
        hour: 60_000, day: 1_800_000, week: 10_800_000, month: 43_200_000, year: 604_800_000,
      }
      const snapRes = resolutionMs[rrdTf] || 60_000

      const timeMap = new Map<number, Record<string, number>>()
      for (const [serverName, series] of Object.entries(perServer)) {
        for (const point of series) {
          if (!point.t) continue
          const snapped = Math.round(point.t / snapRes) * snapRes
          if (!timeMap.has(snapped)) timeMap.set(snapped, { t: snapped })
          const entry = timeMap.get(snapped)!
          if (point.cpuPct != null) entry[`cpu_${serverName}`] = point.cpuPct
          if (point.ramPct != null) entry[`ram_${serverName}`] = point.ramPct
          if (point.netInBps != null) entry[`netIn_${serverName}`] = point.netInBps
          if (point.netOutBps != null) entry[`netOut_${serverName}`] = point.netOutBps
          if (point.loadAvg != null) entry[`load_${serverName}`] = point.loadAvg
        }
      }

      const merged = Array.from(timeMap.values()).sort((a, b) => a.t - b.t)

      // Forward-fill + backward-fill
      const keys = names.flatMap(name => ['cpu_', 'ram_', 'netIn_', 'netOut_', 'load_'].map(p => `${p}${name}`))
      const lastKnown: Record<string, number> = {}
      for (const slot of merged) {
        for (const key of keys) {
          if (slot[key] != null) lastKnown[key] = slot[key]
          else if (lastKnown[key] != null) slot[key] = lastKnown[key]
        }
      }
      const firstKnown: Record<string, number> = {}
      for (let i = merged.length - 1; i >= 0; i--) {
        for (const key of keys) {
          if (merged[i][key] != null) firstKnown[key] = merged[i][key]
          else if (firstKnown[key] != null) merged[i][key] = firstKnown[key]
        }
      }

      setRrdSeries(merged)
    })()

    return () => { ac.abort() }
  }, [pbsKey, rrdTf])

  if (pbsServers.length === 0) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, py: 8, color: 'text.secondary' }}>
        <i className="ri-information-line" style={{ fontSize: 40 }} />
        <Typography variant="body1">No backup servers configured</Typography>
      </Box>
    )
  }

  // KPIs
  const totalServers = pbsServers.length
  const totalBackups = pbsServers.reduce((sum, s) => sum + s.stats.backupCount, 0)
  const totalSize = pbsServers.reduce((sum, s) => sum + (s.stats.totalSize ?? 0), 0)
  const allDatastores = pbsServers.flatMap(s => s.datastores)
  const avgUsage = allDatastores.length > 0
    ? Math.round(allDatastores.reduce((sum, d) => sum + d.usagePercent, 0) / allDatastores.length)
    : 0

  return (
    <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 36, height: 36, borderRadius: 1.5, bgcolor: alpha(theme.palette.primary.main, 0.12), color: 'primary.main' }}>
          <i className="ri-hard-drive-2-fill" style={{ fontSize: 20 }} />
        </Box>
        <Typography variant="h6" fontWeight={700}>Backup Overview</Typography>
      </Stack>

      {/* KPI Row */}
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
        <KpiCard label="PBS Servers" value={totalServers} />
        <KpiCard label="Total Backups" value={totalBackups} />
        <KpiCard label="Total Size" value={totalSize > 0 ? formatBytes(totalSize) : '\u2014'} />
        <KpiCard label="Avg Usage" value={`${avgUsage}%`} />
      </Stack>

      {/* ── Aggregated RRD Graphs ── */}
      {rrdSeries.length > 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography fontWeight={600} fontSize={13}>Performances</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {TF_OPTIONS.map(opt => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  size="small"
                  onClick={() => setRrdTf(opt.value)}
                  sx={{
                    height: 24, fontSize: 11, fontWeight: 600,
                    bgcolor: rrdTf === opt.value ? 'primary.main' : 'action.hover',
                    color: rrdTf === opt.value ? 'primary.contrastText' : 'text.secondary',
                    '&:hover': { bgcolor: rrdTf === opt.value ? 'primary.dark' : 'action.selected' },
                    cursor: 'pointer',
                  }}
                />
              ))}
            </Box>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            <MetricGraph
              title="CPU Usage"
              icon="ri-cpu-line"
              iconColor="#2196f3"
              series={rrdSeries}
              serverNames={rrdServerNames}
              serverColors={serverColors}
              hiddenServers={rrdHidden}
              onToggle={toggleServer}
              dataKeyPrefix="cpu"
              yDomain={[0, 100]}
              yFormatter={v => `${v}%`}
              tooltipFormatter={v => `${v.toFixed(1)}%`}
              onExpand={() => setExpandedGraph(expandedGraph === 'cpu' ? null : 'cpu')}
              height={expandedGraph === 'cpu' ? 300 : 120}
            />
            <MetricGraph
              title="Server Load"
              icon="ri-bar-chart-line"
              iconColor="#f59e0b"
              series={rrdSeries}
              serverNames={rrdServerNames}
              serverColors={serverColors}
              hiddenServers={rrdHidden}
              onToggle={toggleServer}
              dataKeyPrefix="load"
              yFormatter={v => v.toFixed(1)}
              tooltipFormatter={v => v.toFixed(2)}
              onExpand={() => setExpandedGraph(expandedGraph === 'load' ? null : 'load')}
              height={expandedGraph === 'load' ? 300 : 120}
            />
            <MetricGraph
              title="Memory Usage"
              icon="ri-ram-line"
              iconColor="#10b981"
              series={rrdSeries}
              serverNames={rrdServerNames}
              serverColors={serverColors}
              hiddenServers={rrdHidden}
              onToggle={toggleServer}
              dataKeyPrefix="ram"
              yDomain={[0, 100]}
              yFormatter={v => `${v}%`}
              tooltipFormatter={v => `${v.toFixed(1)}%`}
              onExpand={() => setExpandedGraph(expandedGraph === 'ram' ? null : 'ram')}
              height={expandedGraph === 'ram' ? 300 : 120}
            />
            <NetworkGraph
              series={rrdSeries}
              serverNames={rrdServerNames}
              serverColors={serverColors}
              hiddenServers={rrdHidden}
              onToggle={toggleServer}
              onExpand={() => setExpandedGraph(expandedGraph === 'net' ? null : 'net')}
              height={expandedGraph === 'net' ? 300 : 120}
            />
          </Box>
        </Box>
      )}

      {/* PBS Server Cards with inline datastores */}
      <Box>
        <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1.5, opacity: 0.7 }}>PBS Servers</Typography>
        <Stack spacing={1.5}>
          {pbsServers.map(server => {
            const isOnline = server.status === 'online'
            return (
              <Card key={server.connId} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <CardContent
                  onClick={() => onPbsClick?.({ type: 'pbs', id: server.connId })}
                  sx={{
                    py: 1.5, px: 2, cursor: onPbsClick ? 'pointer' : 'default',
                    transition: 'background 0.15s',
                    '&:hover': onPbsClick ? { bgcolor: alpha(theme.palette.primary.main, 0.04) } : {},
                    '&:last-child': { pb: server.datastores.length > 0 ? 1.5 : 1.5 },
                  }}
                >
                  <Stack direction="row" alignItems="center" spacing={1.5}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: isOnline ? '#4caf50' : 'text.disabled', flexShrink: 0, boxShadow: isOnline ? '0 0 6px #4caf5099' : 'none' }} />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{server.name}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.55 }}>
                        {server.datastores.length} datastore{server.datastores.length !== 1 ? 's' : ''}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip
                        label={isOnline ? 'Online' : server.status}
                        size="small"
                        sx={{
                          height: 20, fontSize: 11,
                          bgcolor: isOnline ? alpha('#4caf50', 0.12) : alpha(theme.palette.text.secondary, 0.1),
                          color: isOnline ? '#4caf50' : 'text.secondary', fontWeight: 600,
                        }}
                      />
                      <Typography variant="body2" fontWeight={700}>{server.stats.backupCount}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.5 }}>backups</Typography>
                    </Stack>
                  </Stack>
                </CardContent>
                {server.datastores.length > 0 && (
                  <Stack spacing={0} sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                    {server.datastores.map((ds, i) => {
                      const pct = Math.min(Math.max(ds.usagePercent, 0), 100)
                      const color = getUsageColor(pct)
                      const dsId = `${server.connId}:${ds.name}`
                      return (
                        <Box
                          key={ds.name}
                          onClick={(e) => { e.stopPropagation(); onDatastoreClick?.({ type: 'pbs-datastore', id: dsId }) }}
                          sx={{
                            px: 2, py: 1,
                            cursor: onDatastoreClick ? 'pointer' : 'default',
                            transition: 'background 0.15s',
                            '&:hover': onDatastoreClick ? { bgcolor: alpha(theme.palette.primary.main, 0.04) } : {},
                            borderBottom: i < server.datastores.length - 1 ? '1px solid' : 'none',
                            borderColor: 'divider',
                          }}
                        >
                          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                            <Stack direction="row" alignItems="center" spacing={0.75}>
                              <i className="ri-database-2-line" style={{ fontSize: 13, opacity: 0.5 }} />
                              <Typography variant="body2" fontWeight={500} fontSize={12}>{ds.name}</Typography>
                            </Stack>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="caption" sx={{ opacity: 0.6 }}>{formatBytes(ds.used)} / {formatBytes(ds.total)}</Typography>
                              <Typography variant="caption" fontWeight={700} sx={{ color, minWidth: 36, textAlign: 'right' }}>{pct.toFixed(1)}%</Typography>
                            </Stack>
                          </Stack>
                          <LinearProgress
                            variant="determinate"
                            value={pct}
                            sx={{ height: 4, borderRadius: 2, bgcolor: alpha(color, 0.15), '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 2 } }}
                          />
                        </Box>
                      )
                    })}
                  </Stack>
                )}
              </Card>
            )
          })}
        </Stack>
      </Box>
    </Box>
  )
}
