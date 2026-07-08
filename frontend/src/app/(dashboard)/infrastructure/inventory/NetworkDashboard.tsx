'use client'

import { useEffect, useMemo, useState } from 'react'
import { bridgeLabel } from '@/lib/proxmox/hostVlanMap'
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
import VnetsSection from './VnetsSection'
import { useTenant } from '@/contexts/TenantContext'
import { fetchConnectionsNetworks, type HostBridgeItem, type HostVlanItem, type SdnVnetItem } from '@/lib/proxmox/fetchConnectionsNetworks'
import { sdnSegmentLabel, type SdnVnet } from '@/lib/proxmox/sdnVnetMap'

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

/** Provider-only KPI counter. Tenants get the donut variant below. */
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

/** Compact donut KPI: a centered icon + count, with a ring whose fill is the
 *  ratio (count / total). When total is zero the ring stays empty and the
 *  caption falls back to "—". The accent colour is configurable per KPI so
 *  each card carries its own visual identity (firewall = green, subnet = blue,
 *  VMs = primary…). */
function NetworkKpi({
  icon, label, count, total, accent, hint,
}: {
  icon: string
  label: string
  count: number
  total?: number | null
  accent: string
  /** Optional sub-line shown under the count (e.g. "of 5"). */
  hint?: string
}) {
  const theme = useTheme()
  const hasRatio = typeof total === 'number' && total > 0
  const pct = hasRatio ? Math.min(100, Math.round((count / (total as number)) * 100)) : 0
  const size = 92
  const strokeWidth = 6
  const r = (size - strokeWidth) / 2
  const c = 2 * Math.PI * r
  const offset = c - (pct / 100) * c

  return (
    <Card
      variant="outlined"
      sx={{
        flex: 1,
        borderRadius: 2,
        bgcolor: alpha(accent, 0.04),
        border: `1px solid ${alpha(accent, 0.18)}`,
      }}
    >
      <CardContent sx={{ py: 1.75, px: 2, '&:last-child': { pb: 1.75 } }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={alpha(accent, 0.15)} strokeWidth={strokeWidth} />
              <circle
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={accent} strokeWidth={strokeWidth} strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={hasRatio ? offset : c}
                style={{ transition: 'stroke-dashoffset 240ms ease-out' }}
              />
            </svg>
            <Box
              sx={{
                position: 'absolute', inset: 0,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 0.25,
              }}
            >
              <i className={icon} style={{ fontSize: 14, opacity: 0.7, color: accent }} />
              <Typography sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1, color: accent }}>{count}</Typography>
              {hasRatio && (
                <Typography sx={{ fontSize: 9, opacity: 0.55, lineHeight: 1 }}>{pct}%</Typography>
              )}
            </Box>
          </Box>
          <Stack spacing={0} sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ opacity: 0.6, lineHeight: 1.3 }}>{label}</Typography>
            {hint && (
              <Typography variant="caption" sx={{ opacity: 0.45, lineHeight: 1.3 }}>{hint}</Typography>
            )}
          </Stack>
        </Stack>
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

function VlanVmsList({ vlans, aliases }: { vlans: VlanEntry[]; aliases?: Record<string, string> }) {
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
                    {v.bridges.map(br => bridgeLabel(aliases, br)).join(', ')}
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
                            <TableCell sx={{ py: 0.5, fontSize: 12, opacity: 0.7 }}>{bridgeLabel(aliases, vm.bridge)}</TableCell>
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

type VnetSummary = {
  id: string
  vdcId: string
  pveName: string
  displayName: string
  firewall: boolean
  subnetCidr: string | null
  subnetGateway: string | null
}

export default function NetworkDashboard({ connectionIds, connectionNames }: Props) {
  const theme = useTheme()
  const isDark = theme.palette.mode === 'dark'
  const { currentTenant, isFullClusterView } = useTenant()
  // Provider tenant (and MSP) keeps the legacy bridge-centric dashboard;
  // non-provider vDC tenants get the VNet/IPAM-focused KPIs and skip the
  // bridges table entirely. Detection key matches useRBACScopeProfile.
  const isProviderTenant = currentTenant?.id === 'default' || !currentTenant
  const [loading, setLoading] = useState(false)
  const [networkData, setNetworkData] = useState<VmNetData[]>([])
  const [hostBridges, setHostBridges] = useState<HostBridgeItem[]>([])
  const [hostVlans, setHostVlans] = useState<HostVlanItem[]>([])
  const [sdnVnets, setSdnVnets] = useState<SdnVnetItem[]>([])
  const [vnetAliasesByConn, setVnetAliasesByConn] = useState<Record<string, Record<string, string>>>({})
  // VNet KPIs are computed from the same data VnetsSection fetches; pulling
  // it up here lets the donut row and the list stay in sync without a
  // duplicate burst of requests. Only fetched on the tenant view.
  const [vnets, setVnets] = useState<VnetSummary[]>([])

  // Stabilize connectionIds to avoid refetching on every parent re-render
  const connIdsKey = connectionIds.slice().sort((a, b) => a.localeCompare(b)).join(',')

  useEffect(() => {
    if (!connIdsKey) return
    const ids = connIdsKey.split(',')
    let alive = true
    setLoading(true)
    fetchConnectionsNetworks(ids, { retries: 2 }).then(({ data, bridges, vlans, sdnVnets, vnetAliasesByConn }) => {
      if (!alive) return
      setNetworkData(data)
      setHostBridges(bridges)
      setHostVlans(vlans)
      setSdnVnets(sdnVnets)
      setVnetAliasesByConn(vnetAliasesByConn)
    }).finally(() => {
      if (!alive) return
      setLoading(false)
    })
    return () => { alive = false }
  }, [connIdsKey])

  // Fetch tenant-visible VNets across all reachable vDCs. Mirrors the loader
  // in VnetsSection — kept lightweight (only the fields we need for KPIs).
  // Provider view doesn't render the donut row, so we skip the round-trip.
  useEffect(() => {
    if (!connIdsKey || isFullClusterView) return
    const accept = new Set(connIdsKey.split(','))
    let alive = true
    ;(async () => {
      try {
        const vdcsRes = await fetch('/api/v1/vdcs')
        const vdcsJson = await vdcsRes.json()
        const allVdcs: Array<{ id: string; connectionId?: string }> = Array.isArray(vdcsJson?.data) ? vdcsJson.data : []
        const visible = accept.size === 0
          ? allVdcs
          : allVdcs.filter(v => !v.connectionId || accept.has(v.connectionId))
        const out: VnetSummary[] = []
        await Promise.all(visible.map(async (v) => {
          try {
            const r = await fetch(`/api/v1/vdcs/${encodeURIComponent(v.id)}/vnets`)
            if (!r.ok) return
            const j = await r.json()
            const list: any[] = Array.isArray(j?.data) ? j.data : []
            for (const vnet of list) {
              const sn = vnet.subnet
              out.push({
                id: vnet.id,
                vdcId: v.id,
                pveName: vnet.pveName,
                displayName: vnet.displayName ?? vnet.pveName,
                firewall: !!vnet.firewall,
                subnetCidr: sn?.cidr ?? null,
                subnetGateway: sn?.gateway ?? null,
              })
            }
          } catch { /* skip vDC on transient error */ }
        }))
        if (alive) setVnets(out)
      } catch { /* keep KPIs at 0 */ }
    })()
    return () => { alive = false }
  }, [connIdsKey, isFullClusterView])

  // The summary is always built — even when networkData is empty — so the
  // tenant view can keep rendering the donut KPIs (zeroed) and the VNets
  // section below. Returning null here used to hide the whole dashboard
  // (and its "create VNet" entry point) for any vDC without VMs.
  const summary = useMemo(() => {
    const bridgeMap = new Map<string, { bridge: string; node: string; connName: string; type: string; vmCount: number }>()
    const vlanMap = new Map<number, { vlan: number; vmCount: number; bridges: Set<string>; vms: Array<{ vmid: string; name: string; node: string; status: string; bridge: string }> }>()
    const sdnByConnVnet = new Map<string, Map<string, SdnVnet>>()
    for (const v of sdnVnets) {
      const cid = v.connId || ''
      if (!sdnByConnVnet.has(cid)) sdnByConnVnet.set(cid, new Map())
      sdnByConnVnet.get(cid)!.set(v.vnet, v)
    }
    const vnetMap = new Map<string, { vnet: SdnVnet; vmCount: number }>() // key: connId + ' ' + vnetId
    let totalVmsWithNetwork = 0

    // Seed bridgeMap and vlanMap from host bridges so bridges/VLANs appear
    // even when no VMs are attached. The VM loop below increments vmCount on
    // top of these seeded entries (0 → N). Only populated for provider scope
    // (tenant view receives bridges: []).
    for (const b of hostBridges) {
      const key = `${b.connId}:${b.node}:${b.iface}`
      if (!bridgeMap.has(key)) {
        bridgeMap.set(key, {
          bridge: b.iface,
          node: b.node,
          connName: connectionNames[b.connId] || b.connId,
          type: b.type === 'OVSBridge' ? 'ovs_bridge' : 'bridge',
          vmCount: 0,
        })
      }
      if (b.tag != null) {
        const existing = vlanMap.get(b.tag)
        if (existing) {
          existing.bridges.add(b.iface)
        } else {
          vlanMap.set(b.tag, { vlan: b.tag, vmCount: 0, bridges: new Set([b.iface]), vms: [] })
        }
      }
    }

    // Seed vlanMap from host VLAN sub-interfaces so VLANs with no attached VM
    // still appear — including VLAN-aware-bridge layouts where the bridge tag
    // does not fold to a single VLAN (issue #542).
    for (const v of hostVlans) {
      if (!vlanMap.has(v.tag)) {
        vlanMap.set(v.tag, { vlan: v.tag, vmCount: 0, bridges: new Set(), vms: [] })
      }
    }

    for (const vm of networkData) {
      if (vm.nets.length > 0) totalVmsWithNetwork++
      const vnetsForConn = sdnByConnVnet.get(vm.connId || '')
      for (const net of vm.nets) {
        const vnet = net.bridge ? vnetsForConn?.get(net.bridge) : undefined
        if (vnet) {
          const key = `${vm.connId || ''} ${vnet.vnet}`
          const existing = vnetMap.get(key)
          if (existing) existing.vmCount++
          else vnetMap.set(key, { vnet, vmCount: 1 })
          continue // a vnet-backed nic is neither a plain bridge nor a VLAN bucket
        }
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
      totalVnets: vnetMap.size,
      totalVmsWithNetwork,
      vlanBreakdown: [...vlanMap.values()].map(v => ({ ...v, bridges: [...v.bridges] })).sort((a, b) => b.vmCount - a.vmCount),
      bridgeBreakdown: [...bridgeMap.values()],
      vnetBreakdown: [...vnetMap.entries()].map(([key, v]) => ({ ...v, key })).sort((a, b) => b.vmCount - a.vmCount),
    }
  }, [networkData, connectionNames, hostBridges, hostVlans, sdnVnets])

  // Flat map of vnet id → alias across all connections (vnet ids are globally unique within a cluster)
  const flatAliases = useMemo(
    () => Object.assign({}, ...Object.values(vnetAliasesByConn)) as Record<string, string>,
    [vnetAliasesByConn],
  )

  // Only block the dashboard with a spinner on the initial load — after
  // that, background refetches keep the existing KPIs / tables visible
  // so the page doesn't flicker on every inventory poll.
  if (loading && networkData.length === 0 && hostBridges.length === 0 && hostVlans.length === 0 && sdnVnets.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

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

      {/* KPI Row. Provider/MSP view keeps the legacy bridge/VLAN counters,
          vDC tenant view gets the donut-based VNet/IPAM/firewall metrics
          that are more actionable for them. */}
      {isFullClusterView ? (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 3 }}>
          <KpiCard label="Total Bridges" value={summary.totalBridges} icon="ri-share-line" />
          <KpiCard label="VLANs" value={summary.totalVlans} icon="ri-git-branch-line" />
          <KpiCard label="VMs with Network" value={summary.totalVmsWithNetwork} icon="ri-computer-line" />
        </Stack>
      ) : (() => {
        const vnetsTotal = vnets.length
        const vnetsWithSubnet = vnets.filter(v => !!v.subnetCidr).length
        const vnetsWithFirewall = vnets.filter(v => v.firewall).length
        const tenantBridgeSet = new Set(vnets.map(v => v.pveName))
        const vmsConnectedToTenantVnets = networkData.filter(vm => vm.nets.some(n => n.bridge && tenantBridgeSet.has(n.bridge))).length
        return (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 3 }}>
            <NetworkKpi
              icon="ri-git-branch-line"
              label="VNets"
              count={vnetsTotal}
              total={vnetsTotal}
              accent={theme.palette.primary.main}
              hint={vnetsTotal > 0 ? `across ${new Set(vnets.map(v => v.vdcId)).size} vDC${new Set(vnets.map(v => v.vdcId)).size > 1 ? 's' : ''}` : 'no VNet yet'}
            />
            <NetworkKpi
              icon="ri-globe-line"
              label="With subnet (IPAM)"
              count={vnetsWithSubnet}
              total={vnetsTotal}
              accent="#3b82f6"
              hint={vnetsTotal > 0 ? `${vnetsTotal - vnetsWithSubnet} bridge-only` : undefined}
            />
            <NetworkKpi
              icon="ri-shield-check-line"
              label="Firewall enabled"
              count={vnetsWithFirewall}
              total={vnetsTotal}
              accent="#22c55e"
              hint={vnetsTotal > 0 ? `${vnetsTotal - vnetsWithFirewall} disabled` : undefined}
            />
            <NetworkKpi
              icon="ri-computer-line"
              label="Connected VMs"
              count={vmsConnectedToTenantVnets}
              total={summary.totalVmsWithNetwork}
              accent="#f59e0b"
              hint={summary.totalVmsWithNetwork > 0 ? `of ${summary.totalVmsWithNetwork} VM${summary.totalVmsWithNetwork > 1 ? 's' : ''} with NIC` : undefined}
            />
          </Stack>
        )
      })()}

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
        <VlanVmsList vlans={summary.vlanBreakdown} aliases={flatAliases} />
      )}

      {/* SDN VNets with attached VMs */}
      {summary.vnetBreakdown.length > 0 && (
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-git-branch-line" style={{ fontSize: 18, opacity: 0.7 }} />
                SDN VNets ({summary.totalVnets})
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VNet</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Zone</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Segment</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VMs</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.vnetBreakdown.map(({ vnet, vmCount, key }) => (
                    <TableRow key={key}>
                      <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{vnet.alias || vnet.vnet}</Typography></TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>{vnet.zone || '—'}{vnet.zoneType ? ` (${vnet.zoneType})` : ''}</Typography></TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>{sdnSegmentLabel(vnet) || '—'}</Typography></TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{vmCount}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      )}

      {/* Bridge Table — provider/MSP only. vDC tenants don't see / can't act
          on physical bridges; for them the VNets list below is the equivalent
          actionable view. */}
      {isFullClusterView && (
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
                              <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{bridgeLabel(flatAliases, bridge.bridge)}</Typography>
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
      )}

      {/* Tenant SDN VNets — managed per vDC. Always rendered: provider needs
          to see / edit them too, tenant uses it as their primary actionable
          list (the section above is provider-only). */}
      <VnetsSection connectionIds={connectionIds} />
    </Box>
  )
}
