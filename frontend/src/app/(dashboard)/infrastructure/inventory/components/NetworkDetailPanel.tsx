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

type NetIface = { id: string; model: string; bridge: string; macaddr?: string; tag?: number; firewall?: boolean; rate?: number }
type VmNet = { vmid: string; name: string; node: string; type: string; status: string; connId?: string; nets: NetIface[] }

export default function NetworkDetailPanel({ selection, onSelect }: {
  selection: InventorySelection
  onSelect?: (sel: InventorySelection) => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  const [netData, setNetData] = React.useState<VmNet[]>([])
  const [loading, setLoading] = React.useState(true)

  // Parse selection id
  const parts = selection.id.split(':')
  const connId = parts[0]
  const nodeName = selection.type === 'net-node' || selection.type === 'net-vlan' ? parts[1] : undefined
  const vlanTag = selection.type === 'net-vlan' ? parts[2] : undefined

  React.useEffect(() => {
    if (!connId) return
    setLoading(true)
    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/networks`)
      .then(r => r.json())
      .then(json => setNetData((json.data || []).map((vm: any) => ({ ...vm, connId }))))
      .catch(() => setNetData([]))
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

  if (loading) return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={28} /></Box>

  // --- NET-CONN: Cluster-level network overview ---
  if (selection.type === 'net-conn') {
    const nodeMap = new Map<string, { vlans: Set<string | number>; bridges: Set<string>; vms: Set<string> }>()
    for (const vm of netData) {
      if (!nodeMap.has(vm.node)) nodeMap.set(vm.node, { vlans: new Set(), bridges: new Set(), vms: new Set() })
      const nd = nodeMap.get(vm.node)!
      nd.vms.add(vm.vmid)
      for (const net of vm.nets) {
        nd.bridges.add(net.bridge)
        nd.vlans.add(net.tag ?? 'untagged')
      }
    }
    const nodes = Array.from(nodeMap.entries()).sort((a, b) => a[0].localeCompare(b[0]))
    const totalVlans = new Set(netData.flatMap(vm => vm.nets.map(n => n.tag ?? 'untagged'))).size
    const totalBridges = new Set(netData.flatMap(vm => vm.nets.map(n => n.bridge))).size
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
    const vlanMap = new Map<string | number, { bridges: Set<string>; vms: VmNet[] }>()
    for (const vm of nodeVms) {
      for (const net of vm.nets) {
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
    const totalBridges = new Set(nodeVms.flatMap(vm => vm.nets.map(n => n.bridge))).size

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
                    <Chip key={br} size="small" variant="outlined" label={br} sx={{ fontSize: 11, height: 22, fontFamily: 'JetBrains Mono, monospace' }} />
                  ))}
                </Box>
                <Box>
                  {data.vms.slice(0, 5).map(vm => (
                    <Box key={vm.vmid} sx={{ px: 2, py: 0.5, display: 'flex', alignItems: 'center', gap: 1, '&:hover': { bgcolor: 'action.hover' } }}>
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: vm.status === 'running' ? 'success.main' : 'text.disabled', flexShrink: 0 }} />
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{vm.name}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.4, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>{vm.vmid}</Typography>
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
        const tag = net.tag ?? 'untagged'
        if (String(tag) === vlanTag) {
          vlanVms.push({ vm, net })
        }
      }
    }
    const bridges = [...new Set(vlanVms.map(v => v.net.bridge))]

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
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            {bridges.map(br => (
              <Chip key={br} variant="outlined" label={br} sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }} />
            ))}
          </Box>
        )}

        {/* VM table */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
            <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography fontWeight={900} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-computer-line" style={{ fontSize: 18, opacity: 0.7 }} />
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
                        <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: vm.status === 'running' ? 'success.main' : 'text.disabled' }} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{vm.name}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace', opacity: 0.6 }}>{vm.vmid}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>{net.id}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip size="small" label={net.bridge} variant="outlined" sx={{ fontSize: 11, height: 22, fontFamily: 'JetBrains Mono, monospace' }} />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 12, opacity: 0.6 }}>{net.model}</Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', opacity: 0.6 }}>{net.macaddr || '—'}</Typography>
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

  return null
}
