'use client'

import { useState, useEffect, useCallback } from 'react'

import { useRouter } from 'next/navigation'

import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Paper,
  Skeleton,
  Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RTooltip } from 'recharts'

import type { InventoryCluster, InventoryNode } from '../types'

const statusColors: Record<string, string> = {
  online: '#22c55e',
  degraded: '#f59e0b',
  offline: '#ef4444',
}

function getUsageColor(pct: number): string {
  if (pct >= 90) return '#ef4444'
  if (pct >= 70) return '#f59e0b'
  return '#22c55e'
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)

  if (days > 0) return `${days}d ${hours}h`

  const minutes = Math.floor((seconds % 3600) / 60)

  return `${hours}h ${minutes}m`
}

type TrendPoint = { t: string; cpu: number; ram: number }

// Mini sparkline tooltip
function SparkTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null

  return (
    <Box sx={{
      bgcolor: 'background.paper',
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 1,
      px: 1,
      py: 0.5,
      fontSize: '0.65rem',
    }}>
      <Box sx={{ color: '#e57000', fontWeight: 600 }}>CPU: {payload[0]?.value ?? 0}%</Box>
      {payload[1] && <Box sx={{ color: '#b35500', fontWeight: 600 }}>RAM: {payload[1]?.value ?? 0}%</Box>}
    </Box>
  )
}

// Sparkline chart component
function MiniSparkline({ data, id }: { data: TrendPoint[]; id: string }) {
  if (!data || data.length === 0) return null

  const cpuColor = '#e57000'
  const ramColor = '#b35500'
  const allValues = data.flatMap(d => [d.cpu || 0, d.ram || 0])
  const yMax = Math.min(100, Math.max(...allValues, 10) + 10)
  const yMin = Math.max(0, Math.min(...allValues, 0) - 5)

  return (
    <Box sx={{ height: 32, width: '100%' }}>
      <ResponsiveContainer width='100%' height='100%'>
        <AreaChart data={data} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={`cpuG-${id}`} x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor={cpuColor} stopOpacity={0.25} />
              <stop offset='100%' stopColor={cpuColor} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <XAxis dataKey='t' hide />
          <YAxis hide domain={[yMin, yMax]} />
          <RTooltip content={<SparkTooltip />} cursor={{ stroke: cpuColor, strokeWidth: 1, strokeDasharray: '3 3' }} />
          <Area type='monotone' dataKey='cpu' stroke={cpuColor} strokeWidth={1.5} fill={`url(#cpuG-${id})`} dot={false} isAnimationActive={false} />
          <Area type='monotone' dataKey='ram' stroke={ramColor} strokeWidth={1.5} fill='transparent' dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  )
}

function NodeRow({ node, trends }: { node: InventoryNode; trends?: TrendPoint[] }) {
  const cpuPct = node.cpu != null ? node.cpu * 100 : 0
  const ramPct = node.maxmem ? ((node.mem || 0) / node.maxmem) * 100 : 0
  const isOnline = node.status === 'online'

  return (
    <Box sx={{ py: 1, '&:not(:last-child)': { borderBottom: '1px solid', borderColor: 'divider' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Box sx={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          bgcolor: isOnline ? '#22c55e' : '#ef4444',
        }} />
        <Typography variant='body2' fontWeight={600} sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.node}
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          {node.guests.length} VMs
        </Typography>
      </Box>
      {isOnline && (
        <Box sx={{ pl: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 0.25 }}>
            <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.65rem' }}>
              CPU <Box component='span' sx={{ fontWeight: 600, color: getUsageColor(cpuPct) }}>{cpuPct.toFixed(0)}%</Box>
            </Typography>
            <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.65rem' }}>
              RAM <Box component='span' sx={{ fontWeight: 600, color: getUsageColor(ramPct) }}>{ramPct.toFixed(0)}%</Box>
            </Typography>
            {node.uptime != null && (
              <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.65rem' }}>
                Up {formatUptime(node.uptime)}
              </Typography>
            )}
          </Box>
          {trends && trends.length > 0 && (
            <MiniSparkline data={trends} id={`node-${node.node}`} />
          )}
        </Box>
      )}
    </Box>
  )
}

interface GeoDetailsSidebarProps {
  cluster: InventoryCluster
  onClose: () => void
}

export default function GeoDetailsSidebar({ cluster, onClose }: GeoDetailsSidebarProps) {
  const t = useTranslations('topology')
  const router = useRouter()

  const [nodeTrends, setNodeTrends] = useState<Record<string, TrendPoint[]>>({})
  const [vmTrends, setVmTrends] = useState<Record<string, TrendPoint[]>>({})
  const [trendsLoading, setTrendsLoading] = useState(false)

  const totalNodes = cluster.nodes.length
  const onlineNodes = cluster.nodes.filter((n) => n.status === 'online').length
  const totalVms = cluster.nodes.reduce((sum, n) => sum + n.guests.length, 0)
  const runningVms = cluster.nodes.reduce(
    (sum, n) => sum + n.guests.filter((g) => g.status === 'running').length, 0
  )

  let cpuSum = 0
  let cpuCount = 0
  let memUsed = 0
  let memTotal = 0

  for (const node of cluster.nodes) {
    if (node.cpu != null) { cpuSum += node.cpu; cpuCount++ }
    if (node.mem != null) memUsed += node.mem
    if (node.maxmem != null) memTotal += node.maxmem
  }

  const cpuPct = cpuCount > 0 ? (cpuSum / cpuCount) * 100 : 0
  const ramPct = memTotal > 0 ? (memUsed / memTotal) * 100 : 0

  // All VMs sorted: running first, then by name
  const allGuests = cluster.nodes.flatMap((n) =>
    n.guests.map((g) => ({ ...g, nodeName: n.node }))
  )
  const sortedVms = [...allGuests].sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1
    if (a.status !== 'running' && b.status === 'running') return 1
    return (a.name || '').localeCompare(b.name || '')
  })

  // Fetch trends for nodes and VMs
  const fetchTrends = useCallback(async () => {
    setTrendsLoading(true)

    try {
      // Fetch node trends via RRD
      const nodePromises = cluster.nodes
        .filter(n => n.status === 'online')
        .map(async (node) => {
          try {
            const res = await fetch(
              `/api/v1/connections/${encodeURIComponent(cluster.id)}/rrd?path=${encodeURIComponent(`/nodes/${node.node}`)}&timeframe=hour`,
              { cache: 'no-store' }
            )
            const json = await res.json()
            const raw = Array.isArray(json) ? json : []
            const points: TrendPoint[] = raw
              .filter((p: any) => p && typeof p.time === 'number')
              .slice(-36)
              .map((p: any) => {
                const cpuVal = Math.round(Math.max(0, Math.min(100, Number(p.cpu || 0) * 100)))
                const mem = Number(p.memused ?? p.mem ?? 0)
                const maxmem = Number(p.memtotal ?? p.maxmem ?? 0)
                const ramVal = maxmem > 0 ? Math.round(Math.max(0, Math.min(100, (mem / maxmem) * 100))) : 0
                const d = new Date(Number(p.time) * 1000)

                return { t: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, cpu: cpuVal, ram: ramVal }
              })

            return { key: node.node, data: points }
          } catch {
            return { key: node.node, data: [] }
          }
        })

      const nodeResults = await Promise.all(nodePromises)
      const nTrends: Record<string, TrendPoint[]> = {}

      for (const r of nodeResults) nTrends[r.key] = r.data
      setNodeTrends(nTrends)

      // Fetch VM trends via batch endpoint
      const runningGuests = allGuests.filter(g => g.status === 'running')

      if (runningGuests.length > 0) {
        try {
          const res = await fetch(
            `/api/v1/connections/${encodeURIComponent(cluster.id)}/guests/trends`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: runningGuests.map(g => ({ type: g.type, node: g.nodeName, vmid: String(g.vmid) })),
                timeframe: 'hour',
              }),
            }
          )
          const json = await res.json()
          const data = json?.data || {}
          const vTrends: Record<string, TrendPoint[]> = {}

          for (const g of runningGuests) {
            const key = `${g.type}:${g.nodeName}:${g.vmid}`
            const vmKey = `${g.nodeName}-${g.vmid}`

            if (data[key]) vTrends[vmKey] = data[key].slice(-36)
          }

          setVmTrends(vTrends)
        } catch {
          // ignore
        }
      }
    } finally {
      setTrendsLoading(false)
    }
  }, [cluster.id, cluster.nodes, allGuests])

  useEffect(() => {
    fetchTrends()
  }, [cluster.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Aggregate cluster sparkline from node trends
  const clusterTrend: TrendPoint[] = (() => {
    const onlineNodeKeys = cluster.nodes.filter(n => n.status === 'online').map(n => n.node)
    const nodeDataArrays = onlineNodeKeys.map(k => nodeTrends[k]).filter(Boolean)

    if (nodeDataArrays.length === 0) return []

    const maxLen = Math.max(...nodeDataArrays.map(a => a.length))
    const result: TrendPoint[] = []

    for (let i = 0; i < maxLen; i++) {
      let cpuS = 0; let cpuC = 0; let ramS = 0; let ramC = 0; let time = ''

      for (const arr of nodeDataArrays) {
        const pt = arr[i]

        if (!pt) continue
        if (!time) time = pt.t
        cpuS += pt.cpu; cpuC++
        ramS += pt.ram; ramC++
      }

      if (cpuC > 0) result.push({ t: time, cpu: Math.round(cpuS / cpuC), ram: Math.round(ramS / ramC) })
    }

    return result
  })()

  return (
    <Paper
      elevation={4}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 340,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 1000,
        borderLeft: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, overflow: 'hidden' }}>
          <Box sx={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            bgcolor: statusColors[cluster.status] || '#6b7280',
            boxShadow: `0 0 6px ${statusColors[cluster.status] || '#6b7280'}`,
          }} />
          <Typography variant='subtitle2' fontWeight={700} noWrap>
            {cluster.name}
          </Typography>
        </Box>
        <IconButton size='small' onClick={onClose}>
          <i className='ri-close-line' style={{ fontSize: 18 }} />
        </IconButton>
      </Box>
      <Divider />

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
        {/* Location */}
        {cluster.locationLabel && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1.5 }}>
            <i className='ri-map-pin-2-fill' style={{ fontSize: 14, color: statusColors[cluster.status] }} />
            <Typography variant='body2' color='text.secondary'>
              {cluster.locationLabel}
            </Typography>
          </Box>
        )}

        {/* Status + summary chips */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          <Chip
            size='small'
            label={cluster.status.toUpperCase()}
            sx={{
              bgcolor: statusColors[cluster.status] || '#6b7280',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.7rem',
            }}
          />
          <Chip size='small' variant='outlined' label={`${onlineNodes}/${totalNodes} ${t('nodes')}`} />
          <Chip size='small' variant='outlined' label={`${runningVms}/${totalVms} VMs`} />
        </Box>

        {/* Cluster sparkline */}
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 0.5 }}>
            <Typography variant='caption' color='text.secondary'>
              CPU <Box component='span' sx={{ fontWeight: 600, color: getUsageColor(cpuPct) }}>{cpuPct.toFixed(1)}%</Box>
            </Typography>
            <Typography variant='caption' color='text.secondary'>
              RAM <Box component='span' sx={{ fontWeight: 600, color: getUsageColor(ramPct) }}>{ramPct.toFixed(1)}%</Box>
            </Typography>
            {memTotal > 0 && (
              <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.65rem' }}>
                {formatBytes(memUsed)} / {formatBytes(memTotal)}
              </Typography>
            )}
          </Box>
          {trendsLoading ? (
            <Skeleton variant='rounded' width='100%' height={32} />
          ) : (
            <MiniSparkline data={clusterTrend} id='cluster' />
          )}
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* Nodes list */}
        <Typography variant='caption' fontWeight={600} color='text.secondary' sx={{ mb: 0.5, display: 'block' }}>
          {t('nodes').toUpperCase()} ({totalNodes})
        </Typography>
        <Box sx={{ mb: 1.5 }}>
          {cluster.nodes.map((node) => (
            <NodeRow key={node.node} node={node} trends={nodeTrends[node.node]} />
          ))}
        </Box>

        {/* All VMs */}
        {sortedVms.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant='caption' fontWeight={600} color='text.secondary' sx={{ mb: 0.5, display: 'block' }}>
              VIRTUAL MACHINES ({sortedVms.length})
            </Typography>
            {sortedVms.map((vm) => {
              const isRunning = vm.status === 'running'
              const vmKey = `${vm.nodeName}-${vm.vmid}`
              const vmTrend = vmTrends[vmKey]

              return (
                <Box
                  key={vmKey}
                  onClick={() => router.push(`/infrastructure/inventory?connectionId=${cluster.id}&vmid=${vm.vmid}&node=${vm.nodeName}`)}
                  sx={{
                    py: 0.5,
                    px: 0.5,
                    borderRadius: 1,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{
                      width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                      bgcolor: isRunning ? '#22c55e' : '#ef4444',
                    }} />
                    <i
                      className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
                      style={{ fontSize: 14, color: '#8b5cf6', flexShrink: 0 }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='caption' fontWeight={600} noWrap>
                        {vm.name || `${vm.type}/${vm.vmid}`}
                      </Typography>
                      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', fontSize: '0.65rem' }}>
                        {vm.nodeName} · {String(vm.vmid)}
                      </Typography>
                    </Box>
                    {isRunning && vm.cpu != null && (
                      <Typography variant='caption' fontWeight={600} sx={{ color: getUsageColor((vm.cpu || 0) * 100), flexShrink: 0 }}>
                        {((vm.cpu || 0) * 100).toFixed(0)}%
                      </Typography>
                    )}
                    <i className='ri-arrow-right-s-line' style={{ fontSize: 14, opacity: 0.3, flexShrink: 0 }} />
                  </Box>
                  {isRunning && vmTrend && vmTrend.length > 0 && (
                    <Box sx={{ pl: 3.5, mt: 0.25 }}>
                      <MiniSparkline data={vmTrend} id={`vm-${vmKey}`} />
                    </Box>
                  )}
                </Box>
              )
            })}
          </>
        )}
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ px: 2, py: 1.5 }}>
        <Button
          size='small'
          variant='outlined'
          fullWidth
          startIcon={<i className='ri-arrow-right-line' style={{ fontSize: 16 }} />}
          onClick={() => router.push(`/infrastructure/inventory?connectionId=${cluster.id}`)}
        >
          {t('viewInInventory')}
        </Button>
      </Box>
    </Paper>
  )
}
