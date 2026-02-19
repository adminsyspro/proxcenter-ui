'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Alert,
  Box,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  alpha,
  useTheme
} from '@mui/material'

import { formatBytes } from '@/utils/format'
import { computeDrsHealthScore, type DrsHealthBreakdown } from '@/lib/utils/drs-health'

// ── Types ────────────────────────────────────────────────────────

interface SimulationTabProps {
  connections: { id: string; name: string; hasCeph?: boolean }[]
  isEnterprise: boolean
}

interface InvGuest {
  vmid: string | number
  name?: string
  status: string
  type: string
  cpu?: number
  mem?: number
  maxmem?: number
  maxcpu?: number
  node: string
  tags?: string
}

interface InvNode {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  guests: InvGuest[]
}

interface InvCluster {
  id: string
  name: string
  nodes: InvNode[]
}

interface SimVM {
  vmid: number
  name: string
  status: string
  type: string
  maxmem: number
  maxcpu: number
  mem: number
  originalNode: string
  isRedistributed?: boolean
  isLost?: boolean
  targetNode?: string
}

interface SimNode {
  name: string
  status: string
  maxcpu: number
  maxmem: number
  mem: number
  cpu: number
  vms: SimVM[]
  isFailed: boolean
}

interface SimResult {
  redistributed: SimVM[]
  lost: SimVM[]
  nodeLoads: Map<string, { addedVms: SimVM[]; totalMem: number; totalCpu: number }>
  allDown: boolean
}

interface SimStats {
  hostsBefore: number
  hostsAfter: number
  totalVMs: number
  activeVMs: number
  lostVMs: number
  avgCpuBefore: number
  avgCpuAfter: number
  avgMemBefore: number
  avgMemAfter: number
  healthBefore: DrsHealthBreakdown
  healthAfter: DrsHealthBreakdown
}

// ── Fetcher ──────────────────────────────────────────────────────

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

// ── Sub-components ───────────────────────────────────────────────

function SummaryBar({ hosts, totalHosts, avgCpu, avgMem, vms, failedCount }: {
  hosts: number; totalHosts: number; avgCpu: number; avgMem: number; vms: number; failedCount: number
}) {
  const t = useTranslations()
  const theme = useTheme()

  return (
    <Paper sx={{ px: 2.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
      <StatChip
        icon="ri-server-line"
        label={t('siteRecovery.simulation.hosts')}
        value={`${hosts}/${totalHosts}`}
        color={failedCount > 0 ? theme.palette.warning.main : theme.palette.text.primary}
      />
      <StatChip
        icon="ri-cpu-line"
        label={t('siteRecovery.simulation.avgCpu')}
        value={`${avgCpu}%`}
        color={avgCpu > 80 ? theme.palette.error.main : avgCpu > 60 ? theme.palette.warning.main : theme.palette.success.main}
      />
      <StatChip
        icon="ri-ram-line"
        label={t('siteRecovery.simulation.avgMemory')}
        value={`${avgMem}%`}
        color={avgMem > 85 ? theme.palette.error.main : avgMem > 70 ? theme.palette.warning.main : theme.palette.success.main}
      />
      <StatChip
        icon="ri-instance-line"
        label={t('siteRecovery.simulation.vmsAssigned')}
        value={String(vms)}
        color={theme.palette.text.primary}
      />
      {failedCount > 0 && (
        <Chip
          size="small"
          icon={<i className="ri-alert-line" style={{ fontSize: 14 }} />}
          label={t('siteRecovery.simulation.nodesDown', { count: failedCount })}
          color="error"
          variant="outlined"
          sx={{ ml: 'auto' }}
        />
      )}
    </Paper>
  )
}

function StatChip({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <i className={icon} style={{ fontSize: 16, opacity: 0.5 }} />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, color, fontFamily: 'JetBrains Mono, monospace' }}>
        {value}
      </Typography>
    </Box>
  )
}

function NodeCard({ node, redistributedVMs, onToggleFail }: {
  node: SimNode
  redistributedVMs: SimVM[]
  onToggleFail: () => void
}) {
  const t = useTranslations()
  const theme = useTheme()

  const memPct = node.maxmem > 0 ? Math.round(node.mem / node.maxmem * 100) : 0
  const cpuPct = Math.round(node.cpu)

  return (
    <Paper
      onClick={onToggleFail}
      sx={{
        width: 220,
        minHeight: 200,
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
        border: '1px solid',
        borderColor: node.isFailed
          ? theme.palette.error.main
          : 'divider',
        transition: 'all 0.2s ease',
        '&:hover': {
          borderColor: node.isFailed
            ? theme.palette.error.light
            : theme.palette.primary.main,
          boxShadow: theme.shadows[3],
        },
      }}
    >
      {/* Failed overlay */}
      {node.isFailed && (
        <Box sx={{
          position: 'absolute',
          inset: 0,
          bgcolor: alpha(theme.palette.error.main, 0.08),
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1,
          backdropFilter: 'blur(1px)',
        }}>
          <i className="ri-skull-2-line" style={{ fontSize: 36, color: theme.palette.error.main }} />
          <Typography variant="subtitle2" color="error" sx={{ fontWeight: 700, mt: 0.5 }}>
            {t('siteRecovery.simulation.failed')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('siteRecovery.simulation.clickToReactivate')}
          </Typography>
        </Box>
      )}

      {/* Header */}
      <Box sx={{
        px: 1.5, py: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid',
        borderColor: 'divider',
        bgcolor: node.isFailed
          ? alpha(theme.palette.error.main, 0.04)
          : alpha(theme.palette.primary.main, 0.03),
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <i className="ri-server-line" style={{ fontSize: 14, opacity: 0.6 }} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
            {node.name}
          </Typography>
        </Box>
        {!node.isFailed && (
          <i className="ri-checkbox-circle-fill" style={{ fontSize: 16, color: theme.palette.success.main }} />
        )}
      </Box>

      {/* Resource bars */}
      {!node.isFailed && (
        <Box sx={{ px: 1.5, py: 1 }}>
          <ResourceBar label="CPU" value={cpuPct} suffix={`${node.maxcpu}c`} />
          <ResourceBar label="RAM" value={memPct} suffix={formatBytes(node.maxmem)} />
        </Box>
      )}

      {/* VMs list */}
      {!node.isFailed && (
        <Box sx={{ px: 1, pb: 1, display: 'flex', flexDirection: 'column', gap: 0.4 }}>
          {node.vms.map(vm => (
            <VMChip key={vm.vmid} vm={vm} />
          ))}
          {redistributedVMs.map(vm => (
            <VMChip key={`r-${vm.vmid}`} vm={vm} isRedistributed />
          ))}
          {node.vms.length === 0 && redistributedVMs.length === 0 && (
            <Typography variant="caption" color="text.disabled" sx={{ px: 0.5, fontStyle: 'italic' }}>
              No VMs
            </Typography>
          )}
        </Box>
      )}

      {/* Click hint */}
      {!node.isFailed && (
        <Typography variant="caption" color="text.disabled" sx={{
          px: 1.5, pb: 0.75, display: 'block', fontSize: '0.65rem',
        }}>
          {t('siteRecovery.simulation.clickToFail')}
        </Typography>
      )}
    </Paper>
  )
}

function ResourceBar({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  const theme = useTheme()
  const color = value > 85 ? theme.palette.error.main
    : value > 70 ? theme.palette.warning.main
    : theme.palette.success.main

  return (
    <Box sx={{ mb: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>
          {label} {value}%
        </Typography>
        <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6 }}>
          {suffix}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.min(value, 100)}
        sx={{
          height: 4,
          borderRadius: 2,
          bgcolor: alpha(color, 0.15),
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 2 },
        }}
      />
    </Box>
  )
}

function VMChip({ vm, isRedistributed, isLost }: { vm: SimVM; isRedistributed?: boolean; isLost?: boolean }) {
  const theme = useTheme()

  const statusColor = vm.status === 'running'
    ? theme.palette.success.main
    : vm.status === 'stopped'
    ? theme.palette.error.main
    : theme.palette.warning.main

  const borderColor = isRedistributed
    ? theme.palette.success.main
    : isLost
    ? theme.palette.error.main
    : 'transparent'

  const tooltipContent = [
    `${vm.maxcpu} vCPU`,
    vm.maxmem > 0 ? formatBytes(vm.maxmem) : null,
    vm.mem > 0 ? `Used: ${formatBytes(vm.mem)}` : null,
    vm.type,
    isRedistributed ? `From: ${vm.originalNode}` : null,
  ].filter(Boolean).join(' | ')

  return (
    <Tooltip title={tooltipContent} arrow placement="top">
      <Box
        onClick={e => e.stopPropagation()}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.75,
          py: 0.25,
          borderRadius: 1,
          border: '1px solid',
          borderColor: isRedistributed || isLost ? borderColor : alpha(theme.palette.divider, 0.4),
          bgcolor: isRedistributed
            ? alpha(theme.palette.success.main, 0.06)
            : isLost
            ? alpha(theme.palette.error.main, 0.06)
            : 'transparent',
          fontSize: '0.7rem',
          fontFamily: 'JetBrains Mono, monospace',
          lineHeight: 1.4,
        }}
      >
        <Box sx={{
          width: 6, height: 6, borderRadius: '50%',
          bgcolor: statusColor, flexShrink: 0,
        }} />
        <Typography component="span" sx={{ fontSize: 'inherit', fontFamily: 'inherit', fontWeight: 600 }}>
          {vm.vmid}
        </Typography>
        <Typography component="span" sx={{
          fontSize: 'inherit', fontFamily: 'inherit', opacity: 0.6,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 100,
        }}>
          {vm.name}
        </Typography>
        {isRedistributed && (
          <i className="ri-arrow-right-up-line" style={{ fontSize: 12, color: theme.palette.success.main, marginLeft: 'auto' }} />
        )}
      </Box>
    </Tooltip>
  )
}

function VerdictBanner({ verdict, stats }: {
  verdict: { severity: 'success' | 'warning' | 'error'; key: string }
  stats: SimStats
}) {
  const t = useTranslations()
  const theme = useTheme()

  const getHealthColor = (score: number) =>
    score >= 80 ? theme.palette.success.main
    : score >= 50 ? theme.palette.warning.main
    : theme.palette.error.main

  return (
    <Alert
      severity={verdict.severity}
      icon={
        verdict.severity === 'success'
          ? <i className="ri-checkbox-circle-fill" style={{ fontSize: 22 }} />
          : verdict.severity === 'warning'
          ? <i className="ri-alert-line" style={{ fontSize: 22 }} />
          : <i className="ri-close-circle-fill" style={{ fontSize: 22 }} />
      }
      sx={{ '& .MuiAlert-message': { width: '100%' } }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {t(`siteRecovery.simulation.verdict.${verdict.key}`)}
      </Typography>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" color="text.secondary">
            {t('siteRecovery.simulation.healthScore')}:
          </Typography>
          <Typography variant="caption" sx={{
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            color: getHealthColor(stats.healthBefore.score),
          }}>
            {stats.healthBefore.score}
          </Typography>
          <i className="ri-arrow-right-line" style={{ fontSize: 12, opacity: 0.4 }} />
          <Typography variant="caption" sx={{
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            color: getHealthColor(stats.healthAfter.score),
          }}>
            {stats.healthAfter.score}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" color="text.secondary">CPU:</Typography>
          <Typography variant="caption" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {stats.avgCpuBefore}%
          </Typography>
          <i className="ri-arrow-right-line" style={{ fontSize: 12, opacity: 0.4 }} />
          <Typography variant="caption" sx={{
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            color: stats.avgCpuAfter > 80 ? theme.palette.error.main : undefined,
          }}>
            {stats.avgCpuAfter}%
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="caption" color="text.secondary">RAM:</Typography>
          <Typography variant="caption" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {stats.avgMemBefore}%
          </Typography>
          <i className="ri-arrow-right-line" style={{ fontSize: 12, opacity: 0.4 }} />
          <Typography variant="caption" sx={{
            fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
            color: stats.avgMemAfter > 85 ? theme.palette.error.main : undefined,
          }}>
            {stats.avgMemAfter}%
          </Typography>
        </Box>
        {stats.lostVMs > 0 && (
          <Chip
            size="small"
            label={`${stats.lostVMs} ${t('siteRecovery.simulation.lost')}`}
            color="error"
            sx={{ height: 20, fontSize: '0.7rem' }}
          />
        )}
      </Box>
    </Alert>
  )
}

function AffectedVMsTable({ redistributed, lost }: { redistributed: SimVM[]; lost: SimVM[] }) {
  const t = useTranslations()
  const theme = useTheme()

  const allVMs = [
    ...redistributed.map(v => ({ ...v, outcome: 'redistributed' as const })),
    ...lost.map(v => ({ ...v, outcome: 'lost' as const })),
  ]

  return (
    <Paper variant="outlined">
      <Box sx={{ px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          <i className="ri-list-check-2" style={{ fontSize: 16, marginRight: 8, verticalAlign: 'text-bottom' }} />
          {t('siteRecovery.simulation.affectedVms')} ({allVMs.length})
        </Typography>
      </Box>
      <TableContainer sx={{ maxHeight: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>{t('siteRecovery.simulation.vmid')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>{t('siteRecovery.simulation.vmName')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>{t('siteRecovery.simulation.vcpus')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>{t('siteRecovery.simulation.ram')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>{t('siteRecovery.simulation.originalNode')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>{t('siteRecovery.simulation.targetNode')}</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {allVMs.map(vm => (
              <TableRow key={vm.vmid}>
                <TableCell sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }}>
                  {vm.vmid}
                </TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{vm.name}</TableCell>
                <TableCell sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }}>
                  {vm.maxcpu}
                </TableCell>
                <TableCell sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }}>
                  {vm.maxmem > 0 ? formatBytes(vm.maxmem) : '—'}
                </TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{vm.originalNode}</TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>
                  {vm.outcome === 'redistributed' ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <i className="ri-checkbox-circle-fill" style={{ fontSize: 14, color: theme.palette.success.main }} />
                      {vm.targetNode}
                    </Box>
                  ) : '—'}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={t(`siteRecovery.simulation.${vm.outcome}`)}
                    color={vm.outcome === 'redistributed' ? 'success' : 'error'}
                    variant="outlined"
                    sx={{ height: 20, fontSize: '0.65rem' }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}

// ── Main Component ───────────────────────────────────────────────

export default function SimulationTab({ connections, isEnterprise }: SimulationTabProps) {
  const t = useTranslations()

  const [selectedClusterId, setSelectedClusterId] = useState<string>('')
  const [failedNodes, setFailedNodes] = useState<Set<string>>(new Set())

  // Fetch inventory data (nodes + guests with resource info)
  const { data: inventoryData } = useSWR(
    isEnterprise ? '/api/v1/inventory' : null,
    fetcher,
    { refreshInterval: 30000 }
  )

  const clusters: InvCluster[] = useMemo(() =>
    inventoryData?.data?.clusters || [],
    [inventoryData]
  )

  const connectionNames = useMemo(() => {
    const m: Record<string, string> = {}
    for (const c of connections) m[c.id] = c.name
    return m
  }, [connections])

  // Build simulation nodes from inventory
  const simNodes: SimNode[] = useMemo(() => {
    const cluster = clusters.find(c => c.id === selectedClusterId)
    if (!cluster) return []

    return cluster.nodes
      .filter(n => n.status !== 'offline')
      .map(n => ({
        name: n.node,
        status: n.status,
        maxcpu: n.maxcpu || 0,
        maxmem: n.maxmem || 0,
        mem: n.mem || 0,
        cpu: Math.round((n.cpu || 0) * 100),
        vms: (n.guests || [])
          .filter(g => g.status === 'running')
          .map(g => ({
            vmid: typeof g.vmid === 'string' ? parseInt(g.vmid, 10) : g.vmid,
            name: g.name || `VM ${g.vmid}`,
            status: g.status,
            type: g.type,
            maxmem: g.maxmem || 0,
            maxcpu: g.maxcpu || 0,
            mem: g.mem || 0,
            originalNode: n.node,
          })),
        isFailed: failedNodes.has(n.node),
      }))
  }, [clusters, selectedClusterId, failedNodes])

  // ── Simulation algorithm (greedy bin-packing) ──────────────────

  const simulation: SimResult | null = useMemo(() => {
    if (failedNodes.size === 0 || simNodes.length === 0) return null

    const survivingNodes = simNodes.filter(n => !n.isFailed)
    const failedNodesList = simNodes.filter(n => n.isFailed)

    if (survivingNodes.length === 0) {
      return {
        redistributed: [],
        lost: failedNodesList.flatMap(n => n.vms.map(v => ({ ...v, isLost: true }))),
        nodeLoads: new Map(),
        allDown: true,
      }
    }

    // Collect displaced VMs, sort by memory desc (largest first)
    const displacedVMs = failedNodesList.flatMap(n => n.vms)
    displacedVMs.sort((a, b) => b.maxmem - a.maxmem)

    // Track remaining capacity per surviving node
    const nodeCapacity = new Map<string, { freeMem: number }>()
    for (const node of survivingNodes) {
      nodeCapacity.set(node.name, { freeMem: node.maxmem - node.mem })
    }

    const nodeLoads = new Map<string, { addedVms: SimVM[]; totalMem: number; totalCpu: number }>()
    for (const node of survivingNodes) {
      nodeLoads.set(node.name, { addedVms: [], totalMem: 0, totalCpu: 0 })
    }

    const redistributed: SimVM[] = []
    const lost: SimVM[] = []

    for (const vm of displacedVMs) {
      // Find surviving node with most free memory that can fit this VM
      let bestNode: string | null = null
      let bestFree = -1

      for (const [name, cap] of nodeCapacity) {
        if (cap.freeMem >= vm.maxmem && cap.freeMem > bestFree) {
          bestNode = name
          bestFree = cap.freeMem
        }
      }

      if (bestNode) {
        nodeCapacity.get(bestNode)!.freeMem -= vm.maxmem

        const load = nodeLoads.get(bestNode)!
        load.addedVms.push(vm)
        load.totalMem += vm.maxmem
        load.totalCpu += vm.maxcpu

        redistributed.push({ ...vm, isRedistributed: true, targetNode: bestNode })
      } else {
        lost.push({ ...vm, isLost: true })
      }
    }

    return { redistributed, lost, nodeLoads, allDown: false }
  }, [simNodes, failedNodes])

  // ── Before / After stats ───────────────────────────────────────

  const stats: SimStats | null = useMemo(() => {
    if (!simNodes.length) return null

    const allNodes = simNodes
    const survivingNodes = simNodes.filter(n => !n.isFailed)

    const totalVMs = allNodes.reduce((acc, n) => acc + n.vms.length, 0)
    const activeVMs = survivingNodes.reduce((acc, n) => acc + n.vms.length, 0)
      + (simulation?.redistributed.length || 0)

    const avgCpuBefore = allNodes.reduce((acc, n) => acc + n.cpu, 0) / allNodes.length
    const avgMemBefore = allNodes.reduce((acc, n) => acc + (n.maxmem ? n.mem / n.maxmem * 100 : 0), 0) / allNodes.length

    let avgCpuAfter = avgCpuBefore
    let avgMemAfter = avgMemBefore

    if (survivingNodes.length > 0 && failedNodes.size > 0) {
      let totalMemUsed = 0
      let totalMemMax = 0

      for (const node of survivingNodes) {
        totalMemUsed += node.mem + (simulation?.nodeLoads.get(node.name)?.totalMem || 0)
        totalMemMax += node.maxmem
      }

      avgMemAfter = totalMemMax > 0 ? (totalMemUsed / totalMemMax * 100) : 0

      // CPU: proportional increase (simplified)
      const cpuIncreaseRatio = allNodes.length / survivingNodes.length
      avgCpuAfter = avgCpuBefore * cpuIncreaseRatio
    }

    // Compute imbalance for health score
    const computeImbalance = (nodes: SimNode[], extraMem?: Map<string, { totalMem: number }>) => {
      const mems = nodes.map(n => {
        const extra = extraMem?.get(n.name)?.totalMem || 0
        return n.maxmem ? (n.mem + extra) / n.maxmem * 100 : 0
      })
      const avg = mems.reduce((a, b) => a + b, 0) / mems.length
      return Math.sqrt(mems.reduce((sum, m) => sum + (m - avg) ** 2, 0) / mems.length)
    }

    const imbalanceBefore = computeImbalance(allNodes)
    const imbalanceAfter = survivingNodes.length > 0
      ? computeImbalance(survivingNodes, simulation?.nodeLoads as any)
      : 100

    const healthBefore = computeDrsHealthScore({
      avg_memory_usage: avgMemBefore,
      avg_cpu_usage: avgCpuBefore,
      imbalance: imbalanceBefore,
    })

    const healthAfter = computeDrsHealthScore({
      avg_memory_usage: Math.min(avgMemAfter, 100),
      avg_cpu_usage: Math.min(avgCpuAfter, 100),
      imbalance: imbalanceAfter,
    })

    return {
      hostsBefore: allNodes.length,
      hostsAfter: survivingNodes.length,
      totalVMs,
      activeVMs,
      lostVMs: simulation?.lost.length || 0,
      avgCpuBefore: Math.round(avgCpuBefore),
      avgCpuAfter: Math.round(Math.min(avgCpuAfter, 100)),
      avgMemBefore: Math.round(avgMemBefore),
      avgMemAfter: Math.round(Math.min(avgMemAfter, 100)),
      healthBefore,
      healthAfter,
    }
  }, [simNodes, simulation, failedNodes])

  // ── Handlers ───────────────────────────────────────────────────

  const toggleFail = (nodeName: string) => {
    setFailedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeName)) next.delete(nodeName)
      else next.add(nodeName)
      return next
    })
  }

  const handleClusterChange = (id: string) => {
    setSelectedClusterId(id)
    setFailedNodes(new Set())
  }

  // Verdict
  const verdict = useMemo(() => {
    if (!simulation || !stats) return null
    if (simulation.allDown) return { severity: 'error' as const, key: 'allDown' }
    if (simulation.lost.length > 0) return { severity: 'error' as const, key: 'overloaded' }
    if (stats.healthAfter.score < 50) return { severity: 'warning' as const, key: 'stressed' }
    return { severity: 'success' as const, key: 'ok' }
  }, [simulation, stats])

  // ── Render ─────────────────────────────────────────────────────

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Cluster selector */}
      <FormControl size="small" sx={{ maxWidth: 320 }}>
        <InputLabel>{t('siteRecovery.simulation.selectCluster')}</InputLabel>
        <Select
          value={selectedClusterId}
          onChange={e => handleClusterChange(e.target.value)}
          label={t('siteRecovery.simulation.selectCluster')}
        >
          {clusters.filter(c => c.nodes.length > 1).map(c => (
            <MenuItem key={c.id} value={c.id}>
              {connectionNames[c.id] || c.name || c.id}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Empty state */}
      {!selectedClusterId && (
        <Paper sx={{ p: 6, textAlign: 'center' }}>
          <i className="ri-test-tube-line" style={{ fontSize: 48, opacity: 0.2 }} />
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            {t('siteRecovery.simulation.noSimulation')}
          </Typography>
        </Paper>
      )}

      {/* Simulation UI */}
      {selectedClusterId && simNodes.length > 0 && (
        <>
          {/* Summary bar */}
          <SummaryBar
            hosts={failedNodes.size > 0 ? (stats?.hostsAfter ?? simNodes.length) : simNodes.length}
            totalHosts={simNodes.length}
            avgCpu={failedNodes.size > 0 ? (stats?.avgCpuAfter ?? 0) : (stats?.avgCpuBefore ?? 0)}
            avgMem={failedNodes.size > 0 ? (stats?.avgMemAfter ?? 0) : (stats?.avgMemBefore ?? 0)}
            vms={failedNodes.size > 0 ? (stats?.activeVMs ?? 0) : (stats?.totalVMs ?? 0)}
            failedCount={failedNodes.size}
          />

          {/* Node cards */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            {simNodes.map(node => (
              <NodeCard
                key={node.name}
                node={node}
                redistributedVMs={simulation?.redistributed.filter(v => v.targetNode === node.name) || []}
                onToggleFail={() => toggleFail(node.name)}
              />
            ))}
          </Box>

          {/* Verdict banner */}
          {verdict && stats && (
            <VerdictBanner verdict={verdict} stats={stats} />
          )}

          {/* Affected VMs table */}
          {simulation && (simulation.redistributed.length > 0 || simulation.lost.length > 0) && (
            <AffectedVMsTable
              redistributed={simulation.redistributed}
              lost={simulation.lost}
            />
          )}
        </>
      )}

      {/* No nodes */}
      {selectedClusterId && simNodes.length === 0 && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            {t('siteRecovery.simulation.noNodes')}
          </Typography>
        </Paper>
      )}
    </Box>
  )
}
