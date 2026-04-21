'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { Bar, BarChart, Cell, Tooltip, XAxis, YAxis } from 'recharts'
import ChartContainer from '@/components/ChartContainer'

type VmNetData = {
  vmid: string
  name: string
  node: string
  type: string
  status: string
  connId?: string
  nets: Array<{ name: string; bridge?: string; tag?: number; model?: string; macaddr?: string; firewall?: boolean }>
}

type Props = {
  connectionIds: string[]
  connectionNames: Record<string, string>
}

const BRIDGE_TYPE_COLORS: Record<string, string> = {
  bridge: '#3b82f6',
  ovs_bridge: '#8b5cf6',
  vlan: '#f59e0b',
  bond: '#22c55e',
  ovs_bond: '#06b6d4',
  ovs_vlan: '#ec4899',
}

function getBridgeTypeColor(type: string): string {
  return BRIDGE_TYPE_COLORS[type] ?? '#6b7280'
}

function KpiCard({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  const theme = useTheme()
  return (
    <Card
      variant="outlined"
      sx={{
        flex: 1,
        borderRadius: 2,
        bgcolor: alpha(theme.palette.primary.main, 0.04),
        border: `1px solid ${alpha(theme.palette.primary.main, 0.15)}`,
      }}
    >
      <CardContent sx={{ py: 1.5, px: 2, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
          <i className={icon} style={{ fontSize: 16, opacity: 0.55, color: theme.palette.primary.main }} />
          <Typography variant="caption" sx={{ opacity: 0.6 }}>{label}</Typography>
        </Stack>
        <Typography variant="h5" fontWeight={700}>{value}</Typography>
      </CardContent>
    </Card>
  )
}

type VlanEntry = {
  vlan: number
  vmCount: number
  bridges: string[]
  vms: Array<{ vmid: string; name: string; node: string; status: string; bridge: string }>
}

function VlanVmsList({ vlans }: { vlans: VlanEntry[] }) {
  const theme = useTheme()
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const toggle = (vlan: number) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(vlan)) next.delete(vlan)
      else next.add(vlan)
      return next
    })
  }

  return (
    <Card variant="outlined" sx={{ mb: 3, borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
      <CardContent sx={{ pb: '16px !important' }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-git-branch-line" style={{ opacity: 0.6 }} />
          VMs by VLAN
          <Chip label={vlans.length} size="small" sx={{ height: 20, fontSize: 11, ml: 0.5, bgcolor: alpha(theme.palette.primary.main, 0.1) }} />
        </Typography>
        <Stack spacing={0}>
          {vlans.map((v) => {
            const isOpen = expanded.has(v.vlan)
            return (
              <Box key={v.vlan}>
                <Box
                  onClick={() => toggle(v.vlan)}
                  sx={{
                    display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 0.75,
                    cursor: 'pointer', borderRadius: 1,
                    '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.5) },
                  }}
                >
                  <i className={isOpen ? 'ri-subtract-line' : 'ri-add-line'} style={{ fontSize: 16, opacity: 0.5 }} />
                  <Chip
                    label={`VLAN ${v.vlan}`}
                    size="small"
                    sx={{ height: 22, fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main }}
                  />
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>
                    {v.bridges.join(', ')}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Chip
                    label={`${v.vmCount} VM${v.vmCount > 1 ? 's' : ''}`}
                    size="small"
                    sx={{ height: 20, fontSize: 11, fontWeight: 600, bgcolor: alpha(theme.palette.text.primary, 0.06) }}
                  />
                </Box>
                <Collapse in={isOpen}>
                  <TableContainer sx={{ pl: 4.5 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 700, fontSize: 11, opacity: 0.55, py: 0.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>VM</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 11, opacity: 0.55, py: 0.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>Node</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 11, opacity: 0.55, py: 0.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>Bridge</TableCell>
                          <TableCell sx={{ fontWeight: 700, fontSize: 11, opacity: 0.55, py: 0.5, borderBottom: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>Status</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {v.vms.map((vm, i) => (
                          <TableRow key={`${vm.vmid}-${i}`} sx={{ '&:last-child td': { border: 0 } }}>
                            <TableCell sx={{ py: 0.5, fontSize: 12 }}>
                              <Stack direction="row" alignItems="center" spacing={0.75}>
                                <i className="ri-computer-line" style={{ fontSize: 13, opacity: 0.5 }} />
                                <Typography variant="body2" sx={{ fontSize: 12, fontWeight: 600 }}>{vm.name || vm.vmid}</Typography>
                                <Typography variant="caption" sx={{ opacity: 0.4, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>{vm.vmid}</Typography>
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ py: 0.5, fontSize: 12 }}>
                              <Stack direction="row" alignItems="center" spacing={0.5}>
                                <i className="ri-server-line" style={{ fontSize: 12, opacity: 0.4 }} />
                                <span>{vm.node}</span>
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ py: 0.5, fontSize: 12, fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>{vm.bridge}</TableCell>
                            <TableCell sx={{ py: 0.5 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: vm.status === 'running' ? '#4caf50' : '#9e9e9e' }} />
                                <Typography variant="caption" sx={{ fontSize: 11 }}>{vm.status}</Typography>
                              </Box>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Collapse>
              </Box>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}

export default function NetworkDashboard({ connectionIds, connectionNames }: Props) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const [loading, setLoading] = useState(false)
  const [networkData, setNetworkData] = useState<VmNetData[]>([])
  const [fetched, setFetched] = useState(false)

  // Stabilize connectionIds to avoid refetching on every parent re-render
  const connIdsKey = connectionIds.slice().sort((a, b) => a.localeCompare(b)).join(',')

  useEffect(() => {
    if (!connIdsKey) return
    const ids = connIdsKey.split(',')
    let alive = true
    setLoading(true)
    Promise.all(
      ids.map(async (connId) => {
        try {
          const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/networks`)
          if (!res.ok) return []
          const json = await res.json()
          return (json.data || []).map((vm: any) => ({ ...vm, connId }))
        } catch { return [] }
      })
    ).then((results) => {
      if (!alive) return
      setNetworkData(results.flat())
    }).finally(() => {
      if (!alive) return
      setLoading(false)
      setFetched(true)
    })
    return () => { alive = false }
  }, [connIdsKey])

  const summary = useMemo(() => {
    if (!networkData.length) return null

    const bridgeMap = new Map<string, { bridge: string; node: string; connName: string; type: string; vmCount: number }>()
    const vlanMap = new Map<number, { vlan: number; vmCount: number; bridges: Set<string>; vms: Array<{ vmid: string; name: string; node: string; status: string; bridge: string }> }>()
    let totalVmsWithNetwork = 0

    for (const vm of networkData) {
      if (vm.nets.length > 0) totalVmsWithNetwork++
      for (const net of vm.nets) {
        if (net.bridge) {
          const key = `${vm.connId}:${vm.node}:${net.bridge}`
          const existing = bridgeMap.get(key)
          if (existing) {
            existing.vmCount++
          } else {
            bridgeMap.set(key, {
              bridge: net.bridge,
              node: vm.node,
              connName: connectionNames[vm.connId || ''] || vm.connId || '',
              type: net.bridge.startsWith('ovs') ? 'ovs_bridge' : 'bridge',
              vmCount: 1,
            })
          }
        }
        if (net.tag != null) {
          const existing = vlanMap.get(net.tag)
          if (existing) {
            existing.vmCount++
            if (net.bridge) existing.bridges.add(net.bridge)
            existing.vms.push({ vmid: vm.vmid, name: vm.name, node: vm.node, status: vm.status, bridge: net.bridge || '' })
          } else {
            vlanMap.set(net.tag, {
              vlan: net.tag, vmCount: 1,
              bridges: new Set(net.bridge ? [net.bridge] : []),
              vms: [{ vmid: vm.vmid, name: vm.name, node: vm.node, status: vm.status, bridge: net.bridge || '' }],
            })
          }
        }
      }
    }

    return {
      totalBridges: bridgeMap.size,
      totalVlans: vlanMap.size,
      totalVmsWithNetwork,
      vlanBreakdown: [...vlanMap.values()].map(v => ({ ...v, bridges: [...v.bridges] })).sort((a, b) => b.vmCount - a.vmCount),
      bridgeBreakdown: [...bridgeMap.values()],
    }
  }, [networkData, connectionNames])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!summary && fetched) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8, flexDirection: 'column', gap: 1.5, opacity: 0.5 }}>
        <i className="ri-router-line" style={{ fontSize: 48 }} />
        <Typography variant="body1">No network data available</Typography>
      </Box>
    )
  }

  if (!summary) return null

  const topVlans = [...summary.vlanBreakdown].sort((a, b) => b.vmCount - a.vmCount).slice(0, 10)
  const chartData = topVlans.map((v) => ({ name: `VLAN ${v.vlan}`, vms: v.vmCount }))
  const axisColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'

  return (
    <Box>
      {/* Header */}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 3 }}>
        <Box
          sx={{
            width: 36, height: 36, borderRadius: 1.5,
            bgcolor: alpha(theme.palette.primary.main, 0.12),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <i className="ri-router-fill" style={{ fontSize: 20, color: theme.palette.primary.main }} />
        </Box>
        <Box>
          <Typography variant="h6" fontWeight={700} lineHeight={1.2}>Network Overview</Typography>
          <Typography variant="caption" sx={{ opacity: 0.55 }}>Bridges, VLANs and VM network assignments</Typography>
        </Box>
      </Stack>

      {/* KPI Row */}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 3 }}>
        <KpiCard label="Total Bridges" value={summary.totalBridges} icon="ri-share-line" />
        <KpiCard label="VLANs" value={summary.totalVlans} icon="ri-git-branch-line" />
        <KpiCard label="VMs with Network" value={summary.totalVmsWithNetwork} icon="ri-computer-line" />
      </Stack>

      {/* VLAN Distribution Chart */}
      {chartData.length > 0 && (
        <Card variant="outlined" sx={{ mb: 3, borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
          <CardContent sx={{ pb: '16px !important' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className="ri-bar-chart-2-line" style={{ opacity: 0.6 }} />
              VLAN Distribution (top {chartData.length})
            </Typography>
            <ChartContainer height={220}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -8, bottom: 4 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: axisColor }} axisLine={{ stroke: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: axisColor }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${alpha(theme.palette.divider, 0.8)}`, borderRadius: 8, fontSize: 12, color: theme.palette.text.primary }}
                  cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }}
                  formatter={(value: number) => [value, 'VMs']}
                />
                <Bar dataKey="vms" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={alpha(theme.palette.primary.main, 0.75 - index * 0.05)} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      {/* VMs by VLAN */}
      {summary.vlanBreakdown.length > 0 && (
        <VlanVmsList vlans={summary.vlanBreakdown} />
      )}

      {/* Bridge Table */}
      <Card variant="outlined" sx={{ borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.8)}` }}>
        <CardContent sx={{ pb: '16px !important' }}>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className="ri-node-tree" style={{ opacity: 0.6 }} />
            Bridges
            <Chip label={summary.bridgeBreakdown.length} size="small" sx={{ height: 20, fontSize: 11, ml: 0.5, bgcolor: alpha(theme.palette.primary.main, 0.1) }} />
          </Typography>

          {summary.bridgeBreakdown.length === 0 ? (
            <Box sx={{ py: 3, textAlign: 'center', opacity: 0.5 }}>
              <Typography variant="body2">No bridges found</Typography>
            </Box>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>Bridge</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>Node</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>Cluster</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>Type</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700, fontSize: 12, opacity: 0.65, py: 1 }}>VMs</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.bridgeBreakdown.map((bridge, idx) => {
                    const typeColor = getBridgeTypeColor(bridge.type)
                    return (
                      <TableRow
                        key={`${bridge.connName}-${bridge.node}-${bridge.bridge}-${idx}`}
                        sx={{ '&:last-child td': { border: 0 }, '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.5) } }}
                      >
                        <TableCell sx={{ py: 1 }}>
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <i className="ri-share-line" style={{ fontSize: 14, color: theme.palette.primary.main, opacity: 0.7 }} />
                            <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{bridge.bridge}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Stack direction="row" alignItems="center" spacing={0.75}>
                            <i className="ri-server-line" style={{ fontSize: 13, opacity: 0.5 }} />
                            <Typography variant="body2" sx={{ fontSize: 12 }}>{bridge.node}</Typography>
                          </Stack>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.75 }}>{bridge.connName}</Typography>
                        </TableCell>
                        <TableCell sx={{ py: 1 }}>
                          <Chip
                            label={bridge.type}
                            size="small"
                            sx={{ height: 20, fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', bgcolor: alpha(typeColor, 0.15), color: typeColor, border: `1px solid ${alpha(typeColor, 0.3)}` }}
                          />
                        </TableCell>
                        <TableCell align="right" sx={{ py: 1 }}>
                          {bridge.vmCount > 0 ? (
                            <Chip label={bridge.vmCount} size="small" sx={{ height: 20, minWidth: 28, fontSize: 11, fontWeight: 700, bgcolor: alpha(theme.palette.primary.main, 0.1), color: theme.palette.primary.main }} />
                          ) : (
                            <Typography variant="caption" sx={{ opacity: 0.4 }}>—</Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}
