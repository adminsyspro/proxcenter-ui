'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Tab,
  Table,
  Tooltip as MuiTooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'

const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PowerSettingsNewIcon = (props: any) => <i className="ri-shut-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

import { useLicense } from '@/contexts/LicenseContext'
import { useDRSStatus, useDRSMetrics } from '@/hooks/useDRS'
import { computeDrsHealthScore } from '@/lib/utils/drs-health'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import { ViewMode, AllVmItem, HostItem, PoolItem, TagItem } from './InventoryTree'
import type { InventorySelection } from './types'
import { useResourceData } from '../resources/hooks/useResourceData'
import { calculateImprovedPredictions } from '../resources/algorithms/improvedPrediction'
import { calculateHealthScoreWithDetails } from '../resources/algorithms/healthScore'
import type { PredictiveAlert } from '../resources/types'

function RootInventoryView({
  allVms,
  hosts,
  pbsServers,
  onVmClick,
  onVmAction,
  onMigrate,
  onNodeClick,
  onSelect,
  favorites,
  onToggleFavorite,
  migratingVmIds,
  onLoadTrendsBatch,
  showIpSnap,
  ipSnapLoading,
  onLoadIpSnap,
  onCreateVm,
  onCreateLxc,
  onBulkAction,
}: {
  allVms: AllVmItem[]
  hosts: HostItem[]
  pbsServers?: { connId: string; name: string; status: string; backupCount: number }[]
  onVmClick: (vm: VmRow) => void
  onVmAction: (vm: VmRow, action: any) => void
  onMigrate: (vm: { connId: string; node: string; type: string; vmid: string | number; name: string }) => void
  onNodeClick: (connId: string, node: string) => void
  onSelect?: (sel: InventorySelection) => void
  favorites?: Set<string>
  onToggleFavorite?: (vm: { id: string; connId: string; node: string; type: string; vmid: string | number; name?: string }) => void
  migratingVmIds?: Set<string>
  onLoadTrendsBatch?: (vms: VmRow[]) => Promise<Record<string, TrendPoint[]>>
  showIpSnap?: boolean
  ipSnapLoading?: boolean
  onLoadIpSnap?: () => void
  onCreateVm?: () => void
  onCreateLxc?: () => void
  onBulkAction?: (host: HostItem, action: BulkAction) => void
}) {
  const t = useTranslations()
  const theme = useTheme()

  // DRS data (Enterprise only)
  const { isEnterprise } = useLicense()
  const { data: drsStatus, isLoading: drsStatusLoading } = useDRSStatus(isEnterprise)
  const { data: drsMetrics, isLoading: drsMetricsLoading } = useDRSMetrics(isEnterprise)

  // Resource data for health banner
  const { kpis, trends, loading: resourceLoading } = useResourceData()

  // Predictive alerts
  const predictiveAlerts = useMemo(() => {
    if (!kpis || !trends || trends.length === 0) return [] as PredictiveAlert[]
    const { alerts } = calculateImprovedPredictions(kpis, trends)
    return alerts
  }, [kpis, trends])

  // Health score
  const { healthScore, healthBreakdown } = useMemo(() => {
    if (!kpis) return { healthScore: 0, healthBreakdown: null }
    const result = calculateHealthScoreWithDetails(kpis, predictiveAlerts)
    return { healthScore: result.score, healthBreakdown: result.breakdown }
  }, [kpis, predictiveAlerts])

  // Resource percentages for bars
  const cpuPct = kpis ? kpis.cpu.used : 0
  const ramPct = kpis ? kpis.ram.used : 0
  const storePct = kpis && kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0

  // Health score display
  const scoreColor = healthScore >= 80 ? theme.palette.success.main
    : healthScore >= 60 ? theme.palette.warning.main
    : healthScore >= 40 ? '#f97316'
    : theme.palette.error.main

  const scoreLabel = healthScore >= 80 ? t('resources.scoreExcellent')
    : healthScore >= 60 ? t('resources.scoreGood')
    : healthScore >= 40 ? t('resources.scoreMonitoring')
    : t('resources.critical')

  const scoreCircumference = 2 * Math.PI * 14
  const scoreDashLen = (healthScore / 100) * scoreCircumference

  // Build score tooltip from breakdown
  const scoreTooltip = useMemo(() => {
    if (!healthBreakdown) return ''
    const lines: string[] = [`Score: ${healthScore}/100`]
    const entries = Object.entries(healthBreakdown) as [string, { penalty: number; reason: string }][]
    for (const [key, { penalty, reason }] of entries) {
      if (penalty !== 0) lines.push(`${key.toUpperCase()}: ${penalty > 0 ? '+' : ''}${penalty} (${reason})`)
    }
    return lines.join('\n')
  }, [healthScore, healthBreakdown])

  // Grouper les VMs par cluster (connexion)
  const clusters = useMemo(() => {
    const map = new Map<string, { connId: string; connName: string; vms: AllVmItem[] }>()
    
    allVms.forEach(vm => {
      if (!map.has(vm.connId)) {
        map.set(vm.connId, { connId: vm.connId, connName: vm.connName, vms: [] })
      }
      map.get(vm.connId)!.vms.push(vm)
    })
    
    return Array.from(map.values()).sort((a, b) => a.connName.localeCompare(b.connName))
  }, [allVms])

  // État pour sections collapsed - par défaut tout est replié (on stocke les IDs dépliés, pas repliés)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set())
  const [expandedHosts, setExpandedHosts] = useState<Set<string>>(new Set())

  // Context menu state for host bulk actions
  const [hostContextMenu, setHostContextMenu] = useState<{
    mouseX: number
    mouseY: number
    host: HostItem
    isCluster: boolean
  } | null>(null)

  const handleHostContextMenu = useCallback((event: React.MouseEvent, host: HostItem, isCluster: boolean) => {
    event.preventDefault()
    event.stopPropagation()
    setHostContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      host,
      isCluster,
    })
  }, [])

  const handleCloseHostContextMenu = useCallback(() => {
    setHostContextMenu(null)
  }, [])

  const handleHostBulkAction = useCallback((action: BulkAction) => {
    if (!hostContextMenu || !onBulkAction) return
    onBulkAction(hostContextMenu.host, action)
    handleCloseHostContextMenu()
  }, [hostContextMenu, onBulkAction, handleCloseHostContextMenu])

  // Wrapper pour onToggleFavorite qui passe le VmRow directement
  const handleToggleFavorite = useCallback((vm: VmRow) => {
    onToggleFavorite?.({
      id: vm.id,
      connId: vm.connId,
      node: vm.node,
      type: vm.type,
      vmid: vm.vmid,
      name: vm.name
    })
  }, [onToggleFavorite])
  
  // Helper pour calculer les stats CPU/RAM d'un groupe de VMs
  const calculateStats = (vms: AllVmItem[]) => {
    const runningVms = vms.filter(vm => vm.status === 'running')
    if (runningVms.length === 0) return { avgCpu: 0, avgRam: 0, totalMem: 0, usedMem: 0 }
    
    let totalCpu = 0
    let totalMem = 0
    let usedMem = 0
    let cpuCount = 0
    let memCount = 0
    
    runningVms.forEach(vm => {
      if (vm.cpu !== undefined) {
        totalCpu += vm.cpu * 100
        cpuCount++
      }
      if (vm.mem !== undefined && vm.maxmem !== undefined && vm.maxmem > 0) {
        usedMem += vm.mem
        totalMem += vm.maxmem
        memCount++
      }
    })
    
    return {
      avgCpu: cpuCount > 0 ? totalCpu / cpuCount : 0,
      avgRam: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
      totalMem,
      usedMem
    }
  }
  
  // Compter les VMs par statut
  const vmStats = useMemo(() => {
    const running = allVms.filter(vm => vm.status === 'running').length
    const stopped = allVms.filter(vm => vm.status === 'stopped').length
    const other = allVms.length - running - stopped
    return { running, stopped, other, total: allVms.length }
  }, [allVms])
  
  // VM type split (QEMU vs LXC)
  const vmTypeSplit = useMemo(() => {
    const qemu = allVms.filter(vm => vm.type === 'qemu').length
    const lxc = allVms.filter(vm => vm.type === 'lxc').length
    return { qemu, lxc, total: allVms.length }
  }, [allVms])

  // Top 3 consumers (running VMs by CPU or RAM)
  const topConsumers = useMemo(() => {
    return allVms
      .filter(vm => vm.status === 'running' && vm.cpu !== undefined)
      .map(vm => ({
        name: vm.name,
        vmid: vm.vmid,
        node: vm.node,
        cpu: (vm.cpu ?? 0) * 100,
        ram: vm.mem !== undefined && vm.maxmem ? (vm.mem / vm.maxmem) * 100 : 0,
      }))
      .sort((a, b) => Math.max(b.cpu, b.ram) - Math.max(a.cpu, a.ram))
      .slice(0, 3)
  }, [allVms])

  // DRS health score averaged across clusters
  const drsHealthScore = useMemo(() => {
    if (!drsMetrics) return null
    const clusters = Object.values(drsMetrics) as any[]
    if (clusters.length === 0) return null
    let total = 0
    for (const cluster of clusters) {
      const breakdown = computeDrsHealthScore(cluster.summary, cluster.nodes)
      total += breakdown.score
    }
    return Math.round(total / clusters.length)
  }, [drsMetrics])

  const toggleCluster = (connId: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev)
      if (next.has(connId)) next.delete(connId)
      else next.add(connId)
      return next
    })
  }
  
  const toggleHost = (key: string) => {
    setExpandedHosts(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  
  // Expand/Collapse all
  const expandAll = () => {
    setExpandedClusters(new Set(clusters.map(c => c.connId)))
    setExpandedHosts(new Set(hosts.map(h => h.key)))
  }
  
  const collapseAll = () => {
    setExpandedClusters(new Set())
    setExpandedHosts(new Set())
  }
  
  // Composant mini barre de progression avec gradient
  const MINI_GRADIENT = 'linear-gradient(90deg, #22c55e 0%, #eab308 50%, #ef4444 100%)'

  const MiniProgressBar = ({ value, label }: { value: number; label: string }) => {
    const v = Math.min(100, value)

    return (
      <MuiTooltip title={`${label}: ${value.toFixed(1)}%`}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 90 }}>
          <Typography variant="caption" sx={{ fontSize: 11, opacity: 0.7, minWidth: 28 }}>{label}</Typography>
          <Box sx={{
            width: 60,
            height: 14,
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
            borderRadius: 0,
            overflow: 'hidden',
            position: 'relative'
          }}>
            <Box sx={{
              width: `${v}%`,
              height: '100%',
              background: MINI_GRADIENT,
              backgroundSize: v > 0 ? `${(100 / v) * 100}% 100%` : '100% 100%',
              borderRadius: 0,
              transition: 'width 0.3s ease',
              position: 'relative',
              '&::after': {
                content: '""',
                position: 'absolute',
                inset: 0,
                borderRadius: 0,
                background: 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 50%)',
                pointerEvents: 'none',
              },
            }} />
            <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
              {value.toFixed(0)}%
            </Typography>
          </Box>
        </Box>
      </MuiTooltip>
    )
  }

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 2.5 }}>
      {/* Health Banner */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
            {/* Left: Score + Counters */}
            <Stack direction="row" alignItems="center" spacing={2.5}>
              {/* Score Ring */}
              {resourceLoading && !kpis ? (
                <Skeleton variant="circular" width={64} height={64} sx={{ flexShrink: 0 }} />
              ) : (
                <MuiTooltip
                  title={<span style={{ whiteSpace: 'pre-line', fontSize: 12 }}>{scoreTooltip}</span>}
                  arrow
                  placement="bottom"
                >
                  <Box sx={{ position: 'relative', width: 64, height: 64, flexShrink: 0, cursor: 'help' }}>
                    <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                      <circle cx="18" cy="18" r="14" fill="none" stroke={theme.palette.divider} strokeWidth="2.5" opacity={0.3} />
                      <circle cx="18" cy="18" r="14" fill="none" stroke={scoreColor} strokeWidth="2.5"
                        strokeDasharray={`${scoreDashLen} ${scoreCircumference}`} strokeLinecap="round"
                        style={{ transition: 'stroke-dasharray 0.6s ease' }} />
                    </svg>
                    <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography sx={{ fontWeight: 900, fontSize: 16, color: scoreColor }}>{healthScore}</Typography>
                    </Box>
                  </Box>
                </MuiTooltip>
              )}

              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" fontWeight={800} noWrap>Infrastructure Health</Typography>
                <Typography variant="body2" sx={{ color: scoreColor, fontWeight: 700, mb: 0.5 }}>{scoreLabel}</Typography>
                <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mt: 0.5 }}>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    <i className="ri-cloud-line" style={{ fontSize: 13, marginRight: 3, verticalAlign: 'middle' }} />
                    {clusters.length} {clusters.length > 1 ? 'clusters' : 'cluster'}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    <i className="ri-server-line" style={{ fontSize: 13, marginRight: 3, verticalAlign: 'middle' }} />
                    {hosts.length} nodes
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    <i className="ri-play-fill" style={{ fontSize: 13, marginRight: 3, verticalAlign: 'middle', color: theme.palette.success.main }} />
                    {vmStats.running} {t('inventory.running')}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    <i className="ri-stop-fill" style={{ fontSize: 13, marginRight: 3, verticalAlign: 'middle' }} />
                    {vmStats.stopped} {t('inventory.stopped')}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.7 }}>
                    <i className="ri-instance-line" style={{ fontSize: 13, marginRight: 3, verticalAlign: 'middle' }} />
                    {vmStats.total} VMs
                  </Typography>
                  {pbsServers && pbsServers.length > 0 && (
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      <i className="ri-hard-drive-2-line" style={{ fontSize: 13, marginRight: 3, verticalAlign: 'middle' }} />
                      {pbsServers.length} PBS
                    </Typography>
                  )}
                </Stack>
              </Box>
            </Stack>

            {/* Right: Resource Bars */}
            <Stack spacing={1.5} justifyContent="center">
              {resourceLoading && !kpis ? (
                <>
                  <Skeleton variant="rounded" height={20} />
                  <Skeleton variant="rounded" height={20} />
                  <Skeleton variant="rounded" height={20} />
                </>
              ) : kpis ? (
                <>
                  {[
                    { label: 'CPU', pct: cpuPct },
                    { label: 'RAM', pct: ramPct },
                    { label: 'Storage', pct: storePct },
                  ].map(({ label, pct }) => (
                    <Stack key={label} direction="row" alignItems="center" spacing={1}>
                      <Typography variant="caption" fontWeight={600} sx={{ minWidth: 42, fontSize: 11 }}>{label}</Typography>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, pct)}
                        sx={{
                          flex: 1,
                          height: 8,
                          borderRadius: 0,
                          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                          '& .MuiLinearProgress-bar': {
                            bgcolor: 'primary.main',
                            borderRadius: 0,
                          },
                        }}
                      />
                      <Typography variant="caption" fontWeight={700} sx={{ minWidth: 36, textAlign: 'right' }}>
                        {pct.toFixed(0)}%
                      </Typography>
                    </Stack>
                  ))}
                  {/* Alert status */}
                  {(() => {
                    const criticals = predictiveAlerts.filter(a => a.severity === 'critical').length
                    const warnings = predictiveAlerts.filter(a => a.severity === 'warning').length
                    if (criticals > 0 || warnings > 0) {
                      return (
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <i className="ri-alarm-warning-line" style={{ fontSize: 13, color: criticals > 0 ? theme.palette.error.main : theme.palette.warning.main }} />
                          <Typography variant="caption" fontWeight={600} sx={{ color: criticals > 0 ? 'error.main' : 'warning.main' }}>
                            {criticals > 0 && `${criticals} critical`}
                            {criticals > 0 && warnings > 0 && ', '}
                            {warnings > 0 && `${warnings} warning${warnings > 1 ? 's' : ''}`}
                          </Typography>
                        </Stack>
                      )
                    }
                    return (
                      <Stack direction="row" alignItems="center" spacing={0.75}>
                        <i className="ri-shield-check-line" style={{ fontSize: 13, color: theme.palette.success.main }} />
                        <Typography variant="caption" fontWeight={600} sx={{ color: 'success.main' }}>
                          {t('resources.noAlerts')}
                        </Typography>
                      </Stack>
                    )
                  })()}
                </>
              ) : null}
            </Stack>
          </Box>

        </CardContent>
      </Card>
      
      {/* Health Overview Cards */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: isEnterprise
          ? { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' }
          : { xs: '1fr', sm: 'repeat(2, 1fr)' },
        gap: 2,
        mb: 2
      }}>
        {/* Card: VM Type Split - Donut chart */}
        <Card variant="outlined" sx={{ p: 0 }}>
          <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: 1.5,
                bgcolor: alpha(theme.palette.info.main, 0.12),
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <i className="ri-instance-line" style={{ fontSize: 18, color: theme.palette.info.main }} />
              </Box>
              <Typography variant="subtitle2" fontWeight={700}>{t('inventory.health.vmTypeSplit')}</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" justifyContent="center" spacing={2}>
              <Box sx={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        ...(vmTypeSplit.qemu > 0 ? [{ name: 'QEMU', value: vmTypeSplit.qemu }] : []),
                        ...(vmTypeSplit.lxc > 0 ? [{ name: 'LXC', value: vmTypeSplit.lxc }] : []),
                        ...(vmTypeSplit.total === 0 ? [{ name: 'empty', value: 1 }] : []),
                      ]}
                      cx="50%" cy="50%" innerRadius={28} outerRadius={40}
                      dataKey="value" stroke="none" paddingAngle={vmTypeSplit.total > 0 ? 3 : 0}
                    >
                      {vmTypeSplit.qemu > 0 && <Cell fill={theme.palette.info.main} />}
                      {vmTypeSplit.lxc > 0 && <Cell fill="#a855f7" />}
                      {vmTypeSplit.total === 0 && <Cell fill={theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                  <Typography variant="caption" fontWeight={800} sx={{ fontSize: 15, lineHeight: 1 }}>{vmTypeSplit.total}</Typography>
                </Box>
              </Box>
              <Stack spacing={0.5}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'info.main' }} />
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>QEMU</Typography>
                  <Typography variant="caption" fontWeight={700}>{vmTypeSplit.qemu}</Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#a855f7' }} />
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>LXC</Typography>
                  <Typography variant="caption" fontWeight={700}>{vmTypeSplit.lxc}</Typography>
                </Stack>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* Card 4: Top Consumers - Donut chart */}
        <Card variant="outlined" sx={{ p: 0 }}>
          <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: 1.5,
                bgcolor: alpha(theme.palette.error.main, 0.12),
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <i className="ri-fire-line" style={{ fontSize: 18, color: theme.palette.error.main }} />
              </Box>
              <Typography variant="subtitle2" fontWeight={700}>{t('inventory.health.topConsumers')}</Typography>
            </Stack>
            {topConsumers.length > 0 ? (
              <Stack direction="row" alignItems="center" justifyContent="center" spacing={2}>
                <Box sx={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={topConsumers.map(vm => ({ name: vm.name, value: Math.round(Math.max(vm.cpu, vm.ram)) }))}
                        cx="50%" cy="50%" innerRadius={28} outerRadius={40}
                        dataKey="value" stroke="none" paddingAngle={3}
                      >
                        {topConsumers.map((_, i) => (
                          <Cell key={i} fill={[theme.palette.error.main, theme.palette.warning.main, theme.palette.info.main][i] || theme.palette.grey[500]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                    <Typography variant="caption" fontWeight={800} sx={{ fontSize: 13, lineHeight: 1 }}>TOP</Typography>
                  </Box>
                </Box>
                <Stack spacing={0.5}>
                  {topConsumers.map((vm, i) => (
                    <Stack key={`${vm.node}-${vm.vmid}`} direction="row" alignItems="center" spacing={0.5}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: [theme.palette.error.main, theme.palette.warning.main, theme.palette.info.main][i] }} />
                      <Typography variant="caption" sx={{ opacity: 0.8, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{vm.name}</Typography>
                      <Typography variant="caption" fontWeight={700}>{Math.round(Math.max(vm.cpu, vm.ram))}%</Typography>
                    </Stack>
                  ))}
                </Stack>
              </Stack>
            ) : (
              <Typography variant="caption" sx={{ opacity: 0.5 }}>—</Typography>
            )}
          </CardContent>
        </Card>

        {/* Card 5: DRS (Enterprise only) */}
        {isEnterprise && (
          <Card variant="outlined" sx={{ p: 0 }}>
            <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                <Box sx={{
                  width: 32, height: 32, borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.success.main, 0.12),
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <i className="ri-refresh-line" style={{ fontSize: 18, color: theme.palette.success.main }} />
                </Box>
                <Typography variant="subtitle2" fontWeight={700} sx={{ flex: 1, minWidth: 0 }}>Distributed Resource Scheduler (DRS)</Typography>
                <Chip
                  size="small"
                  label={`Mode: ${(drsStatus?.mode || 'manual').charAt(0).toUpperCase() + (drsStatus?.mode || 'manual').slice(1)}`}
                  color={drsStatus?.mode === 'automatic' ? 'success' : drsStatus?.mode === 'partial' ? 'warning' : 'info'}
                  variant="outlined"
                  sx={{ flexShrink: 0, height: 22, fontSize: 11, fontWeight: 600 }}
                />
              </Stack>

              {(drsStatusLoading || drsMetricsLoading) ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 3 }}>
                  <CircularProgress size={24} />
                </Box>
              ) : !drsStatus?.enabled ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 2, opacity: 0.5 }}>
                  <i className="ri-pause-circle-line" style={{ fontSize: 28, marginBottom: 4 }} />
                  <Typography variant="caption">Disabled</Typography>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 1 }}>
                  {drsHealthScore !== null && (() => {
                    const scoreColor = drsHealthScore >= 80 ? theme.palette.success.main : drsHealthScore >= 50 ? theme.palette.warning.main : theme.palette.error.main
                    const scoreLabel = drsHealthScore >= 80 ? 'Healthy' : drsHealthScore >= 50 ? 'Attention' : 'Critical'
                    const circumference = 2 * Math.PI * 14
                    const dashLen = (drsHealthScore / 100) * circumference

                    return (
                      <Stack alignItems="center" spacing={0.5}>
                        {/* ScoreRing — larger */}
                        <Box sx={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
                          <svg viewBox="0 0 36 36" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
                            <circle cx="18" cy="18" r="14" fill="none" stroke={theme.palette.divider} strokeWidth="2.5" opacity={0.3} />
                            <circle cx="18" cy="18" r="14" fill="none" stroke={scoreColor} strokeWidth="2.5"
                              strokeDasharray={`${dashLen} ${circumference}`} strokeLinecap="round"
                              style={{ transition: 'stroke-dasharray 0.6s ease' }} />
                          </svg>
                          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Typography variant="h6" sx={{ fontWeight: 800, color: scoreColor }}>{drsHealthScore}</Typography>
                          </Box>
                        </Box>
                        <Typography variant="body2" fontWeight={700} sx={{ color: scoreColor }}>{scoreLabel}</Typography>
                      </Stack>
                    )
                  })()}
                </Box>
              )}
            </CardContent>
          </Card>
        )}
      </Box>

      {/* Séparateur PVE */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <i className="ri-server-fill" style={{ fontSize: 16, color: '#F29221' }} />
        <Typography variant="subtitle2" fontWeight={700} sx={{ opacity: 0.7 }}>{t('inventory.proxmoxVe')}</Typography>
        <Box sx={{ flex: 1, height: 1, bgcolor: 'divider', ml: 1 }} />
      </Box>

      {/* Liste des Clusters avec leurs Hosts et VMs */}
      <Stack spacing={2}>
        {clusters.map(cluster => {
          const isClusterCollapsed = !expandedClusters.has(cluster.connId)
          const clusterHosts = hosts.filter(h => h.connId === cluster.connId)
          const runningCount = cluster.vms.filter(vm => vm.status === 'running').length
          const clusterStats = calculateStats(cluster.vms)
          const isRealCluster = clusterHosts.length > 1 // Vrai cluster si plusieurs nodes
          
          return (
            <Card key={cluster.connId} variant="outlined">
              {/* Header Cluster */}
              <Box 
                onClick={() => toggleCluster(cluster.connId)}
                sx={{ 
                  px: 2, 
                  py: 1.5, 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1.5,
                  cursor: 'pointer',
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(242, 146, 33, 0.08)' : 'rgba(242, 146, 33, 0.05)',
                  borderBottom: isClusterCollapsed ? 'none' : '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: theme.palette.mode === 'dark' ? 'rgba(242, 146, 33, 0.12)' : 'rgba(242, 146, 33, 0.08)' }
                }}
              >
                <i 
                  className={isClusterCollapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} 
                  style={{ fontSize: 20, opacity: 0.7 }} 
                />
                <i className={isRealCluster ? "ri-cloud-fill" : "ri-server-fill"} style={{ fontSize: 18, color: '#F29221' }} />
                <Typography fontWeight={700}>{cluster.connName}</Typography>
                <Chip 
                  size="small" 
                  label={`${clusterHosts.length} ${t('inventory.nodes')}`} 
                  sx={{ height: 20, fontSize: 11 }} 
                />
                <Chip 
                  size="small" 
                  label={`${cluster.vms.length} VMs`} 
                  sx={{ height: 20, fontSize: 11 }} 
                />
                <Chip 
                  size="small" 
                  label={t('inventory.nRunning', { count: runningCount })} 
                  color="success"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11 }} 
                />
                
                {/* Indicateurs CPU/RAM du cluster */}
                <Box sx={{ ml: 'auto', display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                  <MiniProgressBar value={clusterStats.avgCpu} label="CPU" />
                  <MiniProgressBar value={clusterStats.avgRam} label="RAM" />
                </Box>
              </Box>
              
              {/* Contenu Cluster (Hosts) */}
              {!isClusterCollapsed && (
                <Box sx={{ pl: 2 }}>
                  {clusterHosts.map(host => {
                    const isHostCollapsed = !expandedHosts.has(host.key)
                    const hostRunning = host.vms.filter(vm => vm.status === 'running').length
                    const hostStats = calculateStats(host.vms)
                    
                    return (
                      <Box key={host.key}>
                        {/* Header Host */}
                        <Box
                          onClick={() => toggleHost(host.key)}
                          onContextMenu={(e) => onBulkAction && handleHostContextMenu(e, host, isRealCluster)}
                          sx={{
                            px: 2,
                            py: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 1.5,
                            cursor: 'pointer',
                            borderBottom: '1px solid',
                            borderColor: 'divider',
                            '&:hover': { bgcolor: 'action.hover' }
                          }}
                        >
                          <i 
                            className={isHostCollapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} 
                            style={{ fontSize: 18, opacity: 0.7 }} 
                          />
                          <i className="ri-server-fill" style={{ fontSize: 16, opacity: 0.7 }} />
                          <Typography 
                            variant="body2" 
                            fontWeight={600}
                            sx={{ 
                              cursor: 'pointer',
                              '&:hover': { color: 'primary.main', textDecoration: 'underline' }
                            }}
                            onClick={(e) => {
                              e.stopPropagation()
                              onNodeClick(host.connId, host.node)
                            }}
                          >
                            {host.node}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.5 }}>
                            {t('inventory.vmsAndRunning', { vms: host.vms.length, running: hostRunning })}
                          </Typography>
                          
                          {/* Indicateurs CPU/RAM du host */}
                          <Box sx={{ ml: 'auto', display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                            <MiniProgressBar value={hostStats.avgCpu} label="CPU" />
                            <MiniProgressBar value={hostStats.avgRam} label="RAM" />
                          </Box>
                        </Box>
                        
                        {/* VMs du Host */}
                        {!isHostCollapsed && host.vms.length > 0 && (
                          <Box sx={{ pl: 2, py: 1 }}>
                            <VmsTable
                              vms={host.vms.map(vm => ({
                                id: `${vm.connId}:${vm.node}:${vm.type}:${vm.vmid}`,
                                connId: vm.connId,
                                node: vm.node,
                                vmid: vm.vmid,
                                name: vm.name,
                                type: vm.type,
                                status: vm.status || 'unknown',
                                cpu: vm.status === 'running' && vm.cpu !== undefined ? Math.min(100, vm.cpu * 100) : undefined,
                                ram: vm.status === 'running' && vm.mem !== undefined && vm.maxmem ? (vm.mem / vm.maxmem) * 100 : undefined,
                                maxmem: vm.maxmem,
                                maxdisk: vm.maxdisk,
                                uptime: vm.uptime,
                                ip: vm.ip,
                                snapshots: vm.snapshots,
                                tags: vm.tags,
                                template: vm.template,
                                isCluster: vm.isCluster,
                                osInfo: vm.osInfo,
                              }))}
                              compact
                              showActions
                              onVmClick={onVmClick}
                              onVmAction={onVmAction}
                              onMigrate={onMigrate}
                              maxHeight={300}
                              favorites={favorites}
                              onToggleFavorite={handleToggleFavorite}
                              migratingVmIds={migratingVmIds}
                            />
                          </Box>
                        )}
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Card>
          )
        })}

        {/* Séparateur PBS */}
        {pbsServers && pbsServers.length > 0 && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 3, mb: 1 }}>
              <i className="ri-hard-drive-2-fill" style={{ fontSize: 16, color: '#2196f3' }} />
              <Typography variant="subtitle2" fontWeight={700} sx={{ opacity: 0.7 }}>{t('inventory.proxmoxBackupServer')}</Typography>
              <Chip size="small" label={t('inventory.nBackups', { count: pbsServers.reduce((acc, pbs) => acc + pbs.backupCount, 0) })} sx={{ height: 18, fontSize: 10, ml: 1 }} />
              <Box sx={{ flex: 1, height: 1, bgcolor: 'divider', ml: 1 }} />
            </Box>

            <Stack spacing={1}>
              {pbsServers.map(pbs => (
                <Card 
                  key={pbs.connId}
                  variant="outlined"
                  onClick={() => onSelect?.({ type: 'pbs', id: pbs.connId })}
                  sx={{ 
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' }
                  }}
                >
                  <Box 
                    sx={{ 
                      px: 2, 
                      py: 1.5, 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 1.5,
                      bgcolor: theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.08)' : 'rgba(33, 150, 243, 0.05)',
                    }}
                  >
                    <i className="ri-hard-drive-2-fill" style={{ fontSize: 18, color: '#2196f3' }} />
                    <Typography fontWeight={700}>{pbs.name}</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>
                      {t('inventory.nBackups', { count: pbs.backupCount })}
                    </Typography>
                  </Box>
                </Card>
              ))}
            </Stack>
          </>
        )}
      </Stack>

      {/* Context menu for host bulk actions */}
      {onBulkAction && (
        <Menu
          open={hostContextMenu !== null}
          onClose={handleCloseHostContextMenu}
          anchorReference="anchorPosition"
          anchorPosition={
            hostContextMenu !== null
              ? { top: hostContextMenu.mouseY, left: hostContextMenu.mouseX }
              : undefined
          }
        >
          {/* Header */}
          <Box sx={{ px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle2" fontWeight={600}>
              {hostContextMenu?.host.node}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {hostContextMenu?.host.vms.length ?? 0} VMs
            </Typography>
          </Box>

          <MenuItem onClick={() => handleHostBulkAction('start-all')}>
            <ListItemIcon>
              <PlayArrowIcon fontSize="small" sx={{ color: 'success.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.startAllVms')}</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => handleHostBulkAction('shutdown-all')}>
            <ListItemIcon>
              <PowerSettingsNewIcon fontSize="small" sx={{ color: 'warning.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.shutdownAllVms')}</ListItemText>
          </MenuItem>

          <MenuItem onClick={() => handleHostBulkAction('stop-all')}>
            <ListItemIcon>
              <StopIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            <ListItemText>{t('bulkActions.stopAllVms')}</ListItemText>
          </MenuItem>

          {hostContextMenu?.isCluster && (
            <>
              <Divider />
              <MenuItem onClick={() => handleHostBulkAction('migrate-all')}>
                <ListItemIcon>
                  <MoveUpIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t('bulkActions.migrateAllVms')}</ListItemText>
              </MenuItem>
            </>
          )}
        </Menu>
      )}
    </Box>
  )
}


export default RootInventoryView
