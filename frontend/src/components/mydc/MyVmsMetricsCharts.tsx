'use client'

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'

import { Box, Paper, Typography, useTheme, Skeleton, Stack } from '@mui/material'
import { Area, AreaChart, CartesianGrid, Tooltip as RTooltip, XAxis, YAxis } from 'recharts'

import ChartContainer from '@/components/ChartContainer'

const RRD_REFRESH_MS = 30_000

type Metric = 'cpu' | 'ram' | 'net' | 'io'

// One palette per metric: each chart uses shades of its header hue so the
// 4 charts read as distinct families at a glance, and the VM-line colors
// stay tonally consistent with the colored tooltip header. ~16 distinct
// shades per palette; cycles for larger vDCs.
const VM_COLORS_BY_METRIC: Record<Metric, string[]> = {
  // CPU — orange / warm
  cpu: [
    '#f97316', '#fb923c', '#ea580c', '#c2410c', '#fdba74', '#9a3412',
    '#f59e0b', '#fbbf24', '#d97706', '#b45309', '#fcd34d', '#92400e',
    '#ef4444', '#dc2626', '#f87171', '#7c2d12',
  ],

  // RAM — blue / cyan
  ram: [
    '#3b82f6', '#60a5fa', '#2563eb', '#1d4ed8', '#93c5fd', '#1e40af',
    '#0ea5e9', '#38bdf8', '#0284c7', '#0369a1', '#7dd3fc', '#075985',
    '#06b6d4', '#22d3ee', '#0891b2', '#155e75',
  ],

  // Network — green / lime
  net: [
    '#22c55e', '#4ade80', '#16a34a', '#15803d', '#86efac', '#166534',
    '#10b981', '#34d399', '#059669', '#047857', '#6ee7b7', '#065f46',
    '#84cc16', '#a3e635', '#65a30d', '#3f6212',
  ],

  // Disk I/O — purple / magenta
  io: [
    '#a855f7', '#c084fc', '#9333ea', '#7e22ce', '#d8b4fe', '#6b21a8',
    '#8b5cf6', '#a78bfa', '#7c3aed', '#6d28d9', '#c4b5fd', '#5b21b6',
    '#d946ef', '#e879f9', '#c026d3', '#a21caf',
  ],
}

interface Guest {
  vmid: number
  name: string
  type: 'qemu' | 'lxc'
  status: string
  node: string
  template?: boolean
  connId: string
}

interface VmSeries { key: string; name: string; raw: any[] }

interface Props { connectionIds: string[] }

const guestKey = (g: Guest) => `${g.connId}:${g.type}:${g.vmid}`

function fmtTime(ts: number): string {
  const d = new Date(ts * 1000)


return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B/s'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let v = n
  let i = 0

  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }

return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`
}

/**
 * Reshape per-VM RRD into wide-format rows keyed by timestamp.
 * Each column is `${vmKey}_${metric}`, allowing one Line per VM per metric.
 */
function reshape(vms: VmSeries[]): { rows: any[]; vmIndex: Array<{ key: string; name: string }> } {
  const tsSet = new Set<number>()
  const byVm: Record<string, Map<number, { cpu: number | null; ram: number | null; net: number; io: number }>> = {}

  for (const vm of vms) {
    const m = new Map<number, { cpu: number | null; ram: number | null; net: number; io: number }>()

    for (const p of vm.raw || []) {
      const t = Number(p?.time)

      if (!Number.isFinite(t)) continue
      const cpuRaw = Number(p?.cpu)
      const cpuPct = Number.isFinite(cpuRaw) ? Math.max(0, Math.min(100, cpuRaw <= 1.5 ? cpuRaw * 100 : cpuRaw)) : null
      const memRaw = Number(p?.mem ?? p?.memused ?? 0)
      const maxMem = Number(p?.maxmem ?? p?.memtotal ?? 0)
      let ramPct: number | null = null

      if (memRaw <= 1.5 && memRaw > 0) ramPct = Math.max(0, Math.min(100, memRaw * 100))
      else if (maxMem > 0) ramPct = Math.max(0, Math.min(100, (memRaw / maxMem) * 100))
      const net = Number(p?.netin ?? 0) + Number(p?.netout ?? 0)
      const io = Number(p?.diskread ?? 0) + Number(p?.diskwrite ?? 0)

      m.set(t, { cpu: cpuPct, ram: ramPct, net, io })
      tsSet.add(t)
    }

    if (m.size > 0) byVm[vm.key] = m
  }

  // Only include VMs that have at least one usable point.
  const vmIndex = vms.filter(v => byVm[v.key]).map(v => ({ key: v.key, name: v.name }))
  const sortedTs = [...tsSet].sort((a, b) => a - b)

  const rows = sortedTs.map(ts => {
    const row: any = { t: fmtTime(ts), ts }

    for (const v of vmIndex) {
      const point = byVm[v.key].get(ts)

      row[`${v.key}_cpu`] = point?.cpu == null ? null : Math.round(point.cpu)
      row[`${v.key}_ram`] = point?.ram == null ? null : Math.round(point.ram)
      row[`${v.key}_net`] = point?.net ?? null
      row[`${v.key}_io`] = point?.io ?? null
    }


return row
  })

  return { rows, vmIndex }
}

interface MetricSpec {
  metric: Metric
  title: string
  icon: string
  headerBg: string
  yDomain: [number | string, number | string]
  yFormatter: (v: number) => string
  valueFormatter: (v: number) => string
}

function MetricTooltip({ active, payload, label, isDark, spec }: any) {
  if (!active || !payload?.length) return null
  const tooltipBg = isDark ? '#1e293b' : '#fff'
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)'
  const tooltipText = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)'
  const visible = (payload as any[]).filter(e => e.value != null)

  if (visible.length === 0) return null

return (
    <div style={{
      background: tooltipBg, border: `1px solid ${tooltipBorder}`, borderRadius: 6,
      overflow: 'hidden', fontSize: 10, minWidth: 160, color: tooltipText,
      boxShadow: isDark ? '0 6px 16px rgba(0,0,0,0.5)' : '0 6px 16px rgba(0,0,0,0.12)',
    }}>
      <div style={{
        background: spec.headerBg, color: '#fff', padding: '4px 8px',
        fontWeight: 700, fontSize: 10, display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <i className={spec.icon} style={{ fontSize: 11 }} />
        <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{spec.title}</span>
        {label && (
          <span style={{ fontWeight: 400, opacity: 0.85, marginLeft: 'auto' }}>{label}</span>
        )}
      </div>
      <div style={{ padding: '4px 8px', maxHeight: 220, overflowY: 'auto' }}>
        {visible.map((entry) => (
          <div key={entry.dataKey} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
            <span style={{
              flex: 1, color: tooltipText,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180,
            }}>{entry.name}</span>
            <span style={{ fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
              {spec.valueFormatter(Number(entry.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface ChartCardProps {
  spec: MetricSpec
  rows: any[]
  vmIndex: Array<{ key: string; name: string }>
  loading: boolean
  empty: boolean
}

function ChartCard({ spec, rows, vmIndex, loading, empty }: ChartCardProps) {
  const t = useTranslations()
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'
  const axisColor = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  return (
    <Paper variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', minHeight: 240 }}>
      <Stack direction="row" alignItems="center" spacing={1} mb={1}>
        <i className={spec.icon} style={{ fontSize: 16, opacity: 0.8 }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{spec.title}</Typography>
        {!loading && !empty && (
          <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>
            {vmIndex.length} {vmIndex.length === 1 ? 'VM' : 'VMs'}
          </Typography>
        )}
      </Stack>
      <Box sx={{ flex: 1, minHeight: 180 }}>
        {loading ? (
          <Skeleton variant="rectangular" height="100%" sx={{ borderRadius: 1 }} />
        ) : empty ? (
          <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography variant="caption" color="text.secondary">{t('myVdc.metrics.noData')}</Typography>
          </Box>
        ) : (
          <ChartContainer height={180}>
            <AreaChart data={rows} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {vmIndex.map((v, i) => {
                  const palette = VM_COLORS_BY_METRIC[spec.metric]
                  const color = palette[i % palette.length]
                  const gradId = `myvdc-grad-${spec.metric}-${i}`

                  // Top opacity scales down with VM count so 30 VMs don't stack
                  // into a muddy block. Floor at 0.08 keeps a visible tint.
                  const topOpacity = Math.max(0.08, Math.min(0.45, 1.4 / Math.max(1, vmIndex.length)))


return (
                    <linearGradient key={gradId} id={gradId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={color} stopOpacity={topOpacity} />
                      <stop offset="100%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  )
                })}
              </defs>
              <CartesianGrid stroke={gridColor} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="t" tick={{ fill: axisColor, fontSize: 10 }} stroke={axisColor} minTickGap={32} />
              <YAxis
                tick={{ fill: axisColor, fontSize: 10 }}
                stroke={axisColor}
                width={55}
                tickFormatter={spec.yFormatter}
                domain={spec.yDomain}
              />
              <RTooltip content={<MetricTooltip isDark={isDark} spec={spec} />} />
              {vmIndex.map((v, i) => {
                const palette = VM_COLORS_BY_METRIC[spec.metric]
                const color = palette[i % palette.length]
                const gradId = `myvdc-grad-${spec.metric}-${i}`


return (
                  <Area
                    key={v.key}
                    type="monotone"
                    dataKey={`${v.key}_${spec.metric}`}
                    name={v.name}
                    stroke={color}
                    strokeWidth={1.5}
                    fill={`url(#${gradId})`}
                    fillOpacity={1}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                )
              })}
            </AreaChart>
          </ChartContainer>
        )}
      </Box>
    </Paper>
  )
}

/**
 * Per-VM consumption charts for the vDC: one line per VM in each of CPU%,
 * RAM%, network (in+out), disk I/O (read+write) over the last hour.
 * Source = same per-guest RRD endpoint MyVmsCard uses for its sparklines.
 */
export default function MyVmsMetricsCharts({ connectionIds }: Props) {
  const t = useTranslations()
  const [guests, setGuests] = useState<Guest[]>([])
  const [perVm, setPerVm] = useState<VmSeries[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (connectionIds.length === 0) {
      setGuests([])
      setLoading(false)

return
    }

    setLoading(true)
    const accepted = new Set(connectionIds)
    const found: Guest[] = []
    const src = new EventSource('/api/v1/inventory/stream')

    const onCluster = (ev: MessageEvent) => {
      try {
        const cluster = JSON.parse(ev.data)

        if (!accepted.has(cluster.id)) return

        for (const n of cluster.nodes ?? []) {
          for (const g of n.guests ?? []) {
            found.push({
              vmid: g.vmid,
              name: g.name ?? String(g.vmid),
              type: g.type ?? 'qemu',
              status: g.status ?? 'unknown',
              node: n.node,
              template: !!g.template,
              connId: cluster.id,
            })
          }
        }

        setGuests([...found])
      } catch {}
    }

    const onDone = () => { src.close() }
    const onError = () => { src.close() }

    src.addEventListener('cluster', onCluster)
    src.addEventListener('done', onDone)
    src.addEventListener('error', onError)

    return () => {
      src.removeEventListener('cluster', onCluster)
      src.removeEventListener('done', onDone)
      src.removeEventListener('error', onError)
      src.close()
    }
  }, [connectionIds])

  useEffect(() => {
    if (guests.length === 0) {
      setPerVm([])
      setLoading(false)

return
    }

    const controller = new AbortController()
    let cancelled = false

    const fetchAll = async () => {
      // Templates have no metrics; everything else (running OR stopped that
      // ran earlier in the window) gets a fetch — recharts handles null gaps.
      const targets = guests.filter(g => !g.template)

      if (targets.length === 0) {
        if (!cancelled) { setPerVm([]); setLoading(false) }

return
      }

      const results = await Promise.all(targets.map(async (g): Promise<VmSeries> => {
        try {
          const path = `/nodes/${g.node}/${g.type}/${g.vmid}`
          const url = `/api/v1/connections/${encodeURIComponent(g.connId)}/rrd?path=${encodeURIComponent(path)}&timeframe=hour`
          const res = await fetch(url, { cache: 'no-store', signal: controller.signal })

          if (!res.ok) return { key: guestKey(g), name: g.name, raw: [] }
          const json = await res.json()
          let raw: any[] = []

          if (Array.isArray(json)) raw = json
          else if (Array.isArray(json?.data)) raw = json.data
          else if (json?.data && typeof json.data === 'object') raw = Object.values(json.data)

return { key: guestKey(g), name: g.name, raw }
        } catch {
          return { key: guestKey(g), name: g.name, raw: [] }
        }
      }))

      if (cancelled) return

      // Stable sort by VM name so the color palette stays consistent across
      // refreshes. Without this, lines change color on every poll cycle.
      results.sort((a, b) => a.name.localeCompare(b.name))
      setPerVm(results)
      setLoading(false)
    }

    void fetchAll()
    const interval = setInterval(() => { void fetchAll() }, RRD_REFRESH_MS)


return () => { cancelled = true; controller.abort(); clearInterval(interval) }
  }, [guests])

  const { rows, vmIndex } = useMemo(() => reshape(perVm), [perVm])
  const empty = !loading && vmIndex.length === 0

  const specs: MetricSpec[] = useMemo(() => [
    {
      metric: 'cpu',
      title: t('myVdc.metrics.cpuTitle'),
      icon: 'ri-cpu-line',
      headerBg: '#f97316',
      yDomain: [0, 100],
      yFormatter: (v: number) => `${v}%`,
      valueFormatter: (v: number) => `${v}%`,
    },
    {
      metric: 'ram',
      title: t('myVdc.metrics.ramTitle'),
      icon: 'ri-ram-2-line',
      headerBg: '#3b82f6',
      yDomain: [0, 100],
      yFormatter: (v: number) => `${v}%`,
      valueFormatter: (v: number) => `${v}%`,
    },
    {
      metric: 'net',
      title: t('myVdc.metrics.netTitle'),
      icon: 'ri-arrow-up-down-line',
      headerBg: '#22c55e',
      yDomain: ['auto', 'auto'],
      yFormatter: fmtBytes,
      valueFormatter: fmtBytes,
    },
    {
      metric: 'io',
      title: t('myVdc.metrics.ioTitle'),
      icon: 'ri-hard-drive-2-line',
      headerBg: '#a855f7',
      yDomain: ['auto', 'auto'],
      yFormatter: fmtBytes,
      valueFormatter: fmtBytes,
    },
  ], [t])

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
      {specs.map(spec => (
        <ChartCard key={spec.metric} spec={spec} rows={rows} vmIndex={vmIndex} loading={loading} empty={empty} />
      ))}
    </Box>
  )
}
