'use client'

import { Box, Typography, IconButton, Divider, LinearProgress, Button, Paper } from '@mui/material'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import type { SelectedNodeInfo, ClusterNodeData, HostNodeData, VmNodeData, VmSummaryNodeData } from '../types'
import { getStatusColor, getVmStatusColor, getResourceStatus } from '../lib/topologyColors'

interface TopologyDetailsSidebarProps {
  node: SelectedNodeInfo
  onClose: () => void
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
    </>
  )
}

function HostDetails({ data }: { data: HostNodeData }) {
  const t = useTranslations('topology')

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
      <Box sx={{ display: 'flex', gap: 3, mt: 1 }}>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('vms')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {data.vmCount}
          </Typography>
        </Box>
        <Box>
          <Typography variant='caption' color='text.secondary'>
            {t('uptime')}
          </Typography>
          <Typography variant='body1' fontWeight={600}>
            {formatUptime(data.uptime)}
          </Typography>
        </Box>
      </Box>
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
      <UsageBar
        label={t('cpuUsage')}
        value={data.cpuUsage}
        statusColor={getStatusColor(getResourceStatus(data.cpuUsage, data.vmStatus === 'running'))}
      />
      <UsageBar
        label={t('ramUsage')}
        value={data.ramUsage}
        statusColor={getStatusColor(getResourceStatus(data.ramUsage, data.vmStatus === 'running'))}
      />
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

export default function TopologyDetailsSidebar({ node, onClose }: TopologyDetailsSidebarProps) {
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
        {node.type === 'host' && <HostDetails data={node.data as HostNodeData} />}
        {node.type === 'vm' && <VmDetails data={node.data as VmNodeData} />}
        {node.type === 'vmSummary' && <VmSummaryDetails data={node.data as VmSummaryNodeData} />}
      </Box>

      {/* Footer */}
      <Divider />
      <Box sx={{ px: 2, py: 1.5 }}>
        <Button
          size='small'
          variant='outlined'
          fullWidth
          startIcon={<i className='ri-arrow-right-line' style={{ fontSize: 16 }} />}
          onClick={() => router.push('/infrastructure/inventory')}
        >
          {t('viewInInventory')}
        </Button>
      </Box>
    </Paper>
  )
}
