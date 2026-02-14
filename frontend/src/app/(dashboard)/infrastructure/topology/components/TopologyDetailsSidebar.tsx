'use client'

import { useState, useMemo, useEffect } from 'react'

import { Box, Typography, IconButton, Divider, LinearProgress, Button, Paper, CircularProgress, Collapse } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { useTheme } from '@mui/material/styles'

import type {
  SelectedNodeInfo,
  ClusterNodeData,
  HostNodeData,
  VmNodeData,
  VmSummaryNodeData,
  VlanGroupNodeData,
  VlanContainerNodeData,
  TagGroupNodeData,
  ProxCenterNodeData,
  InventoryCluster,
  InventoryGuest,
} from '../types'
import { getStatusColor, getVmStatusColor, getResourceStatus } from '../lib/topologyColors'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'

import { fetchRrd, buildSeriesFromRrd, formatTime } from '../../inventory/helpers'
import { AreaPctChart, AreaBpsChart2 } from '../../inventory/components/RrdCharts'
import type { SeriesPoint } from '../../inventory/types'

interface TopologyDetailsSidebarProps {
  node: SelectedNodeInfo
  onClose: () => void
  connections: InventoryCluster[]
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)

  if (days > 0) return `${days}d ${hours}h`

  const minutes = Math.floor((seconds % 3600) / 60)

  return `${hours}h ${minutes}m`
}

function UsageBar({ label, value, statusColor }: { label: string; value: number; statusColor: string }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant='caption' color='text.secondary'>
          {label}
        </Typography>
        <Typography variant='caption' fontWeight={600}>
          {(value * 100).toFixed(1)}%
        </Typography>
      </Box>
      <LinearProgress
        variant='determinate'
        value={Math.min(value * 100, 100)}
        sx={{
          height: 6,
          borderRadius: 3,
          bgcolor: 'action.hover',
          '& .MuiLinearProgress-bar': {
            bgcolor: statusColor,
            borderRadius: 3,
          },
        }}
      />
    </Box>
  )
}

function MiniUsageBar({ value, color }: { value: number; color: string }) {
  return (
    <LinearProgress
      variant='determinate'
      value={Math.min(value * 100, 100)}
      sx={{
        height: 3,
        borderRadius: 1.5,
        bgcolor: 'action.hover',
        flex: 1,
        '& .MuiLinearProgress-bar': {
          bgcolor: color,
          borderRadius: 1.5,
        },
      }}
    />
  )
}

/* ------------------------------------------------------------------ */
/* RRD Charts for a VM (used in both VmRrdDetail and VmDetails)       */
/* ------------------------------------------------------------------ */

function VmRrdCharts({ connectionId, nodeName, vmType, vmid }: {
  connectionId: string
  nodeName: string
  vmType: string
  vmid: number
}) {
  const t = useTranslations('topology')
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    const type = vmType === 'lxc' ? 'lxc' : 'qemu'
    const path = `/nodes/${nodeName}/${type}/${vmid}`

    fetchRrd(connectionId, path, 'hour')
      .then(raw => {
        if (cancelled) return
        setSeries(buildSeriesFromRrd(raw))
      })
      .catch(() => {
        if (!cancelled) setSeries([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [connectionId, nodeName, vmType, vmid])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    )
  }

  if (series.length === 0) {
    return (
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', textAlign: 'center', py: 1 }}>
        {t('noRrdData')}
      </Typography>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
      <AreaPctChart title={t('cpuUsage')} data={series} dataKey='cpuPct' color='#2196f3' height={140} />
      <AreaPctChart title={t('ramUsage')} data={series} dataKey='ramPct' color='#9c27b0' height={140} />
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* RRD Charts for a Host node                                         */
/* ------------------------------------------------------------------ */

function HostRrdCharts({ connectionId, nodeName }: {
  connectionId: string
  nodeName: string
}) {
  const t = useTranslations('topology')
  const theme = useTheme()
  const [series, setSeries] = useState<SeriesPoint[]>([])
  const [loading, setLoading] = useState(true)
  const isDark = theme.palette.mode === 'dark'
  const tooltipStyle = { backgroundColor: isDark ? '#1e1e2d' : '#fff', border: `1px solid ${isDark ? '#444' : '#ccc'}`, color: isDark ? '#e7e3fc' : '#333', borderRadius: 8 }
  const tooltipLabelStyle = { color: isDark ? '#e7e3fc' : '#333' }

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetchRrd(connectionId, `/nodes/${nodeName}`, 'hour')
      .then(raw => {
        if (cancelled) return
        setSeries(buildSeriesFromRrd(raw))
      })
      .catch(() => {
        if (!cancelled) setSeries([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [connectionId, nodeName])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    )
  }

  if (series.length === 0) {
    return (
      <Typography variant='caption' color='text.secondary' sx={{ display: 'block', textAlign: 'center', py: 1 }}>
        {t('noRrdData')}
      </Typography>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
      <AreaPctChart title={t('cpuUsage')} data={series} dataKey='cpuPct' color='#2196f3' height={130} />
      <AreaPctChart title={t('ramUsage')} data={series} dataKey='ramPct' color='#9c27b0' height={130} />
      <AreaBpsChart2
        title={t('networkTraffic')}
        data={series}
        keyA='netInBps'
        keyB='netOutBps'
        labelA='In'
        labelB='Out'
        height={130}
      />
      {/* Server Load chart (not percentage, auto domain) */}
      <Box>
        <Typography fontWeight={700} fontSize={13} sx={{ mb: 0.5 }}>
          {t('serverLoad')}
        </Typography>
        <Box sx={{ width: '100%', height: 130 }}>
          <ResponsiveContainer width='100%' height='100%'>
            <AreaChart data={series}>
              <XAxis dataKey='t' tickFormatter={v => formatTime(Number(v))} minTickGap={24} tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} width={35} />
              <Tooltip
                contentStyle={tooltipStyle}
                labelStyle={tooltipLabelStyle}
                itemStyle={tooltipLabelStyle}
                labelFormatter={v => new Date(Number(v)).toLocaleString()}
                formatter={(v: any) => {
                  const n = Number(v)
                  return [Number.isFinite(n) ? n.toFixed(2) : '—', '']
                }}
              />
              <Area
                type='monotone'
                dataKey='loadAvg'
                dot={false}
                stroke='#ff9800'
                fill='#ff9800'
                fillOpacity={0.18}
                strokeWidth={2}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      </Box>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Collapsible section header                                         */
/* ------------------------------------------------------------------ */

function CollapsibleSection({ title, defaultExpanded = true, children }: {
  title: string
  defaultExpanded?: boolean
  children: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <Box>
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          cursor: 'pointer',
          py: 0.5,
          '&:hover': { opacity: 0.8 },
        }}
      >
        <i
          className={expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'}
          style={{ fontSize: 16, color: 'inherit' }}
        />
        <Typography variant='caption' fontWeight={600} color='text.secondary'>
          {title}
        </Typography>
      </Box>
      <Collapse in={expanded}>
        {children}
      </Collapse>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* VM detail view (shown when clicking a VM from the host VM list)    */
/* ------------------------------------------------------------------ */

function VmRrdDetail({ guest, connectionId, nodeName, onBack }: {
  guest: InventoryGuest
  connectionId: string
  nodeName: string
  onBack: () => void
}) {
  const t = useTranslations('topology')
  const router = useRouter()
  const vmid = typeof guest.vmid === 'string' ? parseInt(guest.vmid, 10) : guest.vmid
  const vmType = guest.type || 'qemu'
  const statusColor = getVmStatusColor(guest.status)
  const isRunning = guest.status === 'running'
  const cpuUsage = (guest.maxcpu || 0) > 0 ? (guest.cpu || 0) / (guest.maxcpu || 1) : 0
  const ramUsage = (guest.maxmem || 0) > 0 ? (guest.mem || 0) / (guest.maxmem || 1) : 0

  return (
    <>
      <Button
        size='small'
        startIcon={<i className='ri-arrow-left-line' style={{ fontSize: 14 }} />}
        onClick={onBack}
        sx={{ mb: 1, textTransform: 'none', justifyContent: 'flex-start', px: 0.5 }}
      >
        {t('backToHost')}
      </Button>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <i
          className={vmType === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
          style={{ fontSize: 20, color: statusColor }}
        />
        <Typography variant='subtitle1' fontWeight={700}>
          {guest.name || `VM ${vmid}`}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
        <Typography variant='caption' color='text.secondary'>
          VMID: <strong>{vmid}</strong>
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          Type: <strong>{vmType.toUpperCase()}</strong>
        </Typography>
        <Typography variant='caption' sx={{ color: statusColor, fontWeight: 600 }}>
          {guest.status}
        </Typography>
      </Box>

      <Divider sx={{ mb: 1.5 }} />

      <UsageBar
        label={t('cpuUsage')}
        value={cpuUsage}
        statusColor={getStatusColor(getResourceStatus(cpuUsage, isRunning))}
      />
      <UsageBar
        label={t('ramUsage')}
        value={ramUsage}
        statusColor={getStatusColor(getResourceStatus(ramUsage, isRunning))}
      />

      {isRunning && (
        <VmRrdCharts connectionId={connectionId} nodeName={nodeName} vmType={vmType} vmid={vmid} />
      )}

      <Box sx={{ mt: 2 }}>
        <Button
          size='small'
          variant='outlined'
          fullWidth
          startIcon={<i className='ri-arrow-right-line' style={{ fontSize: 16 }} />}
          onClick={() => router.push(`/infrastructure/inventory?vmid=${vmid}&connId=${encodeURIComponent(connectionId)}&node=${encodeURIComponent(nodeName)}&type=${encodeURIComponent(vmType)}`)}
        >
          {t('viewInInventory')}
        </Button>
      </Box>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Section components                                                 */
/* ------------------------------------------------------------------ */

function ClusterDetails({ data }: { data: ClusterNodeData }) {
  const t = useTranslations('topology')

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <i className='ri-server-line' style={{ fontSize: 20, color: getStatusColor(data.status) }} />
        <Typography variant='subtitle1' fontWeight={700}>
          {data.label}
        </Typography>
      </Box>
      <Typography variant='caption' color='text.secondary' display='block' sx={{ mb: 1.5 }}>
        {data.host}
      </Typography>
      <Divider sx={{ mb: 1.5 }} />
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('nodes')}
          </Typography>
          <Typography variant='h6' fontWeight={700}>
            {data.nodeCount}
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('vms')}
          </Typography>
          <Typography variant='h6' fontWeight={700}>
            {data.vmCount}
          </Typography>
        </Box>
      </Box>
      <UsageBar
        label={t('cpuUsage')}
        value={data.cpuUsage}
        statusColor={getStatusColor(getResourceStatus(data.cpuUsage, data.status !== 'offline'))}
      />
      <UsageBar
        label={t('ramUsage')}
        value={data.ramUsage}
        statusColor={getStatusColor(getResourceStatus(data.ramUsage, data.status !== 'offline'))}
      />
    </>
  )
}

function HostDetails({ data, connections }: { data: HostNodeData; connections: InventoryCluster[] }) {
  const t = useTranslations('topology')
  const [selectedGuest, setSelectedGuest] = useState<InventoryGuest | null>(null)

  // Look up guests from connections data
  const guests = useMemo(() => {
    const cluster = connections.find(c => c.id === data.connectionId)

    if (!cluster) return []
    const node = cluster.nodes.find(n => n.node === data.nodeName)

    return node?.guests || []
  }, [connections, data.connectionId, data.nodeName])

  // If a guest is selected, show VM RRD detail
  if (selectedGuest) {
    return (
      <VmRrdDetail
        guest={selectedGuest}
        connectionId={data.connectionId}
        nodeName={data.nodeName}
        onBack={() => setSelectedGuest(null)}
      />
    )
  }

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: getStatusColor(data.status),
          }}
        />
        <Typography variant='subtitle1' fontWeight={700}>
          {data.label}
        </Typography>
      </Box>
      <Divider sx={{ mb: 1.5 }} />

      {/* Stats row */}
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('uptime')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {formatUptime(data.uptime)}
          </Typography>
        </Box>
      </Box>

      {/* Performance section (collapsible) */}
      <CollapsibleSection title={t('performance')}>
        <HostRrdCharts connectionId={data.connectionId} nodeName={data.nodeName} />
      </CollapsibleSection>

      {/* VM list section (collapsible) */}
      {guests.length > 0 && (
        <>
          <Divider sx={{ my: 1.5 }} />
          <CollapsibleSection title={`${t('virtualMachines')} (${guests.length})`}>
            <Box sx={{ maxHeight: 300, overflow: 'auto', mx: -0.5 }}>
              {guests.map(guest => {
                const vmid = typeof guest.vmid === 'string' ? parseInt(guest.vmid, 10) : guest.vmid
                const isRunning = guest.status === 'running'
                const cpuUsage = (guest.maxcpu || 0) > 0 ? (guest.cpu || 0) / (guest.maxcpu || 1) : 0
                const ramUsage = (guest.maxmem || 0) > 0 ? (guest.mem || 0) / (guest.maxmem || 1) : 0

                return (
                  <Box
                    key={`${guest.type}-${vmid}`}
                    onClick={() => setSelectedGuest(guest)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      py: 0.75,
                      px: 0.5,
                      borderRadius: 1,
                      cursor: 'pointer',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    {/* Status dot */}
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: getVmStatusColor(guest.status),
                        flexShrink: 0,
                      }}
                    />

                    {/* Type icon */}
                    <i
                      className={guest.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
                      style={{ fontSize: 14, color: getVmStatusColor(guest.status), flexShrink: 0 }}
                    />

                    {/* Name + VMID */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant='caption' fontWeight={600} noWrap sx={{ display: 'block', lineHeight: 1.3 }}>
                        {guest.name || `VM ${vmid}`}
                      </Typography>
                      <Typography variant='caption' color='text.secondary' sx={{ fontSize: 10 }}>
                        #{vmid}
                      </Typography>
                    </Box>

                    {/* Mini CPU/RAM bars */}
                    {isRunning && (
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, width: 50, flexShrink: 0 }}>
                        <MiniUsageBar
                          value={cpuUsage}
                          color={getStatusColor(getResourceStatus(cpuUsage, true))}
                        />
                        <MiniUsageBar
                          value={ramUsage}
                          color={getStatusColor(getResourceStatus(ramUsage, true))}
                        />
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>
          </CollapsibleSection>
        </>
      )}
    </>
  )
}

function VmDetails({ data }: { data: VmNodeData }) {
  const t = useTranslations('topology')
  const statusColor = getVmStatusColor(data.vmStatus)

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <i
          className={data.vmType === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
          style={{ fontSize: 20, color: statusColor }}
        />
        <Typography variant='subtitle1' fontWeight={700}>
          {data.label}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
        <Typography variant='caption' color='text.secondary'>
          VMID: <strong>{data.vmid}</strong>
        </Typography>
        <Typography variant='caption' color='text.secondary'>
          Type: <strong>{data.vmType.toUpperCase()}</strong>
        </Typography>
        <Typography variant='caption' sx={{ color: statusColor, fontWeight: 600 }}>
          {data.vmStatus}
        </Typography>
      </Box>
      <Divider sx={{ mb: 1.5 }} />

      {/* RRD Charts */}
      {data.vmStatus === 'running' && (
        <VmRrdCharts
          connectionId={data.connectionId}
          nodeName={data.nodeName}
          vmType={data.vmType}
          vmid={data.vmid}
        />
      )}
    </>
  )
}

function VmSummaryDetails({ data }: { data: VmSummaryNodeData }) {
  const t = useTranslations('topology')

  return (
    <>
      <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 1.5 }}>
        {t('vmCount', { count: data.total })}
      </Typography>
      <Typography variant='caption' color='text.secondary' display='block' sx={{ mb: 0.5 }}>
        {t('host')}: <strong>{data.nodeName}</strong>
      </Typography>
      <Divider sx={{ mb: 1.5 }} />
      <Box sx={{ display: 'flex', gap: 3 }}>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('running')}
          </Typography>
          <Typography variant='h6' fontWeight={700} color='success.main'>
            {data.running}
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('stopped')}
          </Typography>
          <Typography variant='h6' fontWeight={700} color='error.main'>
            {data.stopped}
          </Typography>
        </Box>
      </Box>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* VLAN Group details                                                 */
/* ------------------------------------------------------------------ */

function VlanGroupDetails({ data }: { data: VlanGroupNodeData }) {
  const t = useTranslations('topology')

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <i className='ri-router-line' style={{ fontSize: 20, color: '#1976d2' }} />
        <Typography variant='subtitle1' fontWeight={700}>
          {data.vlanTag != null ? `${t('vlan')} ${data.vlanTag}` : t('noVlan')}
        </Typography>
      </Box>
      <Divider sx={{ mb: 1.5 }} />
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('bridge')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {data.bridge}
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('vms')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {data.vmCount}
          </Typography>
        </Box>
      </Box>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* VLAN Container details (network view)                              */
/* ------------------------------------------------------------------ */

function VlanContainerDetails({ data }: { data: VlanContainerNodeData }) {
  const t = useTranslations('topology')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <i className='ri-router-line' style={{ fontSize: 20, color: '#1976d2' }} />
        <Typography variant='subtitle1' fontWeight={700}>
          {data.vlanTag != null ? `${t('vlan')} ${data.vlanTag}` : t('noVlan')}
        </Typography>
      </Box>
      <Divider sx={{ mb: 1.5 }} />
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('bridge')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {data.bridge}
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('vms')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {data.vms.length}
          </Typography>
        </Box>
      </Box>
      {data.subnet && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant='caption' color='text.secondary'>
            Subnet
          </Typography>
          <Typography variant='body2' fontWeight={600} fontFamily='JetBrains Mono, monospace'>
            {data.subnet}
          </Typography>
        </Box>
      )}
      <Divider sx={{ mb: 1 }} />
      <Typography variant='caption' fontWeight={600} color='text.secondary' sx={{ mb: 0.5, display: 'block' }}>
        {t('virtualMachines')}
      </Typography>
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {data.vms.map((vm) => (
          <Box
            key={`${vm.nodeName}-${vm.vmid}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              py: 0.5,
              px: 0.25,
              borderRadius: 1,
            }}
          >
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: getVmStatusColor(vm.vmStatus),
                flexShrink: 0,
              }}
            />
            <i
              className={vm.vmType === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'}
              style={{ fontSize: 14, color: getVmStatusColor(vm.vmStatus), flexShrink: 0 }}
            />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant='caption' fontWeight={600} noWrap sx={{ display: 'block', lineHeight: 1.3 }}>
                {vm.name}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                <Typography variant='caption' color='text.secondary' sx={{ fontSize: 10 }}>
                  #{vm.vmid}
                </Typography>
                {vm.ip && (
                  <Typography variant='caption' fontFamily='JetBrains Mono, monospace' sx={{ fontSize: 10, color: 'primary.main' }}>
                    {vm.ip}
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/* ------------------------------------------------------------------ */
/* Tag Group details                                                  */
/* ------------------------------------------------------------------ */

function TagGroupDetails({ data }: { data: TagGroupNodeData }) {
  const t = useTranslations('topology')

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <i className='ri-price-tag-3-line' style={{ fontSize: 20, color: '#7b1fa2' }} />
        <Typography variant='subtitle1' fontWeight={700}>
          {data.tag === '__none__' ? t('noTag') : data.label}
        </Typography>
      </Box>
      <Divider sx={{ mb: 1.5 }} />
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('host')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {data.nodeName}
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('vms')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {data.vmCount}
          </Typography>
        </Box>
      </Box>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* ProxCenter root node details                                       */
/* ------------------------------------------------------------------ */

function ProxCenterDetails({ data }: { data: ProxCenterNodeData }) {
  const t = useTranslations('topology')

  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <i className='ri-dashboard-3-line' style={{ fontSize: 20, color: '#F29221' }} />
        <Typography variant='subtitle1' fontWeight={700}>
          {data.label}
        </Typography>
      </Box>
      <Divider sx={{ mb: 1.5 }} />
      <Box sx={{ display: 'flex', gap: 3, mb: 1.5 }}>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('totalClusters')}
          </Typography>
          <Typography variant='h6' fontWeight={700}>
            {data.clusterCount}
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('nodes')}
          </Typography>
          <Typography variant='h6' fontWeight={700}>
            {data.totalNodes}
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('vms')}
          </Typography>
          <Typography variant='h6' fontWeight={700}>
            {data.totalVms}
          </Typography>
        </Box>
      </Box>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Deep-link URL builder                                              */
/* ------------------------------------------------------------------ */

function getInventoryUrl(node: SelectedNodeInfo): string {
  const base = '/infrastructure/inventory'

  switch (node.type) {
    case 'vm': {
      const d = node.data as VmNodeData

      return `${base}?vmid=${d.vmid}&connId=${encodeURIComponent(d.connectionId)}&node=${encodeURIComponent(d.nodeName)}&type=${encodeURIComponent(d.vmType)}`
    }
    case 'host': {
      const d = node.data as HostNodeData

      return `${base}?selectType=node&selectId=${encodeURIComponent(d.connectionId)}:${encodeURIComponent(d.nodeName)}`
    }
    case 'cluster': {
      const d = node.data as ClusterNodeData

      return `${base}?selectType=cluster&selectId=${encodeURIComponent(d.connectionId)}`
    }
    default:
      return base
  }
}

/* ------------------------------------------------------------------ */
/* Main sidebar component                                             */
/* ------------------------------------------------------------------ */

export default function TopologyDetailsSidebar({ node, onClose, connections }: TopologyDetailsSidebarProps) {
  const t = useTranslations('topology')
  const router = useRouter()

  return (
    <Paper
      elevation={4}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        width: 320,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 10,
        borderLeft: '1px solid',
        borderColor: 'divider',
      }}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5 }}>
        <Typography variant='subtitle2' fontWeight={600} color='text.secondary'>
          {t('details')}
        </Typography>
        <IconButton size='small' onClick={onClose}>
          <i className='ri-close-line' style={{ fontSize: 18 }} />
        </IconButton>
      </Box>
      <Divider />

      {/* Content */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2 }}>
        {node.type === 'cluster' && <ClusterDetails data={node.data as ClusterNodeData} />}
        {node.type === 'host' && <HostDetails data={node.data as HostNodeData} connections={connections} />}
        {node.type === 'vm' && <VmDetails data={node.data as VmNodeData} />}
        {node.type === 'vmSummary' && <VmSummaryDetails data={node.data as VmSummaryNodeData} />}
        {node.type === 'vlanGroup' && <VlanGroupDetails data={node.data as VlanGroupNodeData} />}
        {node.type === 'vlanContainer' && <VlanContainerDetails data={node.data as VlanContainerNodeData} />}
        {node.type === 'tagGroup' && <TagGroupDetails data={node.data as TagGroupNodeData} />}
        {node.type === 'proxcenter' && <ProxCenterDetails data={node.data as ProxCenterNodeData} />}
      </Box>

      {/* Footer */}
      {node.type !== 'proxcenter' && node.type !== 'vlanGroup' && node.type !== 'vlanContainer' && node.type !== 'tagGroup' && (
        <>
          <Divider />
          <Box sx={{ px: 2, py: 1.5 }}>
            <Button
              size='small'
              variant='outlined'
              fullWidth
              startIcon={<i className='ri-arrow-right-line' style={{ fontSize: 16 }} />}
              onClick={() => router.push(getInventoryUrl(node))}
            >
              {t('viewInInventory')}
            </Button>
          </Box>
        </>
      )}
    </Paper>
  )
}
