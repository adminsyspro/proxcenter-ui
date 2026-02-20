'use client'

import React, { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
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

import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import { ViewMode, AllVmItem, HostItem, PoolItem, TagItem } from './InventoryTree'
import type { InventorySelection } from './types'

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
  
  // Global resource stats
  const globalStats = useMemo(() => calculateStats(allVms), [allVms])

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
      {/* Header */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2}>
            <Stack direction="row" alignItems="center" spacing={2}>
              <Box
                component="img"
                src="/images/proxcenter-logo.svg"
                alt="ProxCenter"
                sx={{ width: 44, height: 44 }}
              />
              <Box>
                <Typography variant="h5" fontWeight={900} sx={{ letterSpacing: 1 }}>PROXCENTER</Typography>
                <Typography variant="body2" color="text.secondary">
                  {clusters.length > 1 ? t('inventory.clustersCount', { count: clusters.length }) : t('inventory.clusterCount', { count: clusters.length })} • {hosts.length} {t('inventory.nodes')} • {vmStats.total} VMs{pbsServers && pbsServers.length > 0 ? ` • ${pbsServers.length} PBS` : ''}
                </Typography>
              </Box>
            </Stack>
            
            {/* Stats rapides */}
            <Stack direction="row" spacing={3}>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="success.main">{vmStats.running}</Typography>
                <Typography variant="caption" color="text.secondary">{t('inventory.running')}</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="text.disabled">{vmStats.stopped}</Typography>
                <Typography variant="caption" color="text.secondary">{t('inventory.stopped')}</Typography>
              </Box>
              <Box sx={{ textAlign: 'center' }}>
                <Typography variant="h4" fontWeight={900} color="primary.main">{hosts.length}</Typography>
                <Typography variant="caption" color="text.secondary">{t('inventory.nodes')}</Typography>
              </Box>
              {pbsServers && pbsServers.length > 0 && (
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h4" fontWeight={900} sx={{ color: '#2196f3' }}>{pbsServers.length}</Typography>
                  <Typography variant="caption" color="text.secondary">PBS</Typography>
                </Box>
              )}
            </Stack>
            
            {/* Actions */}
            <Stack direction="row" spacing={1}>
              {onCreateVm && (
                <Button
                  size="small"
                  variant="contained"
                  startIcon={<i className="ri-add-line" />}
                  onClick={onCreateVm}
                  sx={{ textTransform: 'none' }}
                >
                  {t('common.create')} VM
                </Button>
              )}
              {onCreateLxc && (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<i className="ri-add-line" />}
                  onClick={onCreateLxc}
                  sx={{ textTransform: 'none' }}
                >
                  {t('common.create')} LXC
                </Button>
              )}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              <IconButton size="small" onClick={expandAll} title={t('common.expandAll')}>
                <i className="ri-expand-diagonal-line" style={{ fontSize: 16 }} />
              </IconButton>
              <IconButton size="small" onClick={collapseAll} title={t('common.collapseAll')}>
                <i className="ri-collapse-diagonal-line" style={{ fontSize: 16 }} />
              </IconButton>
            </Stack>
          </Stack>
        </CardContent>
      </Card>
      
      {/* Health Overview Cards */}
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
        gap: 2,
        mb: 2
      }}>
        {/* Card 1: Resource Usage - Donut gauges */}
        <Card variant="outlined" sx={{ p: 0 }}>
          <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: 1.5,
                bgcolor: alpha(theme.palette.info.main, 0.12),
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <i className="ri-cpu-line" style={{ fontSize: 18, color: theme.palette.info.main }} />
              </Box>
              <Typography variant="subtitle2" fontWeight={700}>{t('inventory.health.resourceUsage')}</Typography>
            </Stack>
            <Stack direction="row" justifyContent="space-around" alignItems="center">
              {/* CPU gauge */}
              {(() => {
                const cpuColor = globalStats.avgCpu > 90 ? theme.palette.error.main : globalStats.avgCpu > 70 ? theme.palette.warning.main : theme.palette.info.main
                const cpuData = [
                  { value: globalStats.avgCpu },
                  { value: Math.max(0, 100 - globalStats.avgCpu) },
                ]
                return (
                  <Box sx={{ position: 'relative', width: 80, height: 80 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={cpuData} cx="50%" cy="50%" innerRadius={26} outerRadius={36} startAngle={90} endAngle={-270} dataKey="value" stroke="none">
                          <Cell fill={cpuColor} />
                          <Cell fill={theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                      <Typography variant="caption" fontWeight={800} sx={{ fontSize: 13, color: cpuColor, lineHeight: 1 }}>
                        {globalStats.avgCpu.toFixed(0)}%
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: -0.5, opacity: 0.7, fontSize: 11 }}>CPU</Typography>
                  </Box>
                )
              })()}
              {/* RAM gauge */}
              {(() => {
                const ramColor = globalStats.avgRam > 90 ? theme.palette.error.main : globalStats.avgRam > 70 ? theme.palette.warning.main : theme.palette.secondary.main
                const ramData = [
                  { value: globalStats.avgRam },
                  { value: Math.max(0, 100 - globalStats.avgRam) },
                ]
                return (
                  <Box sx={{ position: 'relative', width: 80, height: 80 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={ramData} cx="50%" cy="50%" innerRadius={26} outerRadius={36} startAngle={90} endAngle={-270} dataKey="value" stroke="none">
                          <Cell fill={ramColor} />
                          <Cell fill={theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                    <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                      <Typography variant="caption" fontWeight={800} sx={{ fontSize: 13, color: ramColor, lineHeight: 1 }}>
                        {globalStats.avgRam.toFixed(0)}%
                      </Typography>
                    </Box>
                    <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: -0.5, opacity: 0.7, fontSize: 11 }}>RAM</Typography>
                  </Box>
                )
              })()}
            </Stack>
          </CardContent>
        </Card>

        {/* Card 2: VM Distribution - Donut chart */}
        <Card variant="outlined" sx={{ p: 0 }}>
          <CardContent sx={{ py: 2, px: 2.5, '&:last-child': { pb: 2 } }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Box sx={{
                width: 32, height: 32, borderRadius: 1.5,
                bgcolor: alpha(theme.palette.success.main, 0.12),
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <i className="ri-pie-chart-line" style={{ fontSize: 18, color: theme.palette.success.main }} />
              </Box>
              <Typography variant="subtitle2" fontWeight={700}>{t('inventory.health.vmDistribution')}</Typography>
            </Stack>
            <Stack direction="row" alignItems="center" justifyContent="center" spacing={2}>
              <Box sx={{ position: 'relative', width: 90, height: 90, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        ...(vmStats.running > 0 ? [{ name: t('inventory.health.running'), value: vmStats.running }] : []),
                        ...(vmStats.stopped > 0 ? [{ name: t('inventory.health.stopped'), value: vmStats.stopped }] : []),
                        ...(vmStats.other > 0 ? [{ name: t('inventory.health.other'), value: vmStats.other }] : []),
                        ...(vmStats.total === 0 ? [{ name: 'empty', value: 1 }] : []),
                      ]}
                      cx="50%" cy="50%" innerRadius={28} outerRadius={40}
                      dataKey="value" stroke="none" paddingAngle={vmStats.total > 0 ? 3 : 0}
                    >
                      {vmStats.running > 0 && <Cell fill={theme.palette.success.main} />}
                      {vmStats.stopped > 0 && <Cell fill={theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)'} />}
                      {vmStats.other > 0 && <Cell fill={theme.palette.warning.main} />}
                      {vmStats.total === 0 && <Cell fill={theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'} />}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                  <Typography variant="caption" fontWeight={800} sx={{ fontSize: 15, lineHeight: 1 }}>{vmStats.total}</Typography>
                </Box>
              </Box>
              <Stack spacing={0.5}>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>{t('inventory.health.running')}</Typography>
                  <Typography variant="caption" fontWeight={700}>{vmStats.running}</Typography>
                </Stack>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)' }} />
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>{t('inventory.health.stopped')}</Typography>
                  <Typography variant="caption" fontWeight={700}>{vmStats.stopped}</Typography>
                </Stack>
                {vmStats.other > 0 && (
                  <Stack direction="row" alignItems="center" spacing={0.5}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'warning.main' }} />
                    <Typography variant="caption" sx={{ opacity: 0.8 }}>{t('inventory.health.other')}</Typography>
                    <Typography variant="caption" fontWeight={700}>{vmStats.other}</Typography>
                  </Stack>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        {/* Card 3: VM Type Split - Donut chart */}
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
