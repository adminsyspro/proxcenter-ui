'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { formatBytes } from '@/utils/format'
import {
  Box,
  Card,
  CardContent,
  Chip,
  Popover,
  Stack,
  Typography,
  useTheme,
} from '@mui/material'

/* -----------------------------
  Types
------------------------------ */

type VmItem = {
  id: string
  connId: string
  connName: string
  node: string
  vmid: string | number
  name: string
  type: 'qemu' | 'lxc'
  status: string
  cpu?: number
  mem?: number
  maxmem?: number
  template?: boolean
}

type ClusterGroup = {
  connId: string
  connName: string
  vms: VmItem[]
  stats: {
    running: number
    stopped: number
    paused: number
    template: number
    total: number
  }
}

type VmWaffleChartProps = {
  vms: VmItem[]
  cellSize?: number
  gap?: number
  maxColumns?: number
  onVmClick?: (vm: VmItem) => void
  showLegend?: boolean
  compact?: boolean
}

/* -----------------------------
  Helpers
------------------------------ */

const getStatusColor = (status: string, template: boolean | undefined, theme: any): string => {
  if (template) return theme.palette.mode === 'dark' ? '#616161' : '#9e9e9e'

  switch (status) {
    case 'running':
      return theme.palette.success.main
    case 'paused':
    case 'suspended':
      return theme.palette.warning.main
    case 'stopped':
      return theme.palette.error.main
    default:
      return theme.palette.grey[400]
  }
}

const getStatusLabel = (status: string, template: boolean | undefined): string => {
  if (template) return 'Template'
  switch (status) {
    case 'running': return 'Running'
    case 'paused': return 'Paused'
    case 'suspended': return 'Suspended'
    case 'stopped': return 'Stopped'
    default: return status
  }
}

/* -----------------------------
  Sub-components
------------------------------ */

function VmCell({
  vm,
  size,
  onClick,
}: {
  vm: VmItem
  size: number
  onClick?: (vm: VmItem) => void
}) {
  const theme = useTheme()
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)

  const color = getStatusColor(vm.status, vm.template, theme)
  const isRunning = vm.status === 'running'

  const handleMouseEnter = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget)
  }

  const handleMouseLeave = () => {
    setAnchorEl(null)
  }

  const handleClick = () => {
    onClick?.(vm)
  }

  return (
    <>
      <Box
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        sx={{
          width: size,
          height: size,
          bgcolor: color,
          borderRadius: 0.5,
          cursor: onClick ? 'pointer' : 'default',
          transition: 'all 0.15s ease',
          opacity: vm.template ? 0.5 : 1,
          '&:hover': {
            transform: 'scale(1.3)',
            zIndex: 10,
            boxShadow: theme.shadows[4],
          },
        }}
      />
      <Popover
        sx={{ pointerEvents: 'none' }}
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        onClose={handleMouseLeave}
        disableRestoreFocus
      >
        <Box sx={{ p: 1.5, minWidth: 180 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: color,
              }}
            />
            <Typography variant="subtitle2" fontWeight={600}>
              {vm.name || `${vm.type.toUpperCase()} ${vm.vmid}`}
            </Typography>
          </Stack>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {vm.type.toUpperCase()} {vm.vmid} • {vm.node}
          </Typography>

          <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
            Status: <strong>{getStatusLabel(vm.status, vm.template)}</strong>
          </Typography>

          {isRunning && vm.cpu !== undefined && (
            <Typography variant="caption" sx={{ display: 'block' }}>
              CPU: <strong>{(vm.cpu * 100).toFixed(1)}%</strong>
            </Typography>
          )}

          {isRunning && vm.mem !== undefined && vm.maxmem !== undefined && (
            <Typography variant="caption" sx={{ display: 'block' }}>
              RAM: <strong>{formatBytes(vm.mem)}</strong> / {formatBytes(vm.maxmem)}
            </Typography>
          )}
        </Box>
      </Popover>
    </>
  )
}

function ClusterWaffle({
  cluster,
  cellSize,
  gap,
  maxColumns,
  onVmClick,
  compact,
}: {
  cluster: ClusterGroup
  cellSize: number
  gap: number
  maxColumns: number
  onVmClick?: (vm: VmItem) => void
  compact?: boolean
}) {
  const theme = useTheme()

  // Sort VMs: running first, then paused, then stopped, templates last
  const sortedVms = useMemo(() => {
    const statusOrder: Record<string, number> = {
      running: 0,
      paused: 1,
      suspended: 1,
      stopped: 2,
    }

    return [...cluster.vms].sort((a, b) => {
      // Templates always last
      if (a.template && !b.template) return 1
      if (!a.template && b.template) return -1

      const orderA = statusOrder[a.status] ?? 3
      const orderB = statusOrder[b.status] ?? 3
      return orderA - orderB
    })
  }, [cluster.vms])

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ p: compact ? 1.5 : 2, '&:last-child': { pb: compact ? 1.5 : 2 } }}>
        {/* Header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <i className="ri-cloud-fill" style={{ fontSize: 18, color: theme.palette.primary.main }} />
            <Typography variant="subtitle2" fontWeight={700}>
              {cluster.connName}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {cluster.stats.total} VMs
          </Typography>
        </Stack>

        {/* Stats chips */}
        <Stack direction="row" spacing={0.75} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 0.5 }}>
          {cluster.stats.running > 0 && (
            <Chip
              size="small"
              label={cluster.stats.running}
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: `${theme.palette.success.main}20`,
                color: theme.palette.success.main,
                '& .MuiChip-label': { px: 1 },
                '& .MuiChip-icon': { ml: 1, mr: -0.5 },
              }}
              icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'success.main' }} />}
            />
          )}
          {cluster.stats.paused > 0 && (
            <Chip
              size="small"
              label={cluster.stats.paused}
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: `${theme.palette.warning.main}20`,
                color: theme.palette.warning.main,
                '& .MuiChip-label': { px: 1 },
                '& .MuiChip-icon': { ml: 1, mr: -0.5 },
              }}
              icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'warning.main' }} />}
            />
          )}
          {cluster.stats.stopped > 0 && (
            <Chip
              size="small"
              label={cluster.stats.stopped}
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: `${theme.palette.error.main}20`,
                color: theme.palette.error.main,
                '& .MuiChip-label': { px: 1 },
                '& .MuiChip-icon': { ml: 1, mr: -0.5 },
              }}
              icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'error.main' }} />}
            />
          )}
          {cluster.stats.template > 0 && (
            <Chip
              size="small"
              label={cluster.stats.template}
              sx={{
                height: 20,
                fontSize: 11,
                fontWeight: 600,
                bgcolor: 'action.hover',
                color: 'text.secondary',
                '& .MuiChip-label': { px: 1 },
                '& .MuiChip-icon': { ml: 1, mr: -0.5 },
              }}
              icon={<Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'grey.500' }} />}
            />
          )}
        </Stack>

        {/* Waffle grid */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: `${gap}px`,
            maxWidth: maxColumns * (cellSize + gap),
          }}
        >
          {sortedVms.map((vm) => (
            <VmCell
              key={vm.id}
              vm={vm}
              size={cellSize}
              onClick={onVmClick}
            />
          ))}
        </Box>
      </CardContent>
    </Card>
  )
}

/* -----------------------------
  Main Component
------------------------------ */

export default function VmWaffleChart({
  vms,
  cellSize = 12,
  gap = 3,
  maxColumns = 20,
  onVmClick,
  showLegend = true,
  compact = false,
}: VmWaffleChartProps) {
  const theme = useTheme()
  const t = useTranslations()

  // Group VMs by cluster
  const clusters = useMemo(() => {
    const map = new Map<string, ClusterGroup>()

    vms.forEach((vm) => {
      if (!map.has(vm.connId)) {
        map.set(vm.connId, {
          connId: vm.connId,
          connName: vm.connName,
          vms: [],
          stats: { running: 0, stopped: 0, paused: 0, template: 0, total: 0 },
        })
      }

      const group = map.get(vm.connId)!
      group.vms.push(vm)
      group.stats.total++

      if (vm.template) {
        group.stats.template++
      } else if (vm.status === 'running') {
        group.stats.running++
      } else if (vm.status === 'paused' || vm.status === 'suspended') {
        group.stats.paused++
      } else {
        group.stats.stopped++
      }
    })

    return Array.from(map.values()).sort((a, b) => b.stats.total - a.stats.total)
  }, [vms])

  // Global stats
  const globalStats = useMemo(() => {
    return clusters.reduce(
      (acc, cluster) => ({
        running: acc.running + cluster.stats.running,
        stopped: acc.stopped + cluster.stats.stopped,
        paused: acc.paused + cluster.stats.paused,
        template: acc.template + cluster.stats.template,
        total: acc.total + cluster.stats.total,
      }),
      { running: 0, stopped: 0, paused: 0, template: 0, total: 0 }
    )
  }, [clusters])

  if (vms.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography color="text.secondary" textAlign="center">
            {t('common.noData')}
          </Typography>
        </CardContent>
      </Card>
    )
  }

  return (
    <Box>
      {/* Legend */}
      {showLegend && (
        <Stack direction="row" spacing={2} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: 'success.main' }} />
            <Typography variant="caption">Running ({globalStats.running})</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: 'warning.main' }} />
            <Typography variant="caption">Paused ({globalStats.paused})</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: 'error.main' }} />
            <Typography variant="caption">Stopped ({globalStats.stopped})</Typography>
          </Stack>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box sx={{ width: 12, height: 12, borderRadius: 0.5, bgcolor: 'grey.500', opacity: 0.5 }} />
            <Typography variant="caption">Templates ({globalStats.template})</Typography>
          </Stack>
        </Stack>
      )}

      {/* Clusters grid */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            sm: clusters.length === 1 ? '1fr' : 'repeat(2, 1fr)',
            lg: clusters.length <= 2 ? `repeat(${clusters.length}, 1fr)` : 'repeat(3, 1fr)',
          },
          gap: 2,
        }}
      >
        {clusters.map((cluster) => (
          <ClusterWaffle
            key={cluster.connId}
            cluster={cluster}
            cellSize={cellSize}
            gap={gap}
            maxColumns={maxColumns}
            onVmClick={onVmClick}
            compact={compact}
          />
        ))}
      </Box>
    </Box>
  )
}
