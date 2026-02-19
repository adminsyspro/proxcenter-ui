'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'

import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
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

interface CephPool {
  name: string
  size: number
  minSize: number
  type: string
  crushRule: number
}

interface CrushBucket {
  id: number
  name: string
  type: string
  type_id?: number
  status?: string
  children?: CrushBucket[]
}

interface CrushRuleStep {
  op: string
  type: string
  num: number
  item?: number
  item_name?: string
}

interface CrushRule {
  id: number
  name: string
  steps: CrushRuleStep[]
}

interface CephInfo {
  osds: { total: number; up: number; in: number }
  pools: { list: CephPool[] }
  crushTree: CrushBucket[]
  crushRules: CrushRule[]
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

function SummaryBar({ hosts, totalHosts, avgCpu, avgMem, vms, failedCount, cephWarning }: {
  hosts: number; totalHosts: number; avgCpu: number; avgMem: number; vms: number; failedCount: number; cephWarning?: string | null
}) {
  const t = useTranslations()
  const theme = useTheme()

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
      {cephWarning && (
        <Alert severity="warning" icon={<i className="ri-database-2-line" style={{ fontSize: 20 }} />} sx={{ py: 0.5 }}>
          <Typography variant="body2">{cephWarning}</Typography>
        </Alert>
      )}
    </Box>
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

function NodeCard({ node, redistributedVMs, onToggleFail, nodeCount }: {
  node: SimNode
  redistributedVMs: SimVM[]
  onToggleFail: () => void
  nodeCount: number
}) {
  const t = useTranslations()
  const theme = useTheme()

  const memPct = node.maxmem > 0 ? Math.round(node.mem / node.maxmem * 100) : 0
  const cpuPct = Math.round(node.cpu)

  return (
    <Paper
      onClick={onToggleFail}
      sx={{
        flex: `1 1 ${nodeCount <= 3 ? '280px' : nodeCount <= 5 ? '220px' : '180px'}`,
        maxWidth: nodeCount <= 2 ? '50%' : undefined,
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
  const clampedValue = Math.min(value, 100)
  const color = value > 85 ? theme.palette.error.main
    : value > 70 ? theme.palette.warning.main
    : theme.palette.success.main

  return (
    <Box sx={{ mb: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 600 }}>
          {label} {value}%{value > 100 && <span style={{ color: theme.palette.error.main }}> !</span>}
        </Typography>
        <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.6 }}>
          {suffix}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={clampedValue}
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
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120,
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

function VerdictBanner({ verdict, stats, cephVerdict }: {
  verdict: { severity: 'success' | 'warning' | 'error'; key: string }
  stats: SimStats
  cephVerdict?: { ok: boolean; message: string } | null
}) {
  const t = useTranslations()
  const theme = useTheme()

  const getHealthColor = (score: number) =>
    score >= 80 ? theme.palette.success.main
    : score >= 50 ? theme.palette.warning.main
    : theme.palette.error.main

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
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
      {cephVerdict && (
        <Alert
          severity={cephVerdict.ok ? 'success' : 'error'}
          icon={<i className="ri-database-2-line" style={{ fontSize: 20 }} />}
          sx={{ py: 0.5 }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Ceph: {cephVerdict.message}
          </Typography>
        </Alert>
      )}
    </Box>
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

  // Fetch Ceph data for selected cluster (pools with size/min_size + OSD count)
  const { data: cephData } = useSWR<{ data: CephInfo }>(
    selectedClusterId && isEnterprise
      ? `/api/v1/connections/${selectedClusterId}/ceph`
      : null,
    fetcher
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

  // Check if selected cluster has Ceph enabled
  const selectedHasCeph = useMemo(() =>
    connections.find(c => c.id === selectedClusterId)?.hasCeph ?? false,
    [connections, selectedClusterId]
  )

  // Parse CRUSH topology from the OSD tree
  const crushTopology = useMemo(() => {
    if (!cephData?.data?.crushTree?.length) return null

    const nodeToDatacenter = new Map<string, string>()
    const datacenters = new Map<string, string[]>()

    const walk = (buckets: CrushBucket[], dcName?: string) => {
      for (const bucket of buckets) {
        const currentDc = bucket.type === 'datacenter' ? bucket.name : dcName
        if (bucket.type === 'datacenter') {
          if (!datacenters.has(bucket.name)) datacenters.set(bucket.name, [])
        }
        if (bucket.type === 'host' && currentDc) {
          nodeToDatacenter.set(bucket.name, currentDc)
          const hosts = datacenters.get(currentDc) || []
          if (!hosts.includes(bucket.name)) hosts.push(bucket.name)
          datacenters.set(currentDc, hosts)
        }
        if (bucket.children) walk(bucket.children, currentDc)
      }
    }
    walk(cephData.data.crushTree)

    if (datacenters.size === 0) return null
    return { nodeToDatacenter, datacenters }
  }, [cephData])

  // Map CRUSH rule ID → failure domain type
  const crushRuleMap = useMemo(() => {
    if (!cephData?.data?.crushRules?.length) return new Map<number, string>()
    const map = new Map<number, string>()
    for (const rule of cephData.data.crushRules) {
      // Find the chooseleaf step to determine failure domain
      const chooseleaf = rule.steps.find(s => s.op === 'chooseleaf_firstn' || s.op === 'chooseleaf_indep')
      if (chooseleaf && chooseleaf.type) {
        map.set(rule.id, chooseleaf.type)
      } else {
        map.set(rule.id, 'host')
      }
    }
    return map
  }, [cephData])

  // Ceph pool replication rules: CRUSH-aware tolerance
  const cephTolerance = useMemo(() => {
    if (!selectedHasCeph || !cephData?.data) return null
    const pools = cephData.data.pools?.list || []
    if (pools.length === 0) return null

    // Find the strictest pool (lowest tolerance)
    let minTolerance = Infinity
    let strictestPool = ''
    let failureDomain = 'host'

    for (const pool of pools) {
      // Skip internal/system pools (e.g. .mgr, .rgw.root)
      if (pool.name.startsWith('.')) continue
      if (pool.type !== 'replicated') continue
      const tolerance = (pool.size || 3) - (pool.minSize || 2)

      // Determine failure domain from CRUSH rule steps if available,
      // otherwise infer from CRUSH tree structure: if the tree has datacenter
      // buckets and pool.size <= number of DCs, replicas span datacenters
      let domain = crushRuleMap.get(pool.crushRule)
      if (!domain || domain === 'host') {
        const dcCount = crushTopology?.datacenters.size || 0
        domain = dcCount >= 2 && (pool.size || 3) <= dcCount ? 'datacenter' : 'host'
      }

      if (tolerance < minTolerance) {
        minTolerance = tolerance
        strictestPool = pool.name
        failureDomain = domain
      }
    }

    const totalOsds = cephData.data.osds?.total || 0
    const upOsds = cephData.data.osds?.up || 0
    const dcCount = crushTopology?.datacenters.size || 0

    return {
      maxNodeLoss: minTolerance === Infinity ? 1 : minTolerance,
      strictestPool,
      totalOsds,
      upOsds,
      failureDomain,
      dcCount,
    }
  }, [selectedHasCeph, cephData, crushRuleMap, crushTopology])

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

  // ── Simulation algorithm (greedy bin-packing + load redistribution) ──

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

  // ── Build "after" node states with redistributed load applied ──

  const simNodesAfter: SimNode[] = useMemo(() => {
    if (!simulation) return simNodes

    return simNodes.map(node => {
      if (node.isFailed) return node
      const extra = simulation.nodeLoads.get(node.name)
      if (!extra || extra.totalMem === 0) return node

      // Add redistributed VM memory and CPU to this node
      const newMem = node.mem + extra.totalMem
      const addedCpuCores = extra.totalCpu
      // Approximate CPU increase: each added vCPU adds load proportional to current avg per-core usage
      const currentCpuPerCore = node.maxcpu > 0 ? node.cpu / node.maxcpu : 0
      const newCpu = node.maxcpu > 0
        ? Math.round(((node.cpu / 100 * node.maxcpu) + addedCpuCores * (currentCpuPerCore / 100)) / node.maxcpu * 100)
        : node.cpu

      return {
        ...node,
        mem: newMem,
        cpu: Math.min(newCpu, 150), // allow over 100% to show overload
      }
    })
  }, [simNodes, simulation])

  // ── Before / After stats ───────────────────────────────────────

  const stats: SimStats | null = useMemo(() => {
    if (!simNodes.length) return null

    const allNodes = simNodes
    const survivingNodes = simNodes.filter(n => !n.isFailed)
    const survivingAfter = simNodesAfter.filter(n => !n.isFailed)

    const totalVMs = allNodes.reduce((acc, n) => acc + n.vms.length, 0)
    const activeVMs = survivingNodes.reduce((acc, n) => acc + n.vms.length, 0)
      + (simulation?.redistributed.length || 0)

    const avgCpuBefore = allNodes.reduce((acc, n) => acc + n.cpu, 0) / allNodes.length
    const avgMemBefore = allNodes.reduce((acc, n) => acc + (n.maxmem ? n.mem / n.maxmem * 100 : 0), 0) / allNodes.length

    let avgCpuAfter = avgCpuBefore
    let avgMemAfter = avgMemBefore

    if (survivingAfter.length > 0 && failedNodes.size > 0) {
      avgCpuAfter = survivingAfter.reduce((acc, n) => acc + n.cpu, 0) / survivingAfter.length
      avgMemAfter = survivingAfter.reduce((acc, n) => acc + (n.maxmem ? n.mem / n.maxmem * 100 : 0), 0) / survivingAfter.length
    }

    // Compute imbalance for health score
    const computeImbalance = (nodes: SimNode[]) => {
      const mems = nodes.map(n => n.maxmem ? n.mem / n.maxmem * 100 : 0)
      if (mems.length === 0) return 100
      const avg = mems.reduce((a, b) => a + b, 0) / mems.length
      return Math.sqrt(mems.reduce((sum, m) => sum + (m - avg) ** 2, 0) / mems.length)
    }

    const imbalanceBefore = computeImbalance(allNodes)
    const imbalanceAfter = survivingAfter.length > 0
      ? computeImbalance(survivingAfter)
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
      hostsAfter: survivingAfter.length,
      totalVMs,
      activeVMs,
      lostVMs: simulation?.lost.length || 0,
      avgCpuBefore: Math.round(avgCpuBefore),
      avgCpuAfter: Math.round(Math.min(avgCpuAfter, 150)),
      avgMemBefore: Math.round(avgMemBefore),
      avgMemAfter: Math.round(Math.min(avgMemAfter, 150)),
      healthBefore,
      healthAfter,
    }
  }, [simNodes, simNodesAfter, simulation, failedNodes])

  // ── Ceph verdict ───────────────────────────────────────────────

  const cephVerdict = useMemo(() => {
    if (!selectedHasCeph || !cephTolerance || failedNodes.size === 0) return null

    const isDcDomain = cephTolerance.failureDomain === 'datacenter' && crushTopology

    let failedCount: number
    if (isDcDomain) {
      // Count how many distinct datacenters the failed nodes belong to
      const failedDcs = new Set<string>()
      for (const nodeName of failedNodes) {
        const dc = crushTopology!.nodeToDatacenter.get(nodeName)
        if (dc) failedDcs.add(dc)
      }
      failedCount = failedDcs.size
    } else {
      failedCount = failedNodes.size
    }

    const suffix = isDcDomain ? 'Dc' : ''
    if (failedCount <= cephTolerance.maxNodeLoss) {
      return {
        ok: true,
        message: t(`siteRecovery.simulation.cephOk${suffix}`, {
          failed: failedCount,
          max: cephTolerance.maxNodeLoss,
          pool: cephTolerance.strictestPool,
        }),
      }
    }
    return {
      ok: false,
      message: t(`siteRecovery.simulation.cephDanger${suffix}`, {
        failed: failedCount,
        max: cephTolerance.maxNodeLoss,
        pool: cephTolerance.strictestPool,
      }),
    }
  }, [selectedHasCeph, cephTolerance, failedNodes, t, crushTopology])

  // Ceph warning shown in summary bar (before any node is failed)
  const cephSummaryWarning = useMemo(() => {
    if (!selectedHasCeph || !cephTolerance) return null
    if (failedNodes.size === 0) return null
    return null // only shown via cephVerdict in the verdict banner
  }, [selectedHasCeph, cephTolerance, failedNodes])

  // ── Handlers ───────────────────────────────────────────────────

  const toggleFail = (nodeName: string) => {
    setFailedNodes(prev => {
      const next = new Set(prev)
      if (next.has(nodeName)) next.delete(nodeName)
      else next.add(nodeName)
      return next
    })
  }

  const toggleDatacenter = (dcName: string) => {
    if (!crushTopology) return
    const dcNodes = crushTopology.datacenters.get(dcName) || []
    setFailedNodes(prev => {
      const next = new Set(prev)
      const allFailed = dcNodes.every(n => next.has(n))
      if (allFailed) {
        // Reactivate all nodes in this DC
        for (const n of dcNodes) next.delete(n)
      } else {
        // Fail all nodes in this DC
        for (const n of dcNodes) next.add(n)
      }
      return next
    })
  }

  const handleClusterChange = (id: string) => {
    setSelectedClusterId(id)
    setFailedNodes(new Set())
  }

  // Verdict (combines VM load + Ceph awareness)
  const verdict = useMemo(() => {
    if (!simulation || !stats) return null
    if (simulation.allDown) return { severity: 'error' as const, key: 'allDown' }
    // Ceph data loss = critical even if VMs fit
    if (cephVerdict && !cephVerdict.ok) return { severity: 'error' as const, key: 'overloaded' }
    if (simulation.lost.length > 0) return { severity: 'error' as const, key: 'overloaded' }
    if (stats.healthAfter.score < 50) return { severity: 'warning' as const, key: 'stressed' }
    return { severity: 'success' as const, key: 'ok' }
  }, [simulation, stats, cephVerdict])

  // ── Render ─────────────────────────────────────────────────────

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      {/* Cluster selector */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <FormControl size="small" sx={{ minWidth: 280 }}>
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
        {selectedHasCeph && cephTolerance && (
          <Chip
            size="small"
            icon={<i className="ri-database-2-line" style={{ fontSize: 14 }} />}
            label={cephTolerance.failureDomain === 'datacenter' && cephTolerance.dcCount > 0
              ? t('siteRecovery.simulation.cephEnabledDc', {
                  tolerance: cephTolerance.maxNodeLoss,
                  osds: cephTolerance.totalOsds,
                  dcs: cephTolerance.dcCount,
                })
              : t('siteRecovery.simulation.cephEnabled', {
                  tolerance: cephTolerance.maxNodeLoss,
                  osds: cephTolerance.totalOsds,
                })
            }
            color="info"
            variant="outlined"
          />
        )}
      </Box>

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
            cephWarning={cephSummaryWarning}
          />

          {/* Node cards — grouped by datacenter when CRUSH topology available */}
          {crushTopology && cephTolerance?.failureDomain === 'datacenter' ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
              {Array.from(crushTopology.datacenters.entries()).map(([dcName, dcHosts]) => {
                const dcNodes = simNodesAfter.filter(n => dcHosts.includes(n.name))
                if (dcNodes.length === 0) return null
                const allFailed = dcNodes.every(n => n.isFailed)
                return (
                  <Box key={dcName}>
                    <Box sx={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      mb: 1.5, px: 0.5,
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className="ri-building-line" style={{ fontSize: 18, opacity: 0.6 }} />
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                          {dcName}
                        </Typography>
                        <Chip
                          size="small"
                          label={`${dcNodes.length} ${t('siteRecovery.simulation.hosts').toLowerCase()}`}
                          variant="outlined"
                          sx={{ height: 22, fontSize: '0.7rem' }}
                        />
                        {allFailed && (
                          <Chip size="small" label="DOWN" color="error" sx={{ height: 22, fontSize: '0.7rem', fontWeight: 700 }} />
                        )}
                      </Box>
                      <Button
                        size="small"
                        variant={allFailed ? 'outlined' : 'contained'}
                        color={allFailed ? 'success' : 'error'}
                        startIcon={<i className={allFailed ? 'ri-restart-line' : 'ri-skull-2-line'} style={{ fontSize: 14 }} />}
                        onClick={() => toggleDatacenter(dcName)}
                        sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                      >
                        {allFailed
                          ? t('siteRecovery.simulation.reactivateDatacenter')
                          : t('siteRecovery.simulation.failDatacenter')
                        }
                      </Button>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                      {dcNodes.map(node => (
                        <NodeCard
                          key={node.name}
                          node={node}
                          redistributedVMs={simulation?.redistributed.filter(v => v.targetNode === node.name) || []}
                          onToggleFail={() => toggleFail(node.name)}
                          nodeCount={dcNodes.length}
                        />
                      ))}
                    </Box>
                  </Box>
                )
              })}
              {/* Nodes not in any datacenter */}
              {(() => {
                const allDcHosts = new Set(Array.from(crushTopology.datacenters.values()).flat())
                const orphanNodes = simNodesAfter.filter(n => !allDcHosts.has(n.name))
                if (orphanNodes.length === 0) return null
                return (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {orphanNodes.map(node => (
                      <NodeCard
                        key={node.name}
                        node={node}
                        redistributedVMs={simulation?.redistributed.filter(v => v.targetNode === node.name) || []}
                        onToggleFail={() => toggleFail(node.name)}
                        nodeCount={orphanNodes.length}
                      />
                    ))}
                  </Box>
                )
              })()}
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {simNodesAfter.map(node => (
                <NodeCard
                  key={node.name}
                  node={node}
                  redistributedVMs={simulation?.redistributed.filter(v => v.targetNode === node.name) || []}
                  onToggleFail={() => toggleFail(node.name)}
                  nodeCount={simNodes.length}
                />
              ))}
            </Box>
          )}

          {/* Verdict banner */}
          {verdict && stats && (
            <VerdictBanner verdict={verdict} stats={stats} cephVerdict={cephVerdict} />
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
