'use client'

import { useEffect, useMemo, useState } from 'react'

import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useTranslations } from 'next-intl'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'

import type { TopVm, VmTrendPoint, VmIdentity, ConsumerMetric, NetworkMetrics } from '../types'
import { VM_COLORS, COLORS } from '../constants'
import { formatBytesPerSec } from '../helpers'

type Props = {
  topCpuVms: TopVm[]
  topRamVms: TopVm[]
  networkMetrics: NetworkMetrics | null
  vmTrends: Record<string, VmTrendPoint[]>
  vmTrendsLoading: boolean
  fetchVmTrends: (vmIds: string[], timeframe: string) => void
  onVmClick: (vm: VmIdentity) => void
  loading?: boolean
}

export default function TopConsumersCard({
  topCpuVms,
  topRamVms,
  networkMetrics,
  vmTrends,
  vmTrendsLoading,
  fetchVmTrends,
  onVmClick,
  loading,
}: Props) {
  const theme = useTheme()
  const t = useTranslations()
  const [metric, setMetric] = useState<ConsumerMetric>('cpu')
  const [timeframe, setTimeframe] = useState<'hour' | 'day'>('hour')

  // Get top 5 VMs based on selected metric
  const topVms = useMemo(() => {
    if (metric === 'cpu') return topCpuVms.slice(0, 5)
    if (metric === 'ram') return topRamVms.slice(0, 5)
    // network: use topVms from networkMetrics
    if (metric === 'network' && networkMetrics?.topVms) {
      return networkMetrics.topVms.slice(0, 5).map(v => ({
        id: v.id,
        name: v.name,
        node: v.node,
        cpu: 0,
        ram: 0,
        cpuAllocated: 0,
        ramAllocated: 0,
      }))
    }
    return []
  }, [metric, topCpuVms, topRamVms, networkMetrics])

  // Fetch trends when topVms / metric / timeframe change
  useEffect(() => {
    const ids = topVms.map(v => v.id).filter(Boolean)
    if (ids.length > 0) {
      fetchVmTrends(ids, timeframe)
    }
  }, [topVms.map(v => v.id).join(','), timeframe])

  // Transform vmTrends into recharts format: { t, vm1, vm2, ... }
  const { chartData, vmNames } = useMemo(() => {
    const names: string[] = []
    const nameMap: Record<string, string> = {}

    for (const vm of topVms) {
      const label = vm.name || vm.id
      names.push(label)
      nameMap[vm.id] = label
    }

    // Merge all timeseries by timestamp
    const timeMap = new Map<string, Record<string, any>>()

    for (const vm of topVms) {
      const points = vmTrends[vm.id]
      if (!Array.isArray(points)) continue
      const label = nameMap[vm.id]

      for (const p of points) {
        if (!timeMap.has(p.t)) timeMap.set(p.t, { t: p.t })
        const entry = timeMap.get(p.t)!
        if (metric === 'cpu') entry[label] = p.cpu
        else if (metric === 'ram') entry[label] = p.ram
        else if (metric === 'network') entry[label] = (p.netin || 0) + (p.netout || 0)
      }
    }

    return {
      chartData: Array.from(timeMap.values()),
      vmNames: names,
    }
  }, [topVms, vmTrends, metric])

  const isNetwork = metric === 'network'

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null
    return (
      <Box
        sx={{
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
          p: 1.5,
          boxShadow: 3,
          maxWidth: 240,
        }}
      >
        <Typography variant="caption" sx={{ fontWeight: 700, mb: 0.5, display: 'block' }}>
          {label}
        </Typography>
        {payload.map((entry: any) => (
          <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
            <Typography variant="caption" sx={{ color: 'text.secondary', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {entry.name}
            </Typography>
            <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>
              {isNetwork ? formatBytesPerSec(entry.value || 0) : `${entry.value}%`}
            </Typography>
          </Box>
        ))}
      </Box>
    )
  }

  const handleVmClick = (vmName: string) => {
    const vm = topVms.find(v => (v.name || v.id) === vmName)
    if (!vm) return
    // Parse the VM ID to get identity
    const parts = vm.id.split(':')
    if (parts.length >= 4) {
      onVmClick({
        id: vm.id,
        name: vm.name,
        node: vm.node,
        connId: parts[0],
        type: parts[1],
        vmid: parts[3],
      })
    }
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2.5 }}>
        {/* Header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }} flexWrap="wrap" useFlexGap spacing={1}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <i className="ri-bar-chart-grouped-line" style={{ fontSize: 20, color: COLORS.primary }} />
            <Box>
              <Typography variant="h6" fontWeight={700}>{t('resources.topConsumersOverTime')}</Typography>
              <Typography variant="caption" color="text.secondary">{t('resources.topConsumersSubtitle')}</Typography>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1}>
            <ToggleButtonGroup
              value={metric}
              exclusive
              onChange={(_, val) => val && setMetric(val)}
              size="small"
            >
              <ToggleButton value="cpu" sx={{ px: 1.5, py: 0.25, fontSize: '0.7rem' }}>
                {t('resources.metricCpu')}
              </ToggleButton>
              <ToggleButton value="ram" sx={{ px: 1.5, py: 0.25, fontSize: '0.7rem' }}>
                {t('resources.metricRam')}
              </ToggleButton>
              <ToggleButton value="network" sx={{ px: 1.5, py: 0.25, fontSize: '0.7rem' }}>
                {t('resources.metricNetwork')}
              </ToggleButton>
            </ToggleButtonGroup>

            <ToggleButtonGroup
              value={timeframe}
              exclusive
              onChange={(_, val) => val && setTimeframe(val)}
              size="small"
            >
              <ToggleButton value="hour" sx={{ px: 1, py: 0.25, fontSize: '0.7rem' }}>
                {t('resources.timeframe1h')}
              </ToggleButton>
              <ToggleButton value="day" sx={{ px: 1, py: 0.25, fontSize: '0.7rem' }}>
                {t('resources.timeframe24h')}
              </ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>

        {/* Chart */}
        {vmTrendsLoading || loading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 280 }}>
            <CircularProgress size={28} />
          </Box>
        ) : chartData.length === 0 ? (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 280 }}>
            <Typography variant="body2" color="text.secondary">{t('resources.noTrendData')}</Typography>
          </Box>
        ) : (
          <Box sx={{ width: '100%', height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  {vmNames.map((name, i) => (
                    <linearGradient key={name} id={`vm-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={VM_COLORS[i % VM_COLORS.length]} stopOpacity={0.15} />
                      <stop offset="95%" stopColor={VM_COLORS[i % VM_COLORS.length]} stopOpacity={0.01} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.5)} />
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={isNetwork ? ['auto', 'auto'] : [0, 100]}
                  tick={{ fontSize: 10, fill: theme.palette.text.secondary }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={v => isNetwork ? formatBytesPerSec(v) : `${v}%`}
                  width={isNetwork ? 55 : 35}
                />
                <Tooltip content={<CustomTooltip />} />
                {vmNames.map((name, i) => (
                  <Line
                    key={name}
                    type="monotone"
                    dataKey={name}
                    name={name}
                    stroke={VM_COLORS[i % VM_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    connectNulls
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          </Box>
        )}

        {/* Legend */}
        {vmNames.length > 0 && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 1.5, justifyContent: 'center' }}>
            {vmNames.map((name, i) => (
              <Box
                key={name}
                onClick={() => handleVmClick(name)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  cursor: 'pointer',
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  '&:hover': { bgcolor: alpha(VM_COLORS[i % VM_COLORS.length], 0.08) },
                  transition: 'background-color 0.2s',
                }}
              >
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: VM_COLORS[i % VM_COLORS.length] }} />
                <Typography variant="caption" sx={{ fontSize: 11, color: 'text.secondary', fontWeight: 500 }}>
                  {name}
                </Typography>
              </Box>
            ))}
            <Typography variant="caption" sx={{ fontSize: 10, color: 'text.disabled', alignSelf: 'center' }}>
              {t('resources.clickVmForDetails')}
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
