'use client'

import React from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'

import type { InventorySelection } from '../types'
import { bridgeLabel, foldEffectiveVlanTags, type HostBridge, type HostVlan } from '@/lib/proxmox/hostVlanMap'
import { sdnSegmentLabel, type SdnVnet } from '@/lib/proxmox/sdnVnetMap'
import { StatusIcon } from '../InventoryTree'

type NetIface = { id: string; model: string; bridge: string; macaddr?: string; tag?: number; firewall?: boolean; rate?: number }
type VmNet = { vmid: string; name: string; node: string; type: string; status: string; connId?: string; nets: NetIface[] }

export default function NetworkDetailPanel({ selection, onSelect }: {
  selection: InventorySelection
  onSelect?: (sel: InventorySelection) => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  const [netData, setNetData] = React.useState<VmNet[]>([])
  const [hostBridges, setHostBridges] = React.useState<HostBridge[]>([])
  const [hostVlans, setHostVlans] = React.useState<HostVlan[]>([])
  const [sdnVnets, setSdnVnets] = React.useState<SdnVnet[]>([])
  const [vnetAliases, setVnetAliases] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(true)

  // Parse selection id
  const parts = selection.id.split(':')
  const connId = parts[0]
  const nodeName = selection.type === 'net-node' || selection.type === 'net-vlan' || selection.type === 'net-vnet' ? parts[1] : undefined
  const vlanTag = selection.type === 'net-vlan' ? parts[2] : undefined
  const vnetId = selection.type === 'net-vnet' ? parts[2] : undefined
  const bridgeNode = selection.type === 'net-bridge' ? parts[1] : undefined
  const bridgeIface = selection.type === 'net-bridge' ? parts[2] : undefined

  React.useEffect(() => {
    if (!connId) return
    setLoading(true)
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/networks`)
      .then(r => r.json())
      // Fold each guest's server-computed host VLAN into `tag` so guests on a
      // bondX.N bridge with no per-NIC tag group under their real VLAN (see helper).
      .then(json => {
        setNetData((json.data || []).map((vm: any) => ({ ...vm, connId, nets: foldEffectiveVlanTags(vm.nets) })))
        // raw HostBridge[] / HostVlan[] (no connId — this panel is scoped to a single connection)
        setHostBridges(json.bridges || [])
        setHostVlans(json.vlans || [])
        setSdnVnets(json.sdnVnets || [])
        setVnetAliases(json.vnetAliases || {})
      })
      .catch(() => { setNetData([]); setHostBridges([]); setHostVlans([]); setSdnVnets([]); setVnetAliases({}) })
      .finally(() => setLoading(false))
  }, [connId])

  // Fetch connection name
  const [connName, setConnName] = React.useState<string>('')
  React.useEffect(() => {
    if (!connId) return
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}`)
      .then(r => r.json())
      .then(json => setConnName(json.data?.name || json.name || connId))
      .catch(() => setConnName(connId))
  }, [connId])

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 B'
    const k = 1024
    const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(i > 0 ? 1 : 0)} ${sizes[i]}`
  }

  // Flat lookup: this panel is scoped to a single connection, so vnetId → SdnVnet.
  const sdnByVnet = new Map<string, SdnVnet>(sdnVnets.map((v) => [v.vnet, v]))

  if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>

  // --- NET-CONN: Cluster-level network overview ---
  if (selection.type === 'net-conn') {
    const nodeMap = new Map<string, { vlans: Set<string | number>; bridges: Set<string>; vms: Set<string>; vnets: Set<string> }>()
    // Seed nodeMap from host bridges so VM-less nodes appear in the table.
    for (const b of hostBridges) {
      if (!nodeMap.has(b.node)) nodeMap.set(b.node, { vlans: new Set(), bridges: new Set(), vms: new Set(), vnets: new Set() })
      const nd = nodeMap.get(b.node)!
      nd.bridges.add(b.iface)
    }
    // Seed nodeMap VLANs from host VLAN sub-interfaces so VLANs with no attached
    // VM are counted per node, mirroring host bridges (issue #542).
    for (const v of hostVlans) {
      if (!nodeMap.has(v.node)) nodeMap.set(v.node, { vlans: new Set(), bridges: new Set(), vms: new Set(), vnets: new Set() })
      nodeMap.get(v.node)!.vlans.add(v.tag)
    }
    for (const vm of netData) {
      if (!nodeMap.has(vm.node)) nodeMap.set(vm.node, { vlans: new Set(), bridges: new Set(), vms: new Set(), vnets: new Set() })
      const nd = nodeMap.get(vm.node)!
      nd.vms.add(vm.vmid)
      for (const net of vm.nets) {
        const vnet = sdnByVnet.get(net.bridge)
        if (vnet) { nd.vnets.add(vnet.vnet); continue }
        nd.bridges.add(net.bridge)
        nd.vlans.add(net.tag ?? 'untagged')
      }
    }
    const nodes = Array.from(nodeMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    // VLANs and bridges both include host-level interfaces so VM-less nodes
    // still report accurate counts.
    const allVnets = new Set<string>(
      netData.flatMap(vm => vm.nets.map(n => sdnByVnet.get(n.bridge)?.vnet).filter((x): x is string => !!x)),
    )
    const allVlans = new Set<string | number>([
      ...netData.flatMap(vm => vm.nets.filter(n => !sdnByVnet.has(n.bridge)).map(n => n.tag ?? 'untagged')),
      ...hostVlans.map(v => v.tag),
    ])
    const allBridges = new Set<string>([
      ...netData.flatMap(vm => vm.nets.filter(n => !sdnByVnet.has(n.bridge)).map(n => n.bridge)),
      ...hostBridges.map(b => b.iface),
    ])
    const totalVlans = allVlans.size
    const totalBridges = allBridges.size
    const totalVms = new Set(netData.map(vm => vm.vmid)).size

    return (
      <Box sx={{ p: 2.5 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Chip size="small" label="NETWORK" icon={<i className="ri-global-line" style={{ fontSize: 14, marginLeft: 8 }} />} />
          <Typography variant="h6" fontWeight={900}>{connName}</Typography>
        </Box>

        {/* KPIs */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          {[
            { label: 'Nodes', value: nodes.length, icon: 'ri-server-line' },
            { label: 'VLANs', value: totalVlans, icon: 'ri-wifi-line' },
            ...(allVnets.size > 0 ? [{ label: 'VNets', value: allVnets.size, icon: 'ri-git-branch-line' }] : []),
            { label: 'Bridges', value: totalBridges, icon: 'ri-git-branch-line' },
            { label: 'VMs', value: totalVms, icon: 'ri-computer-line' },
          ].map(kpi => (
            <Card key={kpi.label} variant="outlined" sx={{ flex: 1, minWidth: 120, borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                  <i className={kpi.icon} style={{ fontSize: 18, color: theme.palette.primary.main }} />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1.2 }}>{kpi.value}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>{kpi.label}</Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>

        {/* Nodes table */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-server-line" style={{ fontSize: 18, opacity: 0.7 }} />
                {t('common.nodes')}
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Node</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="center">VLANs</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="center">Bridges</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="center">VMs</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {nodes.map(([node, data]) => (
                    <TableRow
                      key={node}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => onSelect?.({ type: 'net-node', id: `${connId}:${node}` })}
                    >
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} />
                          <Typography variant="body2" fontWeight={600}>{node}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Chip size="small" label={data.vlans.size} sx={{ minWidth: 32, fontWeight: 700, fontSize: 12 }} />
                      </TableCell>
                      <TableCell align="center">
                        <Chip size="small" label={data.bridges.size} sx={{ minWidth: 32, fontWeight: 700, fontSize: 12 }} />
                      </TableCell>
                      <TableCell align="center">
                        <Chip size="small" label={data.vms.size} sx={{ minWidth: 32, fontWeight: 700, fontSize: 12 }} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>
    )
  }

  // --- NET-NODE: Node-level network view ---
  if (selection.type === 'net-node' && nodeName) {
    const nodeVms = netData.filter(vm => vm.node === nodeName)
    const nodeVnets = new Set<string>(
      nodeVms.flatMap(vm => vm.nets.map(n => sdnByVnet.get(n.bridge)?.vnet).filter((x): x is string => !!x)),
    )
    const nodeVnetList = Array.from(nodeVnets).sort((a, b) => a.localeCompare(b)).map(id => ({
      id,
      vnet: sdnByVnet.get(id),
      vmCount: new Set(nodeVms.filter(vm => vm.nets.some(n => n.bridge === id)).map(vm => vm.vmid)).size,
    }))
    const nodeHostBridges = hostBridges.filter(b => b.node === nodeName).slice().sort((a, b) => a.iface.localeCompare(b.iface))
    // Build vlanMap from VMs plus host VLAN sub-interfaces on this node, so VLANs
    // with no attached VM still appear (issue #542).
    const vlanMap = new Map<string | number, { bridges: Set<string>; vms: VmNet[] }>()
    for (const v of hostVlans) {
      if (v.node === nodeName && !vlanMap.has(v.tag)) vlanMap.set(v.tag, { bridges: new Set(), vms: [] })
    }
    for (const vm of nodeVms) {
      for (const net of vm.nets) {
        if (sdnByVnet.has(net.bridge)) continue // shown under VNets, not VLAN/Untagged
        const tag = net.tag ?? 'untagged'
        if (!vlanMap.has(tag)) vlanMap.set(tag, { bridges: new Set(), vms: [] })
        const v = vlanMap.get(tag)!
        v.bridges.add(net.bridge)
        if (!v.vms.find(x => x.vmid === vm.vmid)) v.vms.push(vm)
      }
    }
    const vlans = Array.from(vlanMap.entries()).sort((a, b) => {
      if (a[0] === 'untagged') return 1
      if (b[0] === 'untagged') return -1
      return Number(a[0]) - Number(b[0])
    })
    const totalBridges = nodeHostBridges.length

    return (
      <Box sx={{ p: 2.5 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Chip size="small" label="NETWORK" icon={<i className="ri-global-line" style={{ fontSize: 14, marginLeft: 8 }} />} />
          <Typography variant="body2" sx={{ opacity: 0.5 }}>{connName}</Typography>
          <i className="ri-arrow-right-s-line" style={{ opacity: 0.3 }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={16} height={16} />
            <Typography variant="h6" fontWeight={900}>{nodeName}</Typography>
          </Box>
        </Box>

        {/* KPIs */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          {[
            { label: 'VLANs', value: vlans.length, icon: 'ri-wifi-line' },
            ...(nodeVnets.size > 0 ? [{ label: 'VNets', value: nodeVnets.size, icon: 'ri-git-branch-line' }] : []),
            { label: 'Bridges', value: totalBridges, icon: 'ri-git-branch-line' },
            { label: 'VMs', value: nodeVms.length, icon: 'ri-computer-line' },
          ].map(kpi => (
            <Card key={kpi.label} variant="outlined" sx={{ flex: 1, minWidth: 100, borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                  <i className={kpi.icon} style={{ fontSize: 18, color: theme.palette.primary.main }} />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1.2 }}>{kpi.value}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>{kpi.label}</Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>

        {/* Host Bridges section */}
        {nodeHostBridges.length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-share-line" style={{ fontSize: 18, opacity: 0.7 }} />
                  Bridges
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Bridge</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Type</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>IP / CIDR</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {nodeHostBridges.map((b) => (
                      <TableRow
                        key={b.iface}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => onSelect?.({ type: 'net-bridge', id: `${connId}:${nodeName}:${b.iface}:${b.tag ?? 'untagged'}` })}
                      >
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <i className="ri-share-line" style={{ fontSize: 14, opacity: 0.6 }} />
                            <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{bridgeLabel(vnetAliases, b.iface)}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>{b.type}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>{b.cidr || '—'}</Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}

        {/* SDN VNets on this node */}
        {nodeVnetList.length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-git-branch-line" style={{ fontSize: 18, opacity: 0.7 }} />
                  VNets
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VNet</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Segment</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }} align="center">VMs</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {nodeVnetList.map(({ id, vnet, vmCount }) => (
                      <TableRow
                        key={id}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => onSelect?.({ type: 'net-vnet', id: `${connId}:${nodeName}:${id}` })}
                      >
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <i className="ri-git-branch-line" style={{ fontSize: 14, opacity: 0.6 }} />
                            <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{vnet?.alias || id}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>{(vnet && sdnSegmentLabel(vnet)) || '—'}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip size="small" label={vmCount} sx={{ minWidth: 32, fontWeight: 700, fontSize: 12 }} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}

        {/* VLANs list */}
        <Stack spacing={1.5}>
          {vlans.map(([tag, data]) => (
            <Card
              key={String(tag)}
              variant="outlined"
              sx={{ borderRadius: 2, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
              onClick={() => onSelect?.({ type: 'net-vlan', id: `${connId}:${nodeName}:${tag}` })}
            >
              <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
                <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className={tag === 'untagged' ? 'ri-link-unlink' : 'ri-wifi-line'} style={{ fontSize: 16, opacity: 0.7 }} />
                  <Typography fontWeight={800} sx={{ fontSize: 14 }}>
                    {tag === 'untagged' ? 'Untagged' : `VLAN ${tag}`}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <Chip size="small" label={`${data.vms.length} VM${data.vms.length > 1 ? 's' : ''}`} sx={{ fontSize: 11, height: 22 }} />
                  {Array.from(data.bridges).map(br => (
                    <Chip key={br} size="small" variant="outlined" label={bridgeLabel(vnetAliases, br)} sx={{ fontSize: 11, height: 22 }} />
                  ))}
                </Box>
                <Box>
                  {data.vms.slice(0, 5).map(vm => (
                    <Box key={vm.vmid} sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                      <StatusIcon status={vm.status} type="vm" vmType={vm.type} size={16} />
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{vm.name}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.4, fontSize: 10 }}>{vm.vmid}</Typography>
                    </Box>
                  ))}
                  {data.vms.length > 5 && (
                    <Box sx={{ px: 2, py: 0.5 }}>
                      <Typography variant="caption" sx={{ opacity: 0.4 }}>+{data.vms.length - 5} more...</Typography>
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Box>
    )
  }

  // --- NET-VLAN: VLAN detail view ---
  if (selection.type === 'net-vlan' && nodeName && vlanTag !== undefined) {
    const isUntagged = vlanTag === 'untagged'
    const nodeVms = netData.filter(vm => vm.node === nodeName)
    const vlanVms: { vm: VmNet; net: NetIface }[] = []
    for (const vm of nodeVms) {
      for (const net of vm.nets) {
        if (sdnByVnet.has(net.bridge)) continue
        const tag = net.tag ?? 'untagged'
        if (String(tag) === vlanTag) {
          vlanVms.push({ vm, net })
        }
      }
    }
    // Bridges used by the VMs in this VLAN only (no host-bridge seeding)
    const bridges = [...new Set(vlanVms.map(v => v.net.bridge))]
    // Host VLAN sub-interface(s) that define this VLAN on the node. A VLAN can
    // exist here with zero VMs (issue #542) — surface the interface so the view
    // is informative instead of blank.
    const hostVlanIfaces = isUntagged
      ? []
      : hostVlans.filter(v => v.node === nodeName && String(v.tag) === vlanTag)

    return (
      <Box sx={{ p: 2.5 }}>
        {/* Header breadcrumb */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip size="small" label="NETWORK" icon={<i className="ri-global-line" style={{ fontSize: 14, marginLeft: 8 }} />} />
          <Typography
            variant="body2"
            sx={{ opacity: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
            onClick={() => onSelect?.({ type: 'net-conn', id: connId })}
          >
            {connName}
          </Typography>
          <i className="ri-arrow-right-s-line" style={{ opacity: 0.3 }} />
          <Typography
            variant="body2"
            sx={{ opacity: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.8 }, display: 'flex', alignItems: 'center', gap: 0.5 }}
            onClick={() => onSelect?.({ type: 'net-node', id: `${connId}:${nodeName}` })}
          >
            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} />
            {nodeName}
          </Typography>
          <i className="ri-arrow-right-s-line" style={{ opacity: 0.3 }} />
          <Typography variant="h6" fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <i className={isUntagged ? 'ri-link-unlink' : 'ri-wifi-line'} style={{ fontSize: 18, opacity: 0.7 }} />
            {isUntagged ? 'Untagged' : `VLAN ${vlanTag}`}
          </Typography>
        </Box>

        {/* KPIs */}
        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          {[
            { label: 'VMs', value: new Set(vlanVms.map(v => v.vm.vmid)).size, icon: 'ri-computer-line' },
            { label: 'Interfaces', value: vlanVms.length, icon: 'ri-plug-line' },
            { label: 'Bridges', value: bridges.length, icon: 'ri-git-branch-line' },
          ].map(kpi => (
            <Card key={kpi.label} variant="outlined" sx={{ flex: 1, minWidth: 100, borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                  <i className={kpi.icon} style={{ fontSize: 18, color: theme.palette.primary.main }} />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1.2 }}>{kpi.value}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>{kpi.label}</Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>

        {/* Bridges */}
        {bridges.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            {bridges.map(br => (
              <Chip key={br} variant="outlined" label={bridgeLabel(vnetAliases, br)} sx={{ fontWeight: 600 }} />
            ))}
          </Box>
        )}

        {/* Host VLAN interface(s) — the sub-interface(s) that define this VLAN on the node */}
        {hostVlanIfaces.length > 0 && (
          <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-router-line" style={{ fontSize: 18, opacity: 0.7 }} />
                  Host interface
                </Typography>
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Interface</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>IP / CIDR</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Active</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {hostVlanIfaces.map(v => (
                      <TableRow key={v.iface}>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <i className="ri-wifi-line" style={{ fontSize: 14, opacity: 0.6 }} />
                            <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{v.iface}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.7 }}>{v.cidr || '—'}</Typography>
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={v.active ? 'Yes' : 'No'} color={v.active ? 'success' : 'default'} sx={{ height: 20, fontSize: 10 }} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}

        {/* VM table */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-computer-line" style={{ fontSize: 18, opacity: 0.7 }} />{' '}
                Virtual Machines
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VM</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VMID</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Interface</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Bridge</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Model</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>MAC</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Firewall</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {vlanVms.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8}>
                        <Typography variant="body2" sx={{ py: 1, textAlign: 'center', opacity: 0.5 }}>
                          {hostVlanIfaces.length > 0
                            ? 'This VLAN is configured on the host but has no attached VM.'
                            : 'No VMs on this VLAN.'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                  {vlanVms.map(({ vm, net }, idx) => (
                    <TableRow
                      key={`${vm.vmid}-${net.id}-${idx}`}
                      hover
                      sx={{ cursor: 'pointer' }}
                      onClick={() => {
                        const vmKey = `${vm.connId || connId}:${vm.node}:${vm.type}:${vm.vmid}`
                        onSelect?.({ type: 'vm', id: vmKey })
                      }}
                    >
                      <TableCell>
                        <StatusIcon status={vm.status} type="vm" vmType={vm.type} size={16} />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{vm.name}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.6 }}>{vm.vmid}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12 }}>{net.id}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={bridgeLabel(vnetAliases, net.bridge)} variant="outlined" sx={{ fontSize: 11, height: 22 }} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.6 }}>{net.model}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 11, opacity: 0.6 }}>{net.macaddr || '—'}</Typography>
                      </TableCell>
                      <TableCell>
                        {net.firewall ? (
                          <i className="ri-shield-check-fill" style={{ fontSize: 14, color: theme.palette.success.main }} />
                        ) : (
                          <i className="ri-shield-line" style={{ fontSize: 14, opacity: 0.2 }} />
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>
    )
  }

  // --- NET-VNET: SDN VNet detail view ---
  if (selection.type === 'net-vnet' && nodeName && vnetId) {
    const vnet = sdnByVnet.get(vnetId)
    const nodeVms = netData.filter(vm => vm.node === nodeName)
    const vnetVms: { vm: VmNet; net: NetIface }[] = []
    for (const vm of nodeVms) {
      for (const net of vm.nets) {
        if (net.bridge === vnetId) vnetVms.push({ vm, net })
      }
    }
    const seg = vnet ? sdnSegmentLabel(vnet) : ''
    return (
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip size="small" label="NETWORK" icon={<i className="ri-global-line" style={{ fontSize: 14, marginLeft: 8 }} />} />
          <Typography variant="body2" sx={{ opacity: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.8 } }} onClick={() => onSelect?.({ type: 'net-conn', id: connId })}>{connName}</Typography>
          <i className="ri-arrow-right-s-line" style={{ opacity: 0.3 }} />
          <Typography variant="body2" sx={{ opacity: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.8 }, display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={() => onSelect?.({ type: 'net-node', id: `${connId}:${nodeName}` })}>
            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} />
            {nodeName}
          </Typography>
          <i className="ri-arrow-right-s-line" style={{ opacity: 0.3 }} />
          <Typography variant="h6" fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <i className="ri-git-branch-line" style={{ fontSize: 18, opacity: 0.7 }} />
            {vnet?.alias || vnetId}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          {[
            { label: 'VMs', value: new Set(vnetVms.map(v => v.vm.vmid)).size, icon: 'ri-computer-line' },
            { label: 'Zone type', value: vnet?.zoneType || '—', icon: 'ri-stack-line' },
            { label: seg ? seg.split(' ')[0] : 'Segment', value: seg ? seg.split(' ')[1] : '—', icon: 'ri-router-line' },
          ].map(kpi => (
            <Card key={kpi.label} variant="outlined" sx={{ flex: 1, minWidth: 100, borderRadius: 2 }}>
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ width: 36, height: 36, borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: alpha(theme.palette.primary.main, 0.1) }}>
                  <i className={kpi.icon} style={{ fontSize: 18, color: theme.palette.primary.main }} />
                </Box>
                <Box>
                  <Typography variant="h6" fontWeight={900} sx={{ lineHeight: 1.2 }}>{kpi.value}</Typography>
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>{kpi.label}</Typography>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>

        {vnet && (
          <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
                <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-stack-line" style={{ fontSize: 18, opacity: 0.7 }} /> Zone
                </Typography>
              </Box>
              <Box sx={{ px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Typography variant="body2" sx={{ fontSize: 12 }}>Zone: {vnet.zone || '—'} {vnet.zoneType ? `(${vnet.zoneType})` : ''}</Typography>
                {seg && <Typography variant="body2" sx={{ fontSize: 12 }}>{seg}</Typography>}
                {vnet.peers && vnet.peers.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontSize: 12 }}>Peers:</Typography>
                    {vnet.peers.map(p => <Chip key={p} size="small" variant="outlined" label={p} sx={{ fontSize: 11, height: 22 }} />)}
                  </Box>
                )}
              </Box>
            </CardContent>
          </Card>
        )}

        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-computer-line" style={{ fontSize: 18, opacity: 0.7 }} /> Virtual Machines
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VM</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VMID</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Interface</TableCell>
                    <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>MAC</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {vnetVms.length === 0 && (
                    <TableRow><TableCell colSpan={5}>
                      <Typography variant="body2" sx={{ py: 1, textAlign: 'center', opacity: 0.5 }}>No VMs on this VNet.</Typography>
                    </TableCell></TableRow>
                  )}
                  {vnetVms.map(({ vm, net }, idx) => (
                    <TableRow key={`${vm.vmid}-${net.id}-${idx}`} hover sx={{ cursor: 'pointer' }} onClick={() => onSelect?.({ type: 'vm', id: `${vm.connId || connId}:${vm.node}:${vm.type}:${vm.vmid}` })}>
                      <TableCell><StatusIcon status={vm.status} type="vm" vmType={vm.type} size={16} /></TableCell>
                      <TableCell><Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{vm.name}</Typography></TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontSize: 12, opacity: 0.6 }}>{vm.vmid}</Typography></TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontSize: 12 }}>{net.id}</Typography></TableCell>
                      <TableCell><Typography variant="body2" sx={{ fontSize: 11, opacity: 0.6 }}>{net.macaddr || '—'}</Typography></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>
      </Box>
    )
  }

  // --- NET-BRIDGE: Host bridge detail view ---
  if (selection.type === 'net-bridge' && bridgeNode && bridgeIface) {
    const bridge = hostBridges.find(b => b.node === bridgeNode && b.iface === bridgeIface)
    // Find VMs attached to this bridge on this node
    const bridgeVms: { vm: VmNet; net: NetIface }[] = []
    for (const vm of netData) {
      if (vm.node !== bridgeNode) continue
      for (const net of vm.nets) {
        if (net.bridge === bridgeIface) {
          bridgeVms.push({ vm, net })
        }
      }
    }

    return (
      <Box sx={{ p: 2.5 }}>
        {/* Breadcrumb header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip size="small" label="NETWORK" icon={<i className="ri-global-line" style={{ fontSize: 14, marginLeft: 8 }} />} />
          <Typography
            variant="body2"
            sx={{ opacity: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
            onClick={() => onSelect?.({ type: 'net-conn', id: connId })}
          >
            {connName}
          </Typography>
          <i className="ri-arrow-right-s-line" style={{ opacity: 0.3 }} />
          <Typography
            variant="body2"
            sx={{ opacity: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.8 }, display: 'flex', alignItems: 'center', gap: 0.5 }}
            onClick={() => onSelect?.({ type: 'net-node', id: `${connId}:${bridgeNode}` })}
          >
            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" width={14} height={14} />
            {bridgeNode}
          </Typography>
          <i className="ri-arrow-right-s-line" style={{ opacity: 0.3 }} />
          <Typography variant="h6" fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <i className="ri-share-line" style={{ fontSize: 18, opacity: 0.7 }} />
            {bridgeLabel(vnetAliases, bridgeIface)}
          </Typography>
        </Box>

        {/* Details card */}
        <Card variant="outlined" sx={{ borderRadius: 2, mb: 2 }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-share-line" style={{ fontSize: 18, opacity: 0.7 }} />
                Bridge Details
              </Typography>
            </Box>
            {!bridge ? (
              <Box sx={{ px: 2, py: 2 }}>
                <Typography variant="body2" sx={{ opacity: 0.5 }}>Bridge details unavailable.</Typography>
              </Box>
            ) : (
              <Table size="small">
                <TableBody>
                  {[
                    { label: 'Type', value: bridge.type },
                    { label: 'VLAN', value: bridge.tag != null ? `VLAN ${bridge.tag}` : 'Untagged' },
                    { label: 'IP / CIDR', value: bridge.cidr || '—' },
                    { label: 'Ports / Uplinks', value: bridge.ports || '—' },
                    { label: 'VLAN-aware', value: bridge.vlanAware ? 'Yes' : 'No' },
                    { label: 'Active', value: bridge.active ? 'Yes' : 'No' },
                    { label: 'Autostart', value: bridge.autostart ? 'Yes' : 'No' },
                    ...(bridgeLabel(vnetAliases, bridgeIface!) !== bridgeIface
                      ? [{ label: 'VNet ID', value: bridgeIface! }]
                      : []),
                  ].map(({ label, value }) => (
                    <TableRow key={label}>
                      <TableCell sx={{ fontWeight: 600, fontSize: 12, width: 160, opacity: 0.6, borderBottom: 'none', py: 0.75 }}>{label}</TableCell>
                      <TableCell sx={{ fontSize: 12, borderBottom: 'none', py: 0.75 }}>{value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Attached VMs table */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-computer-line" style={{ fontSize: 18, opacity: 0.7 }} />{' '}
                Virtual Machines
              </Typography>
            </Box>
            {bridgeVms.length === 0 ? (
              <Box sx={{ px: 2, py: 2 }}>
                <Typography variant="body2" sx={{ opacity: 0.5 }}>No VMs attached to this bridge.</Typography>
              </Box>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VM</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>VMID</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Interface</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Model</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>MAC</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: 12 }}>Firewall</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {bridgeVms.map(({ vm, net }, idx) => (
                      <TableRow
                        key={`${vm.vmid}-${net.id}-${idx}`}
                        hover
                        sx={{ cursor: 'pointer' }}
                        onClick={() => {
                          const vmKey = `${vm.connId || connId}:${vm.node}:${vm.type}:${vm.vmid}`
                          onSelect?.({ type: 'vm', id: vmKey })
                        }}
                      >
                        <TableCell>
                          <StatusIcon status={vm.status} type="vm" vmType={vm.type} size={16} />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{vm.name}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.6 }}>{vm.vmid}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 12 }}>{net.id}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.6 }}>{net.model}</Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontSize: 11, opacity: 0.6 }}>{net.macaddr || '—'}</Typography>
                        </TableCell>
                        <TableCell>
                          {net.firewall ? (
                            <i className="ri-shield-check-fill" style={{ fontSize: 14, color: theme.palette.success.main }} />
                          ) : (
                            <i className="ri-shield-line" style={{ fontSize: 14, opacity: 0.2 }} />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>
      </Box>
    )
  }

  return null
}
