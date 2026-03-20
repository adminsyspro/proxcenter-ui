'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, Legend,
  PieChart, Pie, Cell, BarChart, Bar,
} from 'recharts'

import {
  Alert,
  Autocomplete,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
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

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isMultiVM = selectedVMs.length > 1

  // Load available VMs and pre-select the top one
  useEffect(() => {
    fetchSFlow('top-talkers', { n: '50' }).then(d => {
      if (Array.isArray(d) && d.length > 0) {
        setVMs(d)
        if (selectedVMs.length === 0) {
          setSelectedVMs([d[0]]) // Pre-select top talker
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

      if (selectedVMs.length === 1 && !destFilter) {
        // Single VM mode
        const data = await fetchSFlow('timeseries/vm', { ...params, vmid: String(selectedVMs[0].vmid) })
        setSingleData(Array.isArray(data) ? data : [])
        setMultiData([])
      } else {
        // Multi VM mode or filtered
        const vmids = selectedVMs.map(v => v.vmid).join(',')
        const data = await fetchSFlow('timeseries/all-vms', { ...params, vmids })
        setMultiData(Array.isArray(data) ? data : [])
        setSingleData([])
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [selectedVMs, timeRange, destFilter])

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
            value.map((vm, idx) => (
              <Chip
                {...getTagProps({ index: idx })}
                key={vm.vmid}
                label={vm.vm_name || `VM ${vm.vmid}`}
                size="small"
                sx={{
                  height: 24,
                  bgcolor: `${VM_COLORS[idx % VM_COLORS.length]}20`,
                  borderColor: VM_COLORS[idx % VM_COLORS.length],
                  borderRadius: 'calc(var(--proxcenter-button-radius, 12px) * 2)',
                  '& .MuiChip-label': { fontSize: '0.75rem' },
                }}
                variant="outlined"
              />
            ))
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

      {/* Single VM Chart — In/Out */}
      {selectedVMs.length === 1 && singleData.length > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                <i className="ri-line-chart-line" style={{ fontSize: 16, marginRight: 6 }} />
                {selectedVMs[0].vm_name || `VM ${selectedVMs[0].vmid}`} — Bandwidth
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip label="↓ In" size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: `${theme.palette.success.main}20`, color: theme.palette.success.main }} />
                <Chip label="↑ Out" size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: `${theme.palette.warning.main}20`, color: theme.palette.warning.main }} />
              </Box>
            </Box>

            <Box sx={{ height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={singleData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e2e8f0'} />
                  <XAxis dataKey="time" tickFormatter={formatTime} tick={{ fontSize: 10 }} stroke={theme.palette.text.secondary} />
                  <YAxis tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 10 }} width={70} stroke={theme.palette.text.secondary} />
                  <RechartsTooltip
                    labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
                    formatter={(v: number, name: string) => [formatBytes(v), name === 'bytes_in' ? '↓ Inbound' : '↑ Outbound']}
                    contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, fontSize: 12, borderRadius: 8 }}
                  />
                  <Area type="monotone" dataKey="bytes_in" stroke={theme.palette.success.main} fill={theme.palette.success.main} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />
                  <Area type="monotone" dataKey="bytes_out" stroke={theme.palette.warning.main} fill={theme.palette.warning.main} fillOpacity={0.2} strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Multi VM Chart — Total bandwidth per VM */}
      {selectedVMs.length > 1 && mergedMultiData.length > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                <i className="ri-line-chart-line" style={{ fontSize: 16, marginRight: 6 }} />
                {t('networkFlows.multiVmBandwidth')} ({selectedVMs.length} VMs)
              </Typography>
            </Box>

            <Box sx={{ height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mergedMultiData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e2e8f0'} />
                  <XAxis dataKey="time" tickFormatter={formatTime} tick={{ fontSize: 10 }} stroke={theme.palette.text.secondary} />
                  <YAxis tickFormatter={(v) => formatBytes(v)} tick={{ fontSize: 10 }} width={70} stroke={theme.palette.text.secondary} />
                  <RechartsTooltip
                    labelFormatter={(v) => new Date(Number(v) * 1000).toLocaleString()}
                    formatter={(v: number, name: string) => {
                      const vm = multiData.find(m => `vm_${m.vmid}_total` === name)
                      return [formatBytes(v), vm?.vm_name || name]
                    }}
                    contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, fontSize: 12, borderRadius: 8 }}
                  />
                  <Legend
                    formatter={(value: string) => {
                      const vm = multiData.find(m => `vm_${m.vmid}_total` === value)
                      return vm?.vm_name || value
                    }}
                    wrapperStyle={{ fontSize: 11 }}
                  />
                  {multiData.map((vm, idx) => (
                    <Area
                      key={vm.vmid}
                      type="monotone"
                      dataKey={`vm_${vm.vmid}_total`}
                      name={`vm_${vm.vmid}_total`}
                      stroke={VM_COLORS[idx % VM_COLORS.length]}
                      fill={VM_COLORS[idx % VM_COLORS.length]}
                      fillOpacity={0.15}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Additional visuals — shown when data is available */}
      {selectedVMs.length > 0 && hasData && (() => {
        // Compute stats for the selected VM(s)
        const totalIn = selectedVMs.length === 1
          ? singleData.reduce((s, p) => s + (p.bytes_in || 0), 0)
          : multiData.reduce((s, vm) => s + vm.points.reduce((ss, p) => ss + (p.bytes_in || 0), 0), 0)
        const totalOut = selectedVMs.length === 1
          ? singleData.reduce((s, p) => s + (p.bytes_out || 0), 0)
          : multiData.reduce((s, vm) => s + vm.points.reduce((ss, p) => ss + (p.bytes_out || 0), 0), 0)
        const totalPackets = selectedVMs.length === 1
          ? singleData.reduce((s, p) => s + (p.packets || 0), 0)
          : multiData.reduce((s, vm) => s + vm.points.reduce((ss, p) => ss + (p.packets || 0), 0), 0)
        const dataPoints = selectedVMs.length === 1 ? singleData.length : mergedMultiData.length

        // In/Out donut data
        const inOutData = [
          { name: '↓ Inbound', value: totalIn, color: theme.palette.success.main },
          { name: '↑ Outbound', value: totalOut, color: theme.palette.warning.main },
        ]

        // Per-VM donut data (for multi-VM)
        const perVmData = multiData.map((vm, idx) => ({
          name: vm.vm_name || `VM ${vm.vmid}`,
          value: vm.points.reduce((s, p) => s + (p.bytes_in || 0) + (p.bytes_out || 0), 0),
          color: VM_COLORS[idx % VM_COLORS.length],
        }))

        return (
          <>
            {/* KPI Cards */}
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

            {/* Donuts row */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: selectedVMs.length > 1 ? '1fr 1fr' : '1fr' }, gap: 2 }}>
              {/* In/Out Donut */}
              <Card variant="outlined" sx={{ borderRadius: 2 }}>
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                    <i className="ri-donut-chart-line" style={{ fontSize: 16, marginRight: 6 }} />
                    {t('networkFlows.inOutRatio')}
                  </Typography>
                  <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={inOutData}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          dataKey="value"
                          strokeWidth={2}
                          stroke={isDark ? '#0f172a' : '#ffffff'}
                        >
                          {inOutData.map((entry, idx) => (
                            <Cell key={idx} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          formatter={(v: number, name: string) => [formatBytes(v), name]}
                          contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, fontSize: 12, borderRadius: 8 }}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </Box>
                </CardContent>
              </Card>

              {/* Per-VM Donut (only in multi-VM mode) */}
              {selectedVMs.length > 1 && (
                <Card variant="outlined" sx={{ borderRadius: 2 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                      <i className="ri-pie-chart-line" style={{ fontSize: 16, marginRight: 6 }} />
                      {t('networkFlows.trafficByVm')}
                    </Typography>
                    <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={perVmData}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={80}
                            dataKey="value"
                            strokeWidth={2}
                            stroke={isDark ? '#0f172a' : '#ffffff'}
                          >
                            {perVmData.map((entry, idx) => (
                              <Cell key={idx} fill={entry.color} />
                            ))}
                          </Pie>
                          <RechartsTooltip
                            formatter={(v: number, name: string) => [formatBytes(v), name]}
                            contentStyle={{ backgroundColor: theme.palette.background.paper, borderColor: theme.palette.divider, color: theme.palette.text.primary, fontSize: 12, borderRadius: 8 }}
                          />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                        </PieChart>
                      </ResponsiveContainer>
                    </Box>
                  </CardContent>
                </Card>
              )}
            </Box>
          </>
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
