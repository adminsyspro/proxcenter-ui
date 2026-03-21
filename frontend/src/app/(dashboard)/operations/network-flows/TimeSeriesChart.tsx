'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'

import { formatBytes } from '@/utils/format'

interface TopTalker {
  vmid: number
  vm_name: string
  bytes_in: number
  bytes_out: number
}

interface TimeSeriesPoint {
  time: number
  bytes_in: number
  bytes_out: number
  packets: number
}

interface VMTimeSeries {
  vmid: number
  vm_name: string
  points: TimeSeriesPoint[]
}

async function fetchSFlow(endpoint: string, params?: Record<string, string>) {
  const query = new URLSearchParams({ endpoint, ...params })
  const res = await fetch(`/api/v1/orchestrator/sflow?${query}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

const timeRanges = [
  { label: '5m', value: 5 },
  { label: '15m', value: 15 },
  { label: '1h', value: 60 },
  { label: '6h', value: 360 },
  { label: '24h', value: 1440 },
  { label: '7d', value: 10080 },
]

const COMPARE_SHIFT_MS = 24 * 60 * 60 * 1000 // 24 hours in ms

// Colors for multi-VM chart
const VM_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
]

export default function TimeSeriesChart() {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'

  const [vms, setVMs] = useState<TopTalker[]>([])
  const [selectedVMs, setSelectedVMs] = useState<TopTalker[]>([])
  const [destFilter, setDestFilter] = useState('')
  const [timeRange, setTimeRange] = useState(60)

  // Single VM data
  const [singleData, setSingleData] = useState<TimeSeriesPoint[]>([])
  // Multi VM data
  const [multiData, setMultiData] = useState<VMTimeSeries[]>([])

  // Comparison mode
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [compareSingleData, setCompareSingleData] = useState<TimeSeriesPoint[]>([])
  const [compareMultiData, setCompareMultiData] = useState<VMTimeSeries[]>([])

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isMultiVM = selectedVMs.length > 1

  // Load available VMs and pre-select the top one
  useEffect(() => {
    fetchSFlow('top-talkers', { n: '50' }).then(d => {
      if (Array.isArray(d) && d.length > 0) {
        setVMs(d)
        if (selectedVMs.length === 0) {
          setSelectedVMs([d[0]])
        }
      }
    }).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Load time series data
  const loadTimeSeries = useCallback(async () => {
    if (selectedVMs.length === 0) return

    setLoading(true)
    setError(null)

    try {
      const now = new Date()
      const from = new Date(now.getTime() - timeRange * 60 * 1000)
      const params: Record<string, string> = {
        from: from.toISOString(),
        to: now.toISOString(),
      }

      // Comparison period: same duration but 24h earlier
      const compareFrom = new Date(from.getTime() - COMPARE_SHIFT_MS)
      const compareTo = new Date(now.getTime() - COMPARE_SHIFT_MS)
      const compareParams: Record<string, string> = {
        from: compareFrom.toISOString(),
        to: compareTo.toISOString(),
      }

      if (selectedVMs.length === 1 && !destFilter) {
        // Single VM mode
        const data = await fetchSFlow('timeseries/vm', { ...params, vmid: String(selectedVMs[0].vmid) })
        setSingleData(Array.isArray(data) ? data : [])
        setMultiData([])

        // Fetch comparison data if enabled
        if (compareEnabled) {
          try {
            const cmpData = await fetchSFlow('timeseries/vm', { ...compareParams, vmid: String(selectedVMs[0].vmid) })
            setCompareSingleData(Array.isArray(cmpData) ? cmpData : [])
          } catch { setCompareSingleData([]) }
        } else {
          setCompareSingleData([])
        }
        setCompareMultiData([])
      } else {
        // Multi VM mode or filtered
        const vmids = selectedVMs.map(v => v.vmid).join(',')
        const data = await fetchSFlow('timeseries/all-vms', { ...params, vmids })
        setMultiData(Array.isArray(data) ? data : [])
        setSingleData([])

        // Fetch comparison data if enabled
        if (compareEnabled) {
          try {
            const cmpData = await fetchSFlow('timeseries/all-vms', { ...compareParams, vmids })
            setCompareMultiData(Array.isArray(cmpData) ? cmpData : [])
          } catch { setCompareMultiData([]) }
        } else {
          setCompareMultiData([])
        }
        setCompareSingleData([])
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedVMs, timeRange, destFilter, compareEnabled])

  useEffect(() => {
    loadTimeSeries()
    if (selectedVMs.length > 0) {
      const interval = setInterval(loadTimeSeries, 30000)
      return () => clearInterval(interval)
    }
  }, [loadTimeSeries, selectedVMs])

  const formatTime = (ts: number) => {
    const d = new Date(ts * 1000)
    if (timeRange <= 60) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (timeRange <= 1440) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  // Build merged chart data for multi-VM
  const mergedMultiData = useMemo(() => {
    if (multiData.length === 0) return []

    // Collect all timestamps
    const timeMap = new Map<number, Record<string, number>>()
    for (const vm of multiData) {
      for (const p of vm.points) {
        if (!timeMap.has(p.time)) timeMap.set(p.time, { time: p.time })
        const entry = timeMap.get(p.time)!
        entry[`vm_${vm.vmid}_total`] = (p.bytes_in || 0) + (p.bytes_out || 0)
      }
    }

    return Array.from(timeMap.values()).sort((a, b) => a.time - b.time)
  }, [multiData])

  // Compute bandwidth (bytes/s) from consecutive volume points — single VM
  const singleBandwidthData = useMemo(() => {
    if (singleData.length < 2) return []
    return singleData.slice(1).map((p, i) => {
      const prev = singleData[i]
      const dt = p.time - prev.time
      if (dt <= 0) return null
      return {
        time: p.time,
        bps_in: (p.bytes_in || 0) / dt,
        bps_out: (p.bytes_out || 0) / dt,
      }
    }).filter(Boolean) as { time: number; bps_in: number; bps_out: number }[]
  }, [singleData])

  // Compute bandwidth (bytes/s) from consecutive volume points — multi VM
  const mergedMultiBandwidthData = useMemo(() => {
    if (multiData.length === 0) return []

    const timeMap = new Map<number, Record<string, number>>()
    for (const vm of multiData) {
      const pts = vm.points
      for (let i = 1; i < pts.length; i++) {
        const dt = pts[i].time - pts[i - 1].time
        if (dt <= 0) continue
        const bps = ((pts[i].bytes_in || 0) + (pts[i].bytes_out || 0)) / dt
        if (!timeMap.has(pts[i].time)) timeMap.set(pts[i].time, { time: pts[i].time })
        timeMap.get(pts[i].time)![`vm_${vm.vmid}_bps`] = bps
      }
    }

    return Array.from(timeMap.values()).sort((a, b) => a.time - b.time)
  }, [multiData])

  // Comparison bandwidth (bytes/s) — single VM, time-shifted forward by 24h to align on chart
  const compareSingleBandwidthData = useMemo(() => {
    if (compareSingleData.length < 2) return []
    const shiftSec = COMPARE_SHIFT_MS / 1000
    return compareSingleData.slice(1).map((p, i) => {
      const prev = compareSingleData[i]
      const dt = p.time - prev.time
      if (dt <= 0) return null
      return {
        time: p.time + shiftSec, // shift forward so it aligns with current data
        cmp_bps_in: (p.bytes_in || 0) / dt,
        cmp_bps_out: (p.bytes_out || 0) / dt,
      }
    }).filter(Boolean) as { time: number; cmp_bps_in: number; cmp_bps_out: number }[]
  }, [compareSingleData])

  // Merge current + comparison single bandwidth data by time
  const mergedSingleBandwidthData = useMemo(() => {
    if (!compareEnabled || compareSingleBandwidthData.length === 0) return singleBandwidthData
    const map = new Map<number, Record<string, number>>()
    for (const p of singleBandwidthData) {
      map.set(p.time, { ...p })
    }
    for (const p of compareSingleBandwidthData) {
      const existing = map.get(p.time)
      if (existing) {
        existing.cmp_bps_in = p.cmp_bps_in
        existing.cmp_bps_out = p.cmp_bps_out
      } else {
        map.set(p.time, { time: p.time, cmp_bps_in: p.cmp_bps_in, cmp_bps_out: p.cmp_bps_out })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.time - b.time)
  }, [singleBandwidthData, compareSingleBandwidthData, compareEnabled])

  // Comparison bandwidth (bytes/s) — multi VM, time-shifted forward by 24h
  const compareMultiBandwidthData = useMemo(() => {
    if (compareMultiData.length === 0) return []
    const shiftSec = COMPARE_SHIFT_MS / 1000
    const timeMap = new Map<number, Record<string, number>>()
    for (const vm of compareMultiData) {
      const pts = vm.points
      for (let i = 1; i < pts.length; i++) {
        const dt = pts[i].time - pts[i - 1].time
        if (dt <= 0) continue
        const bps = ((pts[i].bytes_in || 0) + (pts[i].bytes_out || 0)) / dt
        const shiftedTime = pts[i].time + shiftSec
        if (!timeMap.has(shiftedTime)) timeMap.set(shiftedTime, { time: shiftedTime })
        timeMap.get(shiftedTime)![`cmp_vm_${vm.vmid}_bps`] = bps
      }
    }
    return Array.from(timeMap.values()).sort((a, b) => a.time - b.time)
  }, [compareMultiData])

  // Merge current + comparison multi bandwidth data by time
  const mergedMultiBandwidthWithCompare = useMemo(() => {
    if (!compareEnabled || compareMultiBandwidthData.length === 0) return mergedMultiBandwidthData
    const map = new Map<number, Record<string, number>>()
    for (const p of mergedMultiBandwidthData) {
      map.set(p.time, { ...p })
    }
    for (const p of compareMultiBandwidthData) {
      const existing = map.get(p.time)
      if (existing) {
        Object.assign(existing, p)
        existing.time = p.time
      } else {
        map.set(p.time, { ...p })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.time - b.time)
  }, [mergedMultiBandwidthData, compareMultiBandwidthData, compareEnabled])

  const formatBandwidth = (v: number) => `${formatBytes(v)}/s`

  const hasData = isMultiVM ? mergedMultiData.length > 0 : singleData.length > 0

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 1 }}>

      {/* Controls */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Autocomplete
          multiple
          size="small"
          sx={{ minWidth: 350, flex: 1 }}
          options={vms}
          getOptionLabel={(vm) => `${vm.vm_name || `VM ${vm.vmid}`} (${vm.vmid})`}
          value={selectedVMs}
          onChange={(_, v) => setSelectedVMs(v)}
          renderInput={(params) => (
            <TextField {...params} label={t('networkFlows.selectVms')} placeholder={t('common.search')} />
          )}
          renderTags={(value, getTagProps) =>
            value.map((vm, idx) => {
              // Use position in selectedVMs for stable color mapping
              const colorIdx = selectedVMs.findIndex(s => s.vmid === vm.vmid)
              const color = VM_COLORS[(colorIdx >= 0 ? colorIdx : idx) % VM_COLORS.length]
              return (
                <Chip
                  {...getTagProps({ index: idx })}
                  key={vm.vmid}
                  label={vm.vm_name || `VM ${vm.vmid}`}
                  size="small"
                  sx={{
                    height: 24,
                    bgcolor: `${color}20`,
                    borderColor: color,
                    borderRadius: 'calc(var(--proxcenter-button-radius, 12px) * 2)',
                    '& .MuiChip-label': { fontSize: '0.75rem' },
                  }}
                  variant="outlined"
                />
              )
            })
          }
          renderOption={(props, vm) => (
            <Box component="li" {...props} sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-computer-line" style={{ fontSize: 14, opacity: 0.5 }} />
                {vm.vm_name || `VM ${vm.vmid}`}
                <Typography variant="caption" color="text.secondary">({vm.vmid})</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                {formatBytes(vm.bytes_in + vm.bytes_out)}
              </Typography>
            </Box>
          )}
        />

        <ToggleButtonGroup
          value={timeRange}
          exclusive
          onChange={(_, v) => v && setTimeRange(v)}
          size="small"
        >
          {timeRanges.map(r => (
            <ToggleButton key={r.value} value={r.value} sx={{ px: 1.5, fontSize: '0.75rem' }}>
              {r.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <Tooltip title={`${t('networkFlows.compare')} — ${t('networkFlows.yesterday')}`}>
          <Button
            variant={compareEnabled ? 'contained' : 'outlined'}
            size="small"
            onClick={() => setCompareEnabled(prev => !prev)}
            startIcon={<i className="ri-time-line" style={{ fontSize: 16 }} />}
            sx={{
              fontSize: '0.75rem',
              textTransform: 'none',
              minWidth: 'auto',
              borderRadius: 'var(--proxcenter-button-radius, 12px)',
              ...(compareEnabled ? {} : { borderColor: 'divider' }),
            }}
          >
            {t('networkFlows.compare')}
          </Button>
        </Tooltip>
      </Box>

      {/* Error */}
      {error && (
        <Alert severity="warning" icon={<i className="ri-information-line" />}>
          {error}
        </Alert>
      )}

      {/* No VM selected */}
      {selectedVMs.length === 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.4 }}>
            <i className="ri-line-chart-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.selectVmToView')}</Typography>
          </Box>
        </Box>
      )}

      {/* Loading */}
      {selectedVMs.length > 0 && loading && !hasData && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <CircularProgress size={32} />
        </Box>
      )}

      {/* KPI Cards — shown above the chart when data is available */}
      {selectedVMs.length > 0 && hasData && (() => {
        const totalIn = selectedVMs.length === 1
          ? singleData.reduce((s, p) => s + (p.bytes_in || 0), 0)
          : multiData.reduce((s, vm) => s + vm.points.reduce((ss, p) => ss + (p.bytes_in || 0), 0), 0)
        const totalOut = selectedVMs.length === 1
          ? singleData.reduce((s, p) => s + (p.bytes_out || 0), 0)
          : multiData.reduce((s, vm) => s + vm.points.reduce((ss, p) => ss + (p.bytes_out || 0), 0), 0)
        const dataPoints = selectedVMs.length === 1 ? singleData.length : mergedMultiData.length

        return (
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 2 }}>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>↓ {t('networkFlows.totalIn')}</Typography>
                <Typography variant="h6" fontWeight={800} color="success.main">{formatBytes(totalIn)}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>↑ {t('networkFlows.totalOut')}</Typography>
                <Typography variant="h6" fontWeight={800} color="warning.main">{formatBytes(totalOut)}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.totalTraffic')}</Typography>
                <Typography variant="h6" fontWeight={800} color="primary">{formatBytes(totalIn + totalOut)}</Typography>
              </CardContent>
            </Card>
            <Card variant="outlined" sx={{ borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary" fontWeight={600}>{t('networkFlows.dataPoints')}</Typography>
                <Typography variant="h6" fontWeight={800} color="text.primary">{dataPoints}</Typography>
              </CardContent>
            </Card>
          </Box>
        )
      })()}

      {/* Single VM Bandwidth Chart — bytes/s */}
      {selectedVMs.length === 1 && singleBandwidthData.length > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                <i className="ri-line-chart-line" style={{ fontSize: 16, marginRight: 6 }} />
                {selectedVMs[0].vm_name || `VM ${selectedVMs[0].vmid}`} — {t('networkFlows.bandwidthRate')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip label="↓ In" size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: `${theme.palette.success.main}20`, color: theme.palette.success.main }} />
                <Chip label="↑ Out" size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: `${theme.palette.warning.main}20`, color: theme.palette.warning.main }} />
                {compareEnabled && compareSingleBandwidthData.length > 0 && (
                  <Chip label={`--- ${t('networkFlows.yesterday')}`} size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: isDark ? '#ffffff10' : '#00000008', color: theme.palette.text.secondary }} />
                )}
              </Box>
            </Box>

            <Box sx={{ height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mergedSingleBandwidthData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e2e8f0'} />
                  <XAxis dataKey="time" tickFormatter={formatTime} tick={{ fontSize: 10 }} stroke={theme.palette.text.secondary} />
                  <YAxis tickFormatter={formatBandwidth} tick={{ fontSize: 10 }} width={80} stroke={theme.palette.text.secondary} />
                  <RechartsTooltip
                    labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
                    formatter={(v: number, name: string) => {
                      if (name === 'cmp_bps_in') return [formatBandwidth(v), `↓ Inbound (${t('networkFlows.yesterday')})`]
                      if (name === 'cmp_bps_out') return [formatBandwidth(v), `↑ Outbound (${t('networkFlows.yesterday')})`]
                      return [formatBandwidth(v), name === 'bps_in' ? '↓ Inbound' : '↑ Outbound']
                    }}
                    contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, fontSize: 12, borderRadius: 8 }}
                  />
                  <Area type="monotone" dataKey="bps_in" stroke={theme.palette.success.main} fill={theme.palette.success.main} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="bps_out" stroke={theme.palette.warning.main} fill={theme.palette.warning.main} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />
                  {compareEnabled && compareSingleBandwidthData.length > 0 && (
                    <>
                      <Area type="monotone" dataKey="cmp_bps_in" stroke={theme.palette.success.main} fill={theme.palette.success.main} fillOpacity={0.05} strokeWidth={1.5} strokeDasharray="4 4" isAnimationActive={false} connectNulls />
                      <Area type="monotone" dataKey="cmp_bps_out" stroke={theme.palette.warning.main} fill={theme.palette.warning.main} fillOpacity={0.05} strokeWidth={1.5} strokeDasharray="4 4" isAnimationActive={false} connectNulls />
                    </>
                  )}
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Multi VM Bandwidth Chart — bytes/s per VM */}
      {selectedVMs.length > 1 && mergedMultiBandwidthData.length > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                <i className="ri-line-chart-line" style={{ fontSize: 16, marginRight: 6 }} />
                {t('networkFlows.multiVmBandwidthRate')} ({selectedVMs.length} VMs)
              </Typography>
              {compareEnabled && compareMultiBandwidthData.length > 0 && (
                <Chip label={`--- ${t('networkFlows.yesterday')}`} size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: isDark ? '#ffffff10' : '#00000008', color: theme.palette.text.secondary }} />
              )}
            </Box>

            <Box sx={{ height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mergedMultiBandwidthWithCompare}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e2e8f0'} />
                  <XAxis dataKey="time" tickFormatter={formatTime} tick={{ fontSize: 10 }} stroke={theme.palette.text.secondary} />
                  <YAxis tickFormatter={formatBandwidth} tick={{ fontSize: 10 }} width={80} stroke={theme.palette.text.secondary} />
                  <RechartsTooltip
                    labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
                    formatter={(v: number, name: string) => {
                      const isCmp = name.startsWith('cmp_')
                      const lookupName = isCmp ? name.replace('cmp_', '') : name
                      const vm = multiData.find(m => `vm_${m.vmid}_bps` === lookupName)
                        || compareMultiData.find(m => `vm_${m.vmid}_bps` === lookupName)
                      const label = vm?.vm_name || lookupName
                      return [formatBandwidth(v), isCmp ? `${label} (${t('networkFlows.yesterday')})` : label]
                    }}
                    contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, fontSize: 12, borderRadius: 8 }}
                  />
                  <Legend
                    formatter={(value: string) => {
                      const isCmp = value.startsWith('cmp_')
                      const lookupName = isCmp ? value.replace('cmp_', '') : value
                      const vm = multiData.find(m => `vm_${m.vmid}_bps` === lookupName)
                        || compareMultiData.find(m => `vm_${m.vmid}_bps` === lookupName)
                      const label = vm?.vm_name || lookupName
                      return isCmp ? `${label} (${t('networkFlows.yesterday')})` : label
                    }}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  {multiData.map((vm) => {
                    const colorIdx = selectedVMs.findIndex(s => s.vmid === vm.vmid)
                    const color = VM_COLORS[(colorIdx >= 0 ? colorIdx : 0) % VM_COLORS.length]
                    return (
                      <Area
                        key={vm.vmid}
                        type="monotone"
                        dataKey={`vm_${vm.vmid}_bps`}
                        name={`vm_${vm.vmid}_bps`}
                        stroke={color}
                        fill={color}
                        fillOpacity={0.15}
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    )
                  })}
                  {compareEnabled && compareMultiData.map((vm) => {
                    const colorIdx = selectedVMs.findIndex(s => s.vmid === vm.vmid)
                    const color = VM_COLORS[(colorIdx >= 0 ? colorIdx : 0) % VM_COLORS.length]
                    return (
                      <Area
                        key={`cmp_${vm.vmid}`}
                        type="monotone"
                        dataKey={`cmp_vm_${vm.vmid}_bps`}
                        name={`cmp_vm_${vm.vmid}_bps`}
                        stroke={color}
                        fill={color}
                        fillOpacity={0.05}
                        strokeWidth={1.5}
                        strokeDasharray="4 4"
                        isAnimationActive={false}
                        connectNulls
                      />
                    )
                  })}
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Statistics + Data Table — below the chart */}
      {selectedVMs.length > 0 && hasData && (() => {
        const data = selectedVMs.length === 1 ? singleData : mergedMultiData
        if (data.length < 2) return null

        const totalIn = selectedVMs.length === 1
          ? singleData.reduce((s, p) => s + (p.bytes_in || 0), 0)
          : multiData.reduce((s, vm) => s + vm.points.reduce((ss, p) => ss + (p.bytes_in || 0), 0), 0)
        const totalOut = selectedVMs.length === 1
          ? singleData.reduce((s, p) => s + (p.bytes_out || 0), 0)
          : multiData.reduce((s, vm) => s + vm.points.reduce((ss, p) => ss + (p.bytes_out || 0), 0), 0)

        // Per-point stats for single VM
        const pointsIn = singleData.map(p => p.bytes_in || 0)
        const pointsOut = singleData.map(p => p.bytes_out || 0)
        const peakIn = Math.max(...pointsIn, 0)
        const peakOut = Math.max(...pointsOut, 0)
        const avgIn = totalIn / (data.length || 1)
        const avgOut = totalOut / (data.length || 1)
        const peak = Math.max(peakIn, peakOut)

        return (
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>
                <i className="ri-bar-chart-box-line" style={{ fontSize: 16, marginRight: 6 }} />
                Statistics
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
                <TableContainer>
                  <Table size="small">
                    <TableBody>
                      <TableRow>
                        <TableCell sx={{ py: 0.75, fontSize: '0.8rem', fontWeight: 600, border: 0 }}>Peak Inbound</TableCell>
                        <TableCell align="right" sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'JetBrains Mono, monospace', color: 'success.main', border: 0 }}>{formatBytes(peakIn)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ py: 0.75, fontSize: '0.8rem', fontWeight: 600, border: 0 }}>Peak Outbound</TableCell>
                        <TableCell align="right" sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'JetBrains Mono, monospace', color: 'warning.main', border: 0 }}>{formatBytes(peakOut)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ py: 0.75, fontSize: '0.8rem', fontWeight: 600, border: 0 }}>Avg Inbound</TableCell>
                        <TableCell align="right" sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'JetBrains Mono, monospace', border: 0 }}>{formatBytes(avgIn)}/pt</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ py: 0.75, fontSize: '0.8rem', fontWeight: 600, border: 0 }}>Avg Outbound</TableCell>
                        <TableCell align="right" sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'JetBrains Mono, monospace', border: 0 }}>{formatBytes(avgOut)}/pt</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell sx={{ py: 0.75, fontSize: '0.8rem', fontWeight: 600, border: 0 }}>In/Out Ratio</TableCell>
                        <TableCell align="right" sx={{ py: 0.75, fontSize: '0.8rem', fontFamily: 'JetBrains Mono, monospace', border: 0 }}>
                          {totalOut > 0 ? (totalIn / totalOut).toFixed(2) : '—'}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </TableContainer>
                {/* Visual peak bars */}
                <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1.5 }}>
                  {peak > 0 && (<>
                    <Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" fontWeight={600}>↓ Peak Inbound</Typography>
                        <Typography variant="caption" fontFamily="JetBrains Mono, monospace" color="success.main">{formatBytes(peakIn)}</Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={(peakIn / peak) * 100} sx={{ height: 8, borderRadius: 4, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { borderRadius: 4, bgcolor: 'success.main' } }} />
                    </Box>
                    <Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" fontWeight={600}>↑ Peak Outbound</Typography>
                        <Typography variant="caption" fontFamily="JetBrains Mono, monospace" color="warning.main">{formatBytes(peakOut)}</Typography>
                      </Box>
                      <LinearProgress variant="determinate" value={(peakOut / peak) * 100} sx={{ height: 8, borderRadius: 4, bgcolor: 'action.hover', '& .MuiLinearProgress-bar': { borderRadius: 4, bgcolor: 'warning.main' } }} />
                    </Box>
                    <Box>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                        <Typography variant="caption" fontWeight={600}>In/Out Balance</Typography>
                        <Typography variant="caption" fontFamily="JetBrains Mono, monospace">{totalIn + totalOut > 0 ? ((totalIn / (totalIn + totalOut)) * 100).toFixed(0) : 50}% in</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                        <Box sx={{ width: `${totalIn + totalOut > 0 ? (totalIn / (totalIn + totalOut)) * 100 : 50}%`, bgcolor: 'success.main' }} />
                        <Box sx={{ flex: 1, bgcolor: 'warning.main' }} />
                      </Box>
                    </Box>
                  </>)}
                </Box>
              </Box>
            </CardContent>
          </Card>
        )
      })()}

      {/* Empty state */}
      {selectedVMs.length > 0 && !loading && !hasData && !error && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <Box sx={{ textAlign: 'center', opacity: 0.4 }}>
            <i className="ri-database-2-line" style={{ fontSize: 48 }} />
            <Typography variant="body2" sx={{ mt: 1 }}>{t('networkFlows.noTimeSeriesData')}</Typography>
          </Box>
        </Box>
      )}
    </Box>
  )
}
