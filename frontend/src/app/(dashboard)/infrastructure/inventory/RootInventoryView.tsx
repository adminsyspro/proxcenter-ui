'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { PieChart, Pie, Cell, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid } from 'recharts'
import { BulkAction } from '@/components/NodesTable'
import VmsTable, { VmRow, TrendPoint } from '@/components/VmsTable'
import { ViewMode, AllVmItem, HostItem, PoolItem, TagItem } from './InventoryTree'
import type { InventorySelection } from './types'
import { fetchRrd, buildSeriesFromRrd, formatTime, formatBps } from './helpers'
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
  clusterStorages = [],
  externalHypervisors = [],
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
  clusterStorages?: import('./InventoryTree').TreeClusterStorage[]
  externalHypervisors?: { id: string; name: string; type: string; vms?: { vmid: string; name: string; status: string }[] }[]
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
    if (!kpis) return { healthScore: null, healthBreakdown: null }
    const result = calculateHealthScoreWithDetails(kpis, predictiveAlerts)
    return { healthScore: result.score, healthBreakdown: result.breakdown }
  }, [kpis, predictiveAlerts])

  // Resource percentages for bars
  const cpuPct = kpis ? kpis.cpu.used : 0
  const ramPct = kpis ? kpis.ram.used : 0
  const storePct = kpis && kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0

  // Health score display
  const scoreColor = healthScore === null ? theme.palette.text.disabled
    : healthScore >= 80 ? theme.palette.success.main
    : healthScore >= 60 ? theme.palette.warning.main
    : healthScore >= 40 ? '#f97316'
    : theme.palette.error.main

  const scoreLabel = healthScore === null ? t('resources.calculating', { defaultMessage: 'Calculating…' })
    : healthScore >= 80 ? t('resources.scoreExcellent')
    : healthScore >= 60 ? t('resources.scoreGood')
    : healthScore >= 40 ? t('resources.scoreMonitoring')
    : t('resources.critical')

  const scoreCircumference = 2 * Math.PI * 14
  const scoreDashLen = ((healthScore ?? 0) / 100) * scoreCircumference

  // Translate breakdown reasons (same logic as Resources page GlobalHealthScore)
  const trReason = (reason: string) => reason
    .replace(/\(critical\)/g, `(${t('resources.critical')})`)
    .replace(/\(warning\)/g, `(${t('resources.attention')})`)
    .replace(/\(underused\)/g, `(${t('resources.underused')})`)
    .replace(/\(excellent\)/g, `(${t('resources.scoreExcellent')})`)
    .replace(/\(good\)/g, `(${t('resources.scoreGood')})`)
    .replace(/^No alerts$/, t('resources.noAlerts'))
    .replace(/(\d+) critical/, `$1 ${t('resources.critical')}`)
    .replace(/(\d+) warning/, `$1 ${t('resources.attention')}`)

  // Build score tooltip rows from breakdown
  const scoreTooltipRows = useMemo(() => {
    if (!healthBreakdown) return null
    return [
      { label: 'CPU', reason: healthBreakdown.cpu.reason, penalty: healthBreakdown.cpu.penalty },
      { label: 'RAM', reason: healthBreakdown.ram.reason, penalty: healthBreakdown.ram.penalty },
      { label: t('resources.storageLabel'), reason: healthBreakdown.storage.reason, penalty: healthBreakdown.storage.penalty },
      { label: t('resources.alerts'), reason: healthBreakdown.alerts.reason, penalty: healthBreakdown.alerts.penalty },
      { label: t('resources.efficiency'), reason: healthBreakdown.efficiency.reason, penalty: healthBreakdown.efficiency.penalty },
    ]
  }, [healthBreakdown, t])

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
  const [isHydrated, setIsHydrated] = useState(false)

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const savedClusters = localStorage.getItem('rootViewExpandedClusters')
      if (savedClusters) setExpandedClusters(new Set(JSON.parse(savedClusters)))
      const savedHosts = localStorage.getItem('rootViewExpandedHosts')
      if (savedHosts) setExpandedHosts(new Set(JSON.parse(savedHosts)))
    } catch {}
    setIsHydrated(true)
  }, [])

  // Persist
  useEffect(() => {
    if (isHydrated) localStorage.setItem('rootViewExpandedClusters', JSON.stringify([...expandedClusters]))
  }, [expandedClusters, isHydrated])

  useEffect(() => {
    if (isHydrated) localStorage.setItem('rootViewExpandedHosts', JSON.stringify([...expandedHosts]))
  }, [expandedHosts, isHydrated])

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

  // Per-node RRD graphs for infrastructure overview
  const [infraRrdTf, setInfraRrdTf] = useState<'hour' | 'day' | 'week' | 'month' | 'year'>('hour')
  const [infraRrdPerNode, setInfraRrdPerNode] = useState<Record<string, any[]>>({})
  const [infraRrdNodeNames, setInfraRrdNodeNames] = useState<string[]>([])
  const [infraRrdSeries, setInfraRrdSeries] = useState<any[]>([])
  const [infraRrdLoading, setInfraRrdLoading] = useState(false)
  const [infraRrdHiddenNodes, setInfraRrdHiddenNodes] = useState<Set<string>>(new Set())
  const [expandedGraph, setExpandedGraph] = useState<string | null>(null)

  const toggleNodeVisibility = (name: string) => {
    setInfraRrdHiddenNodes(prev => {
      // If this node is already isolated (all others hidden), show all
      const allOthersHidden = infraRrdNodeNames.every(n => n === name || prev.has(n))
      if (allOthersHidden) {
        return new Set()
      }
      // Isolate: hide all others, show only this one
      return new Set(infraRrdNodeNames.filter(n => n !== name))
    })
  }

  const infraNodeColors = useMemo(() => {
    const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1']
    const map: Record<string, string> = {}
    infraRrdNodeNames.forEach((name, i) => { map[name] = palette[i % palette.length] })
    return map
  }, [infraRrdNodeNames])

  // Stable key: only re-fetch RRD when the actual node list changes, not on every hosts reference update
  // Debounced to avoid multiple fetch cycles during progressive SSE inventory loading
  const hostsRef = useRef(hosts)
  hostsRef.current = hosts
  const rawInfraRrdNodesKey = useMemo(() => {
    return hosts.map(h => `${h.connId}|${h.node}`).sort().join(',')
  }, [hosts])
  const [infraRrdNodesKey, setInfraRrdNodesKey] = useState(rawInfraRrdNodesKey)
  useEffect(() => {
    if (rawInfraRrdNodesKey === infraRrdNodesKey) return
    console.log(`[infra-rrd] Debounce: hosts changed (${hosts.length} hosts), waiting 1s...`)
    const timer = setTimeout(() => {
      console.log(`[infra-rrd] Debounce: committed (${hosts.length} hosts)`)
      setInfraRrdNodesKey(rawInfraRrdNodesKey)
    }, 1000)
    return () => clearTimeout(timer)
  }, [rawInfraRrdNodesKey])

  useEffect(() => {
    const currentHosts = hostsRef.current
    if (currentHosts.length === 0) return
    const abortController = new AbortController()
    setInfraRrdLoading(true)

    console.log(`[infra-rrd] Starting RRD fetch for ${currentHosts.length} hosts, timeframe=${infraRrdTf}`)
    console.log(`[infra-rrd] Hosts:`, currentHosts.map(h => `${h.node} (connId=${h.connId})`))
    console.log(`[infra-rrd] Debounced key: ${infraRrdNodesKey.length > 80 ? infraRrdNodesKey.substring(0, 80) + '...' : infraRrdNodesKey}`)

    ;(async () => {
      const perNode: Record<string, any[]> = {}

      const results = await Promise.allSettled(currentHosts.map(async (host) => {
        const t0 = performance.now()
        try {
          const raw = await fetchRrd(host.connId, `/nodes/${host.node}`, infraRrdTf, abortController.signal)
          const duration = Math.round(performance.now() - t0)
          if (!abortController.signal.aborted) {
            const series = buildSeriesFromRrd(raw)
            perNode[host.node] = series
            console.log(`[infra-rrd] ✓ ${host.node}: ${duration}ms, ${raw.length} raw → ${series.length} pts`)
          }
          return { node: host.node, ok: true, duration, points: raw.length }
        } catch (e) {
          const duration = Math.round(performance.now() - t0)
          if (!abortController.signal.aborted) {
            console.warn(`[infra-rrd] ✗ ${host.node}: FAILED ${duration}ms:`, e)
          }
          return { node: host.node, ok: false, duration, error: String(e) }
        }
      }))
      if (abortController.signal.aborted) {
        console.log(`[infra-rrd] Aborted (stale effect)`)
        return
      }

      const nodeNames = Object.keys(perNode).sort()
      const failed = currentHosts.filter(h => !perNode[h.node]).map(h => h.node)
      console.log(`[infra-rrd] Done: ${nodeNames.length}/${currentHosts.length} OK, failed=[${failed.join(', ')}]`)

      setInfraRrdPerNode(perNode)
      setInfraRrdNodeNames(nodeNames)

      // Snap timestamps to a common grid so data from different clusters aligns
      const resolutionMs: Record<string, number> = {
        hour: 60_000, day: 1_800_000, week: 10_800_000, month: 43_200_000, year: 604_800_000,
      }
      const snapRes = resolutionMs[infraRrdTf] || 60_000

      // Merge into unified time series with per-node keys
      const timeMap = new Map<number, Record<string, number>>()
      for (const [nodeName, series] of Object.entries(perNode)) {
        for (const point of series) {
          if (!point.t) continue
          const snapped = Math.round(point.t / snapRes) * snapRes
          if (!timeMap.has(snapped)) timeMap.set(snapped, { t: snapped })
          const entry = timeMap.get(snapped)!
          if (point.cpuPct != null) entry[`cpu_${nodeName}`] = point.cpuPct
          if (point.ramPct != null) entry[`ram_${nodeName}`] = point.ramPct
          if (point.netInBps != null) entry[`netIn_${nodeName}`] = point.netInBps
          if (point.netOutBps != null) entry[`netOut_${nodeName}`] = point.netOutBps
          if (point.loadAvg != null) entry[`load_${nodeName}`] = point.loadAvg
        }
      }

      const merged = Array.from(timeMap.values()).sort((a, b) => a.t - b.t)

      // Fill gaps: PVE 8 vs 9 return different point counts for the same timeframe,
      // causing gaps where some nodes have no data at certain time slots.
      // Forward-fill then backward-fill to cover both trailing and leading gaps.
      const keys = nodeNames.flatMap(name => ['cpu_', 'ram_', 'netIn_', 'netOut_', 'load_'].map(p => `${p}${name}`))
      // Forward-fill: propagate last known value
      const lastKnown: Record<string, number> = {}
      for (const slot of merged) {
        for (const key of keys) {
          if (slot[key] != null) {
            lastKnown[key] = slot[key]
          } else if (lastKnown[key] != null) {
            slot[key] = lastKnown[key]
          }
        }
      }
      // Backward-fill: fill leading gaps with the first known value
      const firstKnown: Record<string, number> = {}
      for (let i = merged.length - 1; i >= 0; i--) {
        const slot = merged[i]
        for (const key of keys) {
          if (slot[key] != null) {
            firstKnown[key] = slot[key]
          } else if (firstKnown[key] != null) {
            slot[key] = firstKnown[key]
          }
        }
      }

      console.log(`[infra-rrd] Merged: ${merged.length} time slots, ${nodeNames.length} nodes (gap-filled)`)

      setInfraRrdSeries(merged)
      setInfraRrdLoading(false)
    })()

    return () => { abortController.abort() }
  }, [infraRrdNodesKey, infraRrdTf])

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

  const isAllExpanded = expandedClusters.size > 0 || expandedHosts.size > 0
  
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
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr auto' }, gap: 3 }}>
            {/* Left: Score + Counters */}
            <Stack direction="row" alignItems="center" spacing={2.5}>
              {/* Score Ring */}
              {resourceLoading && !kpis ? (
                <Skeleton variant="circular" width={64} height={64} sx={{ flexShrink: 0 }} />
              ) : (
                <MuiTooltip
                  title={scoreTooltipRows ? (
                    <Box sx={{ fontSize: '0.75rem', py: 0.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.75 }}>{t('resources.scoreCalculation')}</Typography>
                      {scoreTooltipRows.map(row => (
                        <Box key={row.label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25 }}>
                          <span>{row.label}: {trReason(row.reason)}</span>
                          <span style={{ fontWeight: 700, opacity: 0.8 }}>
                            {row.penalty === 0 ? 'OK' : row.penalty > 0 ? `+${row.penalty}` : row.penalty}
                          </span>
                        </Box>
                      ))}
                    </Box>
                  ) : ''}
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
                      <Typography sx={{ fontWeight: 700, fontSize: 16, color: scoreColor }}>{healthScore ?? '—'}</Typography>
                    </Box>
                  </Box>
                </MuiTooltip>
              )}

              <Box sx={{ minWidth: 0 }}>
                <Stack direction="row" alignItems="center" gap={1.5} flexWrap="wrap">
                  <Typography variant="h6" fontWeight={600} noWrap>Infrastructure Health</Typography>
                  {/* Alert status badge */}
                  {(() => {
                    const criticals = predictiveAlerts.filter(a => a.severity === 'critical').length
                    const warnings = predictiveAlerts.filter(a => a.severity === 'warning').length
                    if (criticals > 0 || warnings > 0) {
                      return (
                        <Stack direction="row" alignItems="center" spacing={0.5} sx={{ bgcolor: alpha(criticals > 0 ? theme.palette.error.main : theme.palette.warning.main, 0.1), px: 1, py: 0.25, borderRadius: 1 }}>
                          <i className="ri-alarm-warning-line" style={{ fontSize: 13, color: criticals > 0 ? theme.palette.error.main : theme.palette.warning.main }} />
                          <Typography variant="caption" fontWeight={600} sx={{ color: criticals > 0 ? 'error.main' : 'warning.main', fontSize: 11 }}>
                            {criticals > 0 && `${criticals} critical`}
                            {criticals > 0 && warnings > 0 && ', '}
                            {warnings > 0 && `${warnings} warning${warnings > 1 ? 's' : ''}`}
                          </Typography>
                        </Stack>
                      )
                    }
                    return (
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ bgcolor: alpha(theme.palette.success.main, 0.1), px: 1, py: 0.25, borderRadius: 1 }}>
                        <i className="ri-shield-check-line" style={{ fontSize: 13, color: theme.palette.success.main }} />
                        <Typography variant="caption" fontWeight={600} sx={{ color: 'success.main', fontSize: 11 }}>
                          {t('resources.noAlerts')}
                        </Typography>
                      </Stack>
                    )
                  })()}
                </Stack>
                <Typography variant="body2" sx={{ color: scoreColor, fontWeight: 600, mb: 0.5 }}>{scoreLabel}</Typography>
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

            {/* Right: Resource Bars (compact) */}
            <Stack spacing={1} justifyContent="center" sx={{ width: 160 }}>
              {resourceLoading && !kpis ? (
                <>
                  <Skeleton variant="rounded" height={14} />
                  <Skeleton variant="rounded" height={14} />
                  <Skeleton variant="rounded" height={14} />
                </>
              ) : kpis ? (
                <>
                  {(() => {
                    const fmtSize = (bytes: number) => {
                      const gb = bytes / 1073741824
                      return gb >= 1024 ? `${(gb / 1024).toFixed(1)} TB` : `${Math.round(gb)} GB`
                    }
                    const ramUsedBytes = kpis.ram.used / 100 * kpis.ram.total
                    const storUsed = kpis.storage.used
                    const storTotal = kpis.storage.total
                    return [
                      { label: 'CPU', pct: cpuPct, tooltip: `${kpis.cpu.total} vCPUs — ${Math.round(kpis.cpu.allocated)} allocated, ${Math.round(cpuPct)}% used` },
                      { label: 'RAM', pct: ramPct, tooltip: `${fmtSize(kpis.ram.total)} — ${fmtSize(kpis.ram.allocated)} allocated, ${Math.round(ramPct)}% used` },
                      { label: 'Stor.', pct: storePct, tooltip: `${fmtSize(storUsed)} / ${fmtSize(storTotal)}` },
                    ]
                  })().map(({ label, pct, tooltip }) => (
                    <MuiTooltip key={label} title={tooltip} placement="left" arrow>
                      <Stack direction="row" alignItems="center" spacing={0.75} sx={{ cursor: 'default' }}>
                        <Typography variant="caption" fontWeight={600} sx={{ minWidth: 28, fontSize: 10 }}>{label}</Typography>
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(100, pct)}
                          sx={{
                            flex: 1,
                            height: 6,
                            borderRadius: 0,
                            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                            '& .MuiLinearProgress-bar': {
                              bgcolor: 'primary.main',
                              borderRadius: 0,
                            },
                          }}
                        />
                        <Typography variant="caption" fontWeight={700} sx={{ minWidth: 28, textAlign: 'right', fontSize: 10 }}>
                          {pct.toFixed(0)}%
                        </Typography>
                      </Stack>
                    </MuiTooltip>
                  ))}
                  {/* DRS score inline */}
                  {isEnterprise && drsHealthScore !== null && (() => {
                    const drsColor = drsHealthScore >= 80 ? theme.palette.success.main : drsHealthScore >= 50 ? theme.palette.warning.main : theme.palette.error.main
                    return (
                      <MuiTooltip title={`DRS: ${drsHealthScore}/100 — Mode: ${(drsStatus?.mode || 'manual')}`} placement="left" arrow>
                        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ cursor: 'default' }}>
                          <Typography variant="caption" fontWeight={600} sx={{ minWidth: 28, fontSize: 10 }}>DRS</Typography>
                          <LinearProgress
                            variant="determinate"
                            value={Math.min(100, drsHealthScore)}
                            sx={{
                              flex: 1,
                              height: 6,
                              borderRadius: 0,
                              bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                              '& .MuiLinearProgress-bar': {
                                bgcolor: drsColor,
                                borderRadius: 0,
                              },
                            }}
                          />
                          <Typography variant="caption" fontWeight={700} sx={{ minWidth: 28, textAlign: 'right', fontSize: 10 }}>
                            {drsHealthScore}
                          </Typography>
                        </Stack>
                      </MuiTooltip>
                    )
                  })()}
                </>
              ) : null}
            </Stack>
          </Box>

        </CardContent>
      </Card>

      {/* Aggregated Infrastructure Graphs */}
      {infraRrdSeries.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography fontWeight={600} fontSize={13}>{t('inventory.performances')}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              {([
                { label: '1h', value: 'hour' as const },
                { label: '24h', value: 'day' as const },
                { label: '7d', value: 'week' as const },
                { label: '30d', value: 'month' as const },
                { label: '1y', value: 'year' as const },
              ]).map(opt => (
                <Chip
                  key={opt.value}
                  label={opt.label}
                  size="small"
                  onClick={() => setInfraRrdTf(opt.value)}
                  sx={{
                    height: 24, fontSize: 11, fontWeight: 600,
                    bgcolor: infraRrdTf === opt.value ? 'primary.main' : 'action.hover',
                    color: infraRrdTf === opt.value ? 'primary.contrastText' : 'text.secondary',
                    '&:hover': { bgcolor: infraRrdTf === opt.value ? 'primary.dark' : 'action.selected' },
                    cursor: 'pointer',
                  }}
                />
              ))}
            </Box>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
            {/* CPU per node */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" fontWeight={600}>CPU</Typography>
                <IconButton size="small" onClick={() => setExpandedGraph('cpu')} sx={{ opacity: 0.4, p: 0.25, '&:hover': { opacity: 1 } }}>
                  <i className="ri-expand-diagonal-line" style={{ fontSize: 14 }} />
                </IconButton>
              </Box>
              <Box sx={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={infraRrdSeries}>
                    <defs>
                      {infraRrdNodeNames.map(name => (
                        <linearGradient key={`gcpu_${name}`} id={`infraGradCpu_${name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={infraNodeColors[name]} stopOpacity={0.15} />
                          <stop offset="100%" stopColor={infraNodeColors[name]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                    <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                    <RechartsTooltip
                      wrapperStyle={{ zIndex: 10 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                        return (
                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(33,150,243,0.1)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <i className="ri-cpu-line" style={{ fontSize: 13, color: '#2196f3' }} />
                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#2196f3' }}>CPU</Typography>
                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                            </Box>
                            <Box sx={{ px: 1.5, py: 0.75 }}>
                            {sorted.map(entry => {
                              const v = Number(entry.value)
                              const valColor = v >= 80 ? '#f44336' : v >= 60 ? '#ff9800' : '#4caf50'
                              return (
                              <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replace('cpu_', '')}</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace', color: valColor }}>{v.toFixed(1)}%</Typography>
                              </Box>
                              )
                            })}
                            </Box>
                          </Box>
                        )
                      }}
                    />
                    {infraRrdNodeNames.map(name => (
                      <Area key={name} type="monotone" dataKey={`cpu_${name}`} hide={infraRrdHiddenNodes.has(name)} name={`cpu_${name}`} stroke={infraNodeColors[name]} fill={`url(#infraGradCpu_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
              {infraRrdNodeNames.length > 1 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                  {infraRrdNodeNames.map(name => (
                    <Box
                      key={name}
                      onClick={() => toggleNodeVisibility(name)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: infraRrdHiddenNodes.has(name) ? 0.3 : 1, '&:hover': { opacity: infraRrdHiddenNodes.has(name) ? 0.5 : 0.8 } }}
                    >
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: infraNodeColors[name] }} />
                      <Typography variant="caption" sx={{ fontSize: 9, textDecoration: infraRrdHiddenNodes.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
            {/* Server Load per node */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" fontWeight={600}>Server Load</Typography>
                <IconButton size="small" onClick={() => setExpandedGraph('load')} sx={{ opacity: 0.4, p: 0.25, '&:hover': { opacity: 1 } }}>
                  <i className="ri-expand-diagonal-line" style={{ fontSize: 14 }} />
                </IconButton>
              </Box>
              <Box sx={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={infraRrdSeries}>
                    <defs>
                      {infraRrdNodeNames.map(name => (
                        <linearGradient key={`gload_${name}`} id={`infraGradLoad_${name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={infraNodeColors[name]} stopOpacity={0.25} />
                          <stop offset="100%" stopColor={infraNodeColors[name]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="t" tickFormatter={v => { const d = new Date(Number(v)); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }} minTickGap={40} tick={{ fontSize: 8 }} />
                    <YAxis tick={{ fontSize: 8 }} width={30} domain={[0, 'auto']} />
                    <RechartsTooltip
                      wrapperStyle={{ zIndex: 10 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                        return (
                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(156,39,176,0.1)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <i className="ri-dashboard-3-line" style={{ fontSize: 13, color: '#9c27b0' }} />
                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#9c27b0' }}>Server Load</Typography>
                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                            </Box>
                            <Box sx={{ px: 1.5, py: 0.75 }}>
                            {sorted.map(entry => (
                              <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replace('load_', '')}</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(2)}</Typography>
                              </Box>
                            ))}
                            </Box>
                          </Box>
                        )
                      }}
                    />
                    {infraRrdNodeNames.map(name => (
                      <Area key={`load_${name}`} type="monotone" dataKey={`load_${name}`} hide={infraRrdHiddenNodes.has(name)} name={`load_${name}`} stroke={infraNodeColors[name]} fill={`url(#infraGradLoad_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
              {infraRrdNodeNames.length > 1 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                  {infraRrdNodeNames.map(name => (
                    <Box
                      key={name}
                      onClick={() => toggleNodeVisibility(name)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: infraRrdHiddenNodes.has(name) ? 0.3 : 1, '&:hover': { opacity: infraRrdHiddenNodes.has(name) ? 0.5 : 0.8 } }}
                    >
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: infraNodeColors[name] }} />
                      <Typography variant="caption" sx={{ fontSize: 9, textDecoration: infraRrdHiddenNodes.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

            {/* RAM per node */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" fontWeight={600}>RAM</Typography>
                <IconButton size="small" onClick={() => setExpandedGraph('ram')} sx={{ opacity: 0.4, p: 0.25, '&:hover': { opacity: 1 } }}>
                  <i className="ri-expand-diagonal-line" style={{ fontSize: 14 }} />
                </IconButton>
              </Box>
              <Box sx={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={infraRrdSeries}>
                    <defs>
                      {infraRrdNodeNames.map(name => (
                        <linearGradient key={`gram_${name}`} id={`infraGradRam_${name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={infraNodeColors[name]} stopOpacity={0.15} />
                          <stop offset="100%" stopColor={infraNodeColors[name]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                    <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 9 }} width={30} />
                    <RechartsTooltip
                      wrapperStyle={{ zIndex: 10 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                        return (
                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(76,175,80,0.1)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <i className="ri-ram-line" style={{ fontSize: 13, color: '#4caf50' }} />
                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#4caf50' }}>RAM</Typography>
                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                            </Box>
                            <Box sx={{ px: 1.5, py: 0.75 }}>
                            {sorted.map(entry => {
                              const v = Number(entry.value)
                              const valColor = v >= 80 ? '#f44336' : v >= 60 ? '#ff9800' : '#4caf50'
                              return (
                              <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replace('ram_', '')}</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace', color: valColor }}>{v.toFixed(1)}%</Typography>
                              </Box>
                              )
                            })}
                            </Box>
                          </Box>
                        )
                      }}
                    />
                    {infraRrdNodeNames.map(name => (
                      <Area key={name} type="monotone" dataKey={`ram_${name}`} hide={infraRrdHiddenNodes.has(name)} name={`ram_${name}`} stroke={infraNodeColors[name]} fill={`url(#infraGradRam_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
              {infraRrdNodeNames.length > 1 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                  {infraRrdNodeNames.map(name => (
                    <Box
                      key={name}
                      onClick={() => toggleNodeVisibility(name)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: infraRrdHiddenNodes.has(name) ? 0.3 : 1, '&:hover': { opacity: infraRrdHiddenNodes.has(name) ? 0.5 : 0.8 } }}
                    >
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: infraNodeColors[name] }} />
                      <Typography variant="caption" sx={{ fontSize: 9, textDecoration: infraRrdHiddenNodes.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
            {/* Network per node (In + Out stacked) */}
            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" fontWeight={600}>Network</Typography>
                <IconButton size="small" onClick={() => setExpandedGraph('net')} sx={{ opacity: 0.4, p: 0.25, '&:hover': { opacity: 1 } }}>
                  <i className="ri-expand-diagonal-line" style={{ fontSize: 14 }} />
                </IconButton>
              </Box>
              <Box sx={{ height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={infraRrdSeries}>
                    <defs>
                      {infraRrdNodeNames.map(name => (
                        <React.Fragment key={`gnet_${name}`}>
                          <linearGradient id={`infraGradNetIn_${name}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={infraNodeColors[name]} stopOpacity={0.15} />
                            <stop offset="100%" stopColor={infraNodeColors[name]} stopOpacity={0} />
                          </linearGradient>
                        </React.Fragment>
                      ))}
                    </defs>
                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 9 }} />
                    <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 9 }} width={45} />
                    <RechartsTooltip
                      wrapperStyle={{ zIndex: 10 }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                        return (
                          <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                            <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(255,152,0,0.1)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <i className="ri-wifi-line" style={{ fontSize: 13, color: '#ff9800' }} />
                              <Typography variant="caption" sx={{ fontWeight: 700, color: '#ff9800' }}>Network</Typography>
                              <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                            </Box>
                            <Box sx={{ px: 1.5, py: 0.75 }}>
                            {sorted.map(entry => {
                              const isOut = String(entry.name).startsWith('netOut_')
                              const nodeName = String(entry.name).replace(/^net(In|Out)_/, '')
                              return (
                                <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                  <Typography variant="caption" sx={{ flex: 1 }}>{nodeName} {isOut ? '↑ Out' : '↓ In'}</Typography>
                                  <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(Number(entry.value))}</Typography>
                                </Box>
                              )
                            })}
                            </Box>
                          </Box>
                        )
                      }}
                    />
                    {infraRrdNodeNames.map(name => (
                      <Area key={`in_${name}`} type="monotone" dataKey={`netIn_${name}`} hide={infraRrdHiddenNodes.has(name)} name={`netIn_${name}`} stroke={infraNodeColors[name]} fill={`url(#infraGradNetIn_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                    ))}
                    {infraRrdNodeNames.map(name => (
                      <Area key={`out_${name}`} type="monotone" dataKey={`netOut_${name}`} hide={infraRrdHiddenNodes.has(name)} name={`netOut_${name}`} stroke={infraNodeColors[name]} fill="none" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </Box>
              {infraRrdNodeNames.length > 1 && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                  {infraRrdNodeNames.map(name => (
                    <Box
                      key={name}
                      onClick={() => toggleNodeVisibility(name)}
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: infraRrdHiddenNodes.has(name) ? 0.3 : 1, '&:hover': { opacity: infraRrdHiddenNodes.has(name) ? 0.5 : 0.8 } }}
                    >
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: infraNodeColors[name] }} />
                      <Typography variant="caption" sx={{ fontSize: 9, textDecoration: infraRrdHiddenNodes.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>

          </Box>
        </Box>
      )}
      {/* Graph overlay */}
      {expandedGraph && (
        <Box
          onClick={() => setExpandedGraph(null)}
          sx={{
            position: 'fixed', inset: 0, zIndex: 1300,
            bgcolor: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            p: 4,
          }}
        >
          <Box
            onClick={(e) => e.stopPropagation()}
            sx={{
              bgcolor: 'background.paper',
              borderRadius: 2,
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              width: '90%',
              maxWidth: 1200,
              p: 3,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography fontWeight={600}>
                {expandedGraph === 'cpu' ? 'CPU' : expandedGraph === 'load' ? 'Server Load' : expandedGraph === 'ram' ? 'RAM' : 'Network'}
              </Typography>
              <IconButton size="small" onClick={() => setExpandedGraph(null)}>
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </IconButton>
            </Box>
            <Box sx={{ height: 500 }}>
              <ResponsiveContainer width="100%" height="100%">
                {expandedGraph === 'cpu' ? (
                  <AreaChart data={infraRrdSeries}>
                    <defs>
                      {infraRrdNodeNames.map(name => (
                        <linearGradient key={`gcpu_ex_${name}`} id={`exGradCpu_${name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={infraNodeColors[name]} stopOpacity={0.15} />
                          <stop offset="100%" stopColor={infraNodeColors[name]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} width={35} />
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <RechartsTooltip wrapperStyle={{ zIndex: 1400 }} content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const sorted = [...payload].filter(e => !infraRrdHiddenNodes.has(String(e.name).replace('cpu_', ''))).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                      return (
                        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                          <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(33,150,243,0.1)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <i className="ri-cpu-line" style={{ fontSize: 13, color: '#2196f3' }} />
                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#2196f3' }}>CPU</Typography>
                            <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                          </Box>
                          <Box sx={{ px: 1.5, py: 0.75 }}>
                            {sorted.map(entry => { const v = Number(entry.value); const valColor = v >= 80 ? '#f44336' : v >= 60 ? '#ff9800' : '#4caf50'; return (
                              <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replace('cpu_', '')}</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace', color: valColor }}>{v.toFixed(1)}%</Typography>
                              </Box>
                            )})}
                          </Box>
                        </Box>
                      )
                    }} />
                    {infraRrdNodeNames.map(name => (
                      <Area key={name} type="monotone" dataKey={`cpu_${name}`} name={`cpu_${name}`} stroke={infraNodeColors[name]} fill={`url(#exGradCpu_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls hide={infraRrdHiddenNodes.has(name)} />
                    ))}
                  </AreaChart>
                ) : expandedGraph === 'load' ? (
                  <AreaChart data={infraRrdSeries}>
                    <defs>
                      {infraRrdNodeNames.map(name => (
                        <linearGradient key={`gload_ex_${name}`} id={`exGradLoad_${name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={infraNodeColors[name]} stopOpacity={0.15} />
                          <stop offset="100%" stopColor={infraNodeColors[name]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} width={35} domain={[0, 'auto']} />
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <RechartsTooltip wrapperStyle={{ zIndex: 1400 }} content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const sorted = [...payload].filter(e => !infraRrdHiddenNodes.has(String(e.name).replace('load_', ''))).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                      return (
                        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                          <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(156,39,176,0.1)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <i className="ri-dashboard-3-line" style={{ fontSize: 13, color: '#9c27b0' }} />
                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#9c27b0' }}>Server Load</Typography>
                            <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                          </Box>
                          <Box sx={{ px: 1.5, py: 0.75 }}>
                            {sorted.map(entry => (
                              <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replace('load_', '')}</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{Number(entry.value).toFixed(2)}</Typography>
                              </Box>
                            ))}
                          </Box>
                        </Box>
                      )
                    }} />
                    {infraRrdNodeNames.map(name => (
                      <Area key={`load_${name}`} type="monotone" dataKey={`load_${name}`} name={`load_${name}`} stroke={infraNodeColors[name]} fill={`url(#exGradLoad_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls hide={infraRrdHiddenNodes.has(name)} />
                    ))}
                  </AreaChart>
                ) : expandedGraph === 'ram' ? (
                  <AreaChart data={infraRrdSeries}>
                    <defs>
                      {infraRrdNodeNames.map(name => (
                        <linearGradient key={`gram_ex_${name}`} id={`exGradRam_${name}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={infraNodeColors[name]} stopOpacity={0.15} />
                          <stop offset="100%" stopColor={infraNodeColors[name]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} width={35} />
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <RechartsTooltip wrapperStyle={{ zIndex: 1400 }} content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const sorted = [...payload].filter(e => !infraRrdHiddenNodes.has(String(e.name).replace('ram_', ''))).sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                      return (
                        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                          <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(76,175,80,0.1)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <i className="ri-ram-line" style={{ fontSize: 13, color: '#4caf50' }} />
                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#4caf50' }}>RAM</Typography>
                            <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                          </Box>
                          <Box sx={{ px: 1.5, py: 0.75 }}>
                            {sorted.map(entry => { const v = Number(entry.value); const valColor = v >= 80 ? '#f44336' : v >= 60 ? '#ff9800' : '#4caf50'; return (
                              <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                <Typography variant="caption" sx={{ flex: 1 }}>{String(entry.name).replace('ram_', '')}</Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace', color: valColor }}>{v.toFixed(1)}%</Typography>
                              </Box>
                            )})}
                          </Box>
                        </Box>
                      )
                    }} />
                    {infraRrdNodeNames.map(name => (
                      <Area key={name} type="monotone" dataKey={`ram_${name}`} name={`ram_${name}`} stroke={infraNodeColors[name]} fill={`url(#exGradRam_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls hide={infraRrdHiddenNodes.has(name)} />
                    ))}
                  </AreaChart>
                ) : (
                  <AreaChart data={infraRrdSeries}>
                    <defs>
                      {infraRrdNodeNames.map(name => (
                        <React.Fragment key={`gnet_ex_${name}`}>
                          <linearGradient id={`exGradNetIn_${name}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={infraNodeColors[name]} stopOpacity={0.15} />
                            <stop offset="100%" stopColor={infraNodeColors[name]} stopOpacity={0} />
                          </linearGradient>
                        </React.Fragment>
                      ))}
                    </defs>
                    <XAxis dataKey="t" tickFormatter={v => formatTime(Number(v))} minTickGap={40} tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={v => formatBps(Number(v))} tick={{ fontSize: 10 }} width={50} />
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                    <RechartsTooltip wrapperStyle={{ zIndex: 1400 }} content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const sorted = [...payload].sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0))
                      return (
                        <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', boxShadow: '0 4px 14px rgba(0,0,0,0.15)', fontSize: 11, minWidth: 220 }}>
                          <Box sx={{ px: 1.5, py: 0.75, bgcolor: 'rgba(255,152,0,0.1)', borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 0.75 }}>
                            <i className="ri-wifi-line" style={{ fontSize: 13, color: '#ff9800' }} />
                            <Typography variant="caption" sx={{ fontWeight: 700, color: '#ff9800' }}>Network</Typography>
                            <Typography variant="caption" sx={{ ml: 'auto', opacity: 0.6 }}>{new Date(Number(label)).toLocaleTimeString()}</Typography>
                          </Box>
                          <Box sx={{ px: 1.5, py: 0.75 }}>
                            {sorted.map(entry => {
                              const isOut = String(entry.name).startsWith('netOut_')
                              const nodeName = String(entry.name).replace(/^net(In|Out)_/, '')
                              return (
                                <Box key={entry.dataKey} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.25 }}>
                                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: entry.color, flexShrink: 0 }} />
                                  <Typography variant="caption" sx={{ flex: 1 }}>{nodeName} {isOut ? '↑ Out' : '↓ In'}</Typography>
                                  <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{formatBps(Number(entry.value))}</Typography>
                                </Box>
                              )
                            })}
                          </Box>
                        </Box>
                      )
                    }} />
                    {infraRrdNodeNames.map(name => (
                      <Area key={`in_${name}`} type="monotone" dataKey={`netIn_${name}`} name={`netIn_${name}`} stroke={infraNodeColors[name]} fill={`url(#exGradNetIn_${name})`} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls hide={infraRrdHiddenNodes.has(name)} />
                    ))}
                    {infraRrdNodeNames.map(name => (
                      <Area key={`out_${name}`} type="monotone" dataKey={`netOut_${name}`} name={`netOut_${name}`} stroke={infraNodeColors[name]} fill="none" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls hide={infraRrdHiddenNodes.has(name)} />
                    ))}
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </Box>
            {/* Legend */}
            {infraRrdNodeNames.length > 1 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2, justifyContent: 'center' }}>
                {infraRrdNodeNames.map(name => (
                  <Box
                    key={name}
                    onClick={() => toggleNodeVisibility(name)}
                    sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', opacity: infraRrdHiddenNodes.has(name) ? 0.3 : 1, '&:hover': { opacity: infraRrdHiddenNodes.has(name) ? 0.5 : 0.8 } }}
                  >
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: infraNodeColors[name] }} />
                    <Typography variant="caption" sx={{ fontSize: 11, textDecoration: infraRrdHiddenNodes.has(name) ? 'line-through' : 'none' }}>{name}</Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>
      )}

      {infraRrdLoading && infraRrdSeries.length === 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, opacity: 0.6 }}>
          <CircularProgress size={16} />
          <Typography variant="caption">{t('inventory.performances')}...</Typography>
        </Box>
      )}

      {/* Séparateur PVE */}
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, mt: 3, mb: 1, mx: -2.5,
        background: theme.palette.mode === 'dark' ? 'linear-gradient(90deg, #2b2b39 0%, #32324a 100%)' : 'linear-gradient(90deg, #ededf2 0%, #e5e5ee 100%)',
        borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
      }}>
        <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 18, height: 18 }} />
        <Typography variant="body2" fontWeight={600}>PROXMOX VE</Typography>
        <Box sx={{ flex: 1 }} />
        {clusters.length > 0 && (
          <MuiTooltip title={isAllExpanded ? t('inventory.collapseAll') : t('inventory.expandAll')}>
            <IconButton size="small" onClick={isAllExpanded ? collapseAll : expandAll} sx={{ opacity: 0.5 }}>
              <i className={isAllExpanded ? 'ri-contract-up-down-line' : 'ri-expand-up-down-line'} style={{ fontSize: 16 }} />
            </IconButton>
          </MuiTooltip>
        )}
      </Box>

      {/* Liste des Clusters avec leurs Hosts et VMs */}
      <Stack spacing={2}>
        {clusters.map(cluster => {
          const isClusterCollapsed = !expandedClusters.has(cluster.connId)
          const clusterHosts = hosts.filter(h => h.connId === cluster.connId)
          const runningCount = cluster.vms.filter(vm => vm.status === 'running').length
          const isRealCluster = clusterHosts.length > 1 // Vrai cluster si plusieurs nodes
          // Aggregate node-level CPU/RAM for the cluster
          const clusterCpu = (() => {
            const onlineHosts = clusterHosts.filter(h => h.cpu !== undefined)
            if (onlineHosts.length === 0) return 0
            return onlineHosts.reduce((sum, h) => sum + (h.cpu || 0), 0) / onlineHosts.length * 100
          })()
          const clusterRam = (() => {
            const totalMem = clusterHosts.reduce((sum, h) => sum + (h.maxmem || 0), 0)
            const usedMem = clusterHosts.reduce((sum, h) => sum + (h.mem || 0), 0)
            return totalMem > 0 ? (usedMem / totalMem) * 100 : 0
          })()
          
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
                  bgcolor: theme.palette.mode === 'dark' ? '#262635' : '#f4f4f8',
                  borderBottom: isClusterCollapsed ? 'none' : '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: theme.palette.mode === 'dark' ? '#2c2c3e' : '#ebebf0' }
                }}
              >
                <i 
                  className={isClusterCollapsed ? "ri-add-line" : "ri-subtract-line"} 
                  style={{ fontSize: 20, opacity: 0.7 }} 
                />
                {(() => {
                  const allOnline = clusterHosts.length > 0 && clusterHosts.every(h => h.status === 'online')
                  const dotColor = allOnline ? 'success.main' : 'warning.main'
                  return (
                    <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      {isRealCluster
                        ? <i className="ri-server-fill" style={{ fontSize: 18 }} />
                        : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 18, height: 18 }} />
                      }
                      <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: dotColor, border: '1.5px solid', borderColor: 'background.paper' }} />
                    </Box>
                  )
                })()}
                <Typography fontWeight={600}>{cluster.connName}</Typography>
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
                  <MiniProgressBar value={clusterCpu} label="CPU" />
                  <MiniProgressBar value={clusterRam} label="RAM" />
                </Box>
              </Box>
              
              {/* Contenu Cluster (Hosts) */}
              {!isClusterCollapsed && (
                <Box sx={{ pl: 2 }}>
                  {clusterHosts.map(host => {
                    const isHostCollapsed = !expandedHosts.has(host.key)
                    const hostRunning = host.vms.filter(vm => vm.status === 'running').length
                    const hostCpuPct = host.cpu !== undefined ? host.cpu * 100 : 0
                    const hostRamPct = host.maxmem && host.maxmem > 0 ? (host.mem || 0) / host.maxmem * 100 : 0
                    
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
                            className={isHostCollapsed ? "ri-add-line" : "ri-subtract-line"} 
                            style={{ fontSize: 18, opacity: 0.7 }} 
                          />
                          <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                            <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 16, height: 16, opacity: 0.7 }} />
                            <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: host.status === 'online' ? 'success.main' : 'error.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                          </Box>
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
                            <MiniProgressBar value={hostCpuPct} label="CPU" />
                            <MiniProgressBar value={hostRamPct} label="RAM" />
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
                              showTrends
                              showActions
                              onLoadTrendsBatch={onLoadTrendsBatch}
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
      </Stack>

        {/* ── STORAGE Section ── */}
        {clusterStorages.length > 0 && (
          <>
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, mt: 3, mb: 1, mx: -2.5,
              background: theme.palette.mode === 'dark' ? 'linear-gradient(90deg, #2b2b39 0%, #32324a 100%)' : 'linear-gradient(90deg, #ededf2 0%, #e5e5ee 100%)',
              borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
            }}>
              <i className="ri-database-2-fill" style={{ fontSize: 16, opacity: 0.7 }} />
              <Typography variant="body2" fontWeight={600}>STORAGE</Typography>
              <Chip size="small" label={clusterStorages.reduce((acc, cs) => acc + cs.sharedStorages.length + cs.nodes.reduce((a, n) => a + n.storages.length, 0), 0)} sx={{ height: 18, fontSize: 10 }} />
            </Box>
            <Stack spacing={2}>
              {clusterStorages.map(cs => {
                const allStorages = cs.sharedStorages.concat(cs.nodes.flatMap(n => n.storages))
                const totalUsed = allStorages.reduce((a, s) => a + s.used, 0)
                const totalSize = allStorages.reduce((a, s) => a + s.total, 0)
                const usedPct = totalSize > 0 ? Math.round((totalUsed / totalSize) * 100) : 0
                const formatSize = (bytes: number) => {
                  if (bytes >= 1099511627776) return `${(bytes / 1099511627776).toFixed(1)}T`
                  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(0)}G`
                  return `${(bytes / 1048576).toFixed(0)}M`
                }
                return (
                  <Card key={cs.connId} variant="outlined">
                    <Box sx={{
                      px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5,
                      bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                    }}>
                      <Box sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 16, height: 16, flexShrink: 0 }}>
                        {cs.isCluster
                          ? <i className="ri-server-fill" style={{ fontSize: 16, opacity: 0.8 }} />
                          : <img src={theme.palette.mode === 'dark' ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt="" style={{ width: 16, height: 16 }} />
                        }
                        <Box sx={{ position: 'absolute', bottom: -2, right: -2, width: 8, height: 8, borderRadius: '50%', bgcolor: cs.nodes.every(n => n.status === 'online') ? 'success.main' : 'warning.main', border: '1.5px solid', borderColor: 'background.paper' }} />
                      </Box>
                      <Typography fontWeight={600} sx={{ fontSize: 13 }}>{cs.connName}</Typography>
                      <Chip size="small" label={`${allStorages.length} storages`} sx={{ height: 18, fontSize: 10 }} />
                      {totalSize > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 'auto' }}>
                          <Box sx={{ width: 60, height: 6, bgcolor: 'action.hover', borderRadius: 1, overflow: 'hidden' }}>
                            <Box sx={{ width: `${usedPct}%`, height: '100%', bgcolor: usedPct > 90 ? 'error.main' : usedPct > 70 ? 'warning.main' : 'success.main' }} />
                          </Box>
                          <Typography variant="caption" sx={{ opacity: 0.6, fontSize: 11 }}>
                            {formatSize(totalUsed)} / {formatSize(totalSize)} ({usedPct}%)
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  </Card>
                )
              })}
            </Stack>
          </>
        )}

        {/* ── NETWORK Section (header only — data is lazy-loaded in tree) ── */}
        <Box
          onClick={() => onSelect?.({ type: 'root', id: 'root' })}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, mt: 3, mb: 1, mx: -2.5,
            background: theme.palette.mode === 'dark' ? 'linear-gradient(90deg, #2b2b39 0%, #32324a 100%)' : 'linear-gradient(90deg, #ededf2 0%, #e5e5ee 100%)',
            borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
            cursor: 'pointer', '&:hover': { bgcolor: theme.palette.mode === 'dark' ? '#32323f' : '#e5e5ea' },
          }}
        >
          <i className="ri-router-fill" style={{ fontSize: 16, opacity: 0.7 }} />
          <Typography variant="body2" fontWeight={600}>NETWORK</Typography>
          <Typography variant="caption" sx={{ opacity: 0.4, ml: 0.5 }}>
            {t('inventory.expandInTree')}
          </Typography>
        </Box>

        {/* ── BACKUP Section ── */}
        {pbsServers && pbsServers.length > 0 && (
          <>
            <Box sx={{
              display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, mt: 3, mb: 1, mx: -2.5,
              background: theme.palette.mode === 'dark' ? 'linear-gradient(90deg, #2b2b39 0%, #32324a 100%)' : 'linear-gradient(90deg, #ededf2 0%, #e5e5ee 100%)',
              borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
            }}>
              <i className="ri-hard-drive-2-fill" style={{ fontSize: 16, opacity: 0.7 }} />
              <Typography variant="body2" fontWeight={600}>BACKUP</Typography>
              <Chip size="small" label={t('inventory.nBackups', { count: pbsServers.reduce((acc, pbs) => acc + pbs.backupCount, 0) })} sx={{ height: 18, fontSize: 10 }} />
            </Box>

            <Stack spacing={2}>
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
                      bgcolor: theme.palette.mode === 'dark' ? '#262635' : '#f4f4f8',
                    }}
                  >
                    <i className="ri-hard-drive-2-fill" style={{ fontSize: 18, color: '#2196f3' }} />
                    <Typography fontWeight={600}>{pbs.name}</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>
                      {t('inventory.nBackups', { count: pbs.backupCount })}
                    </Typography>
                  </Box>
                </Card>
              ))}
            </Stack>
          </>
        )}

        {/* ── MIGRATIONS Section ── */}
        {externalHypervisors.length > 0 && (() => {
          const hypervisorConfig: Record<string, { label: string; icon: string; svgIcon?: string; color: string }> = {
            vmware: { label: 'VMware ESXi', icon: 'ri-cloud-line', svgIcon: '/images/esxi-logo.svg', color: '#638C1C' },
            hyperv: { label: 'Microsoft Hyper-V', icon: 'ri-microsoft-line', svgIcon: '/images/hyperv-logo.svg', color: '#00BCF2' },
            xcpng: { label: 'XCP-NG', icon: 'ri-server-line', svgIcon: '/images/xcpng-logo.svg', color: '#00ADB5' },
          }
          const grouped = externalHypervisors.reduce<Record<string, typeof externalHypervisors>>((acc, h) => {
            if (!acc[h.type]) acc[h.type] = []
            acc[h.type].push(h)
            return acc
          }, {})
          const totalExtVms = externalHypervisors.reduce((acc, h) => acc + (h.vms?.length || 0), 0)

          return (
            <>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, mt: 3, mb: 1, mx: -2.5,
                background: theme.palette.mode === 'dark' ? 'linear-gradient(90deg, #2b2b39 0%, #32324a 100%)' : 'linear-gradient(90deg, #ededf2 0%, #e5e5ee 100%)',
                borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider',
              }}>
                <img src="/images/esxi-logo.svg" alt="" width={16} height={16} style={{ opacity: 0.7 }} />
                <Typography variant="body2" fontWeight={600}>MIGRATIONS</Typography>
                <Chip size="small" label={`${externalHypervisors.length} hosts${totalExtVms > 0 ? `, ${totalExtVms} VMs` : ''}`} sx={{ height: 18, fontSize: 10 }} />
              </Box>
              <Stack spacing={2}>
                {Object.entries(grouped).map(([type, conns]) => {
                  const cfg = hypervisorConfig[type] || { label: type, icon: 'ri-server-line', color: '#999' }
                  const typeVms = conns.reduce((acc, c) => acc + (c.vms?.length || 0), 0)
                  return (
                    <Card key={type} variant="outlined">
                      <Box sx={{
                        px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1.5,
                        bgcolor: theme.palette.mode === 'dark' ? '#262635' : '#f4f4f8',
                      }}>
                        {cfg.svgIcon
                          ? <img src={cfg.svgIcon} alt="" width={18} height={18} style={{ opacity: 0.8 }} />
                          : <i className={cfg.icon} style={{ fontSize: 18, color: cfg.color }} />
                        }
                        <Typography fontWeight={600}>{cfg.label}</Typography>
                        <Chip size="small" label={`${conns.length} hosts`} sx={{ height: 18, fontSize: 10 }} />
                        {typeVms > 0 && (
                          <Typography variant="caption" sx={{ opacity: 0.6, ml: 'auto' }}>
                            {typeVms} VMs
                          </Typography>
                        )}
                      </Box>
                    </Card>
                  )
                })}
              </Stack>
            </>
          )
        })()}

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
