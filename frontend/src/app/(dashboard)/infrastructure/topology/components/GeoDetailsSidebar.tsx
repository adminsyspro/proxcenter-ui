'use client'

import { useRouter } from 'next/navigation'

import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

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

function UsageBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography variant='caption' color='text.secondary'>{label}</Typography>
        <Typography variant='caption' fontWeight={600}>{value.toFixed(1)}%</Typography>
      </Box>
      <LinearProgress
        variant='determinate'
        value={Math.min(value, 100)}
        sx={{
          height: 5,
          borderRadius: 2.5,
          bgcolor: 'action.hover',
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 2.5 },
        }}
      />
    </Box>
  )
}

function NodeRow({ node }: { node: InventoryNode }) {
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
        <Box sx={{ display: 'flex', gap: 1.5, pl: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.65rem' }}>CPU</Typography>
              <Typography variant='caption' sx={{ fontSize: '0.65rem' }}>{cpuPct.toFixed(0)}%</Typography>
            </Box>
            <LinearProgress variant='determinate' value={Math.min(cpuPct, 100)} sx={{
              height: 3, borderRadius: 1.5, bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': { bgcolor: getUsageColor(cpuPct), borderRadius: 1.5 },
            }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant='caption' color='text.secondary' sx={{ fontSize: '0.65rem' }}>RAM</Typography>
              <Typography variant='caption' sx={{ fontSize: '0.65rem' }}>{ramPct.toFixed(0)}%</Typography>
            </Box>
            <LinearProgress variant='determinate' value={Math.min(ramPct, 100)} sx={{
              height: 3, borderRadius: 1.5, bgcolor: 'action.hover',
              '& .MuiLinearProgress-bar': { bgcolor: getUsageColor(ramPct), borderRadius: 1.5 },
            }} />
          </Box>
        </Box>
      )}
      {isOnline && node.uptime != null && (
        <Typography variant='caption' color='text.secondary' sx={{ pl: 2, fontSize: '0.65rem' }}>
          Uptime: {formatUptime(node.uptime)}
        </Typography>
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

        {/* Usage bars */}
        <UsageBar label={t('cpuUsage')} value={cpuPct} color={getUsageColor(cpuPct)} />
        <UsageBar label={t('ramUsage')} value={ramPct} color={getUsageColor(ramPct)} />
        {memTotal > 0 && (
          <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: -0.5, mb: 1.5 }}>
            {formatBytes(memUsed)} / {formatBytes(memTotal)}
          </Typography>
        )}

        <Divider sx={{ my: 1.5 }} />

        {/* Nodes list */}
        <Typography variant='caption' fontWeight={600} color='text.secondary' sx={{ mb: 0.5, display: 'block' }}>
          {t('nodes').toUpperCase()} ({totalNodes})
        </Typography>
        <Box sx={{ mb: 1.5 }}>
          {cluster.nodes.map((node) => (
            <NodeRow key={node.node} node={node} />
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

              return (
                <Box
                  key={`${vm.nodeName}-${vm.vmid}`}
                  onClick={() => router.push(`/infrastructure/inventory?connectionId=${cluster.id}&vmid=${vm.vmid}&node=${vm.nodeName}`)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    py: 0.5,
                    px: 0.5,
                    borderRadius: 1,
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                  }}
                >
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
