'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { formatBytes } from '@/utils/format'
import { getDateLocale } from '@/lib/i18n/date'

import { useDRSStatus, useDRSRecommendations as useDRSRecsHook, useDRSMigrations, useDRSMetrics, useDRSSettings, useDRSRules, useMigrationProgress } from '@/hooks/useDRS'
import useSWR from 'swr'
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, CartesianGrid, ResponsiveContainer } from 'recharts'

import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features, useLicense } from '@/contexts/LicenseContext'


import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Skeleton,
  Stack,
  Switch,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  alpha,
  useTheme
} from '@mui/material'

// RemixIcon replacements for @mui/icons-material
const RefreshIcon = (props: any) => <i className="ri-refresh-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CheckIcon = (props: any) => <i className="ri-check-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CloseIcon = (props: any) => <i className="ri-close-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const SpeedIcon = (props: any) => <i className="ri-speed-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ExpandMoreIcon = (props: any) => <i className="ri-arrow-down-s-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ExpandLessIcon = (props: any) => <i className="ri-arrow-up-s-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StorageIcon = (props: any) => <i className="ri-hard-drive-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MemoryIcon = (props: any) => <i className="ri-cpu-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const DnsIcon = (props: any) => <i className="ri-server-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TrendingUpIcon = (props: any) => <i className="ri-arrow-up-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TrendingDownIcon = (props: any) => <i className="ri-arrow-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const SwapHorizIcon = (props: any) => <i className="ri-arrow-left-right-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const WarningAmberIcon = (props: any) => <i className="ri-alert-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CheckCircleIcon = (props: any) => <i className="ri-checkbox-circle-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const BuildIcon = (props: any) => <i className="ri-hammer-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const LocalOfferIcon = (props: any) => <i className="ri-price-tag-3-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const SettingsIcon = (props: any) => <i className="ri-settings-3-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const AccessTimeIcon = (props: any) => <i className="ri-time-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const HardwareIcon = (props: any) => <i className="ri-cpu-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

import { computeDrsHealthScore, type DrsHealthBreakdown } from '@/lib/utils/drs-health'

import { usePageTitle } from '@/contexts/PageTitleContext'
import EmptyState from '@/components/EmptyState'
import DRSBalancingIllustration from '@/components/illustrations/DRSBalancingIllustration'
import { CardsSkeleton } from '@/components/skeletons'

// Import des nouveaux composants DRS
import DRSSettingsPanel, { 
  defaultDRSSettings, 
  type DRSSettings, 
  type ClusterVersionInfo 
} from '@/components/automation/drs/DRSSettingsPanel'
import AffinityRulesManager, {
  type AffinityRule, 
  type VMInfo as AffinityVMInfo 
} from '@/components/automation/drs/AffinityRulesManager'

// ============================================
// Types
// ============================================

// Type pour les VMs retournées par /api/v1/vms
interface VMFromAPI {
  id: string
  connId: string
  connectionName: string
  type: 'qemu' | 'lxc'
  node: string
  host: string
  vmid: string
  name: string
  status: string
  tags: string[]
}

// Type pour les connexions
interface Connection {
  id: string
  name: string
  type: 'pve' | 'pbs'
  baseUrl: string
  hasCeph: boolean
}

interface DRSStatus {
  enabled: boolean
  mode: 'manual' | 'partial' | 'automatic'
  recommendations: number
  active_migrations: number
  pending_count: number
  approved_count: number
}

interface DRSRecommendation {
  id: string
  connection_id: string
  vmid: number
  vm_name: string
  guest_type?: 'qemu' | 'lxc'
  source_node: string
  target_node: string
  reason: string
  priority: number | 'low' | 'medium' | 'high' | 'critical'
  score: number
  created_at: string
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'stale'
  maintenance_evacuation?: boolean
}

interface DRSMigration {
  id: string
  recommendation_id?: string
  connection_id: string
  vmid: number
  vm_name: string
  guest_type?: 'qemu' | 'lxc'
  source_node: string
  target_node: string
  task_id: string
  started_at: string
  completed_at?: string
  status: 'running' | 'completed' | 'failed'
  error?: string
}

// Type pour la progression d'une migration
interface MigrationProgress {
  migration_id: string
  vmid: number
  vm_name: string
  guest_type?: string
  source_node: string
  target_node: string
  status: string
  progress: number
  message: string
  started_at: string
}

interface ClusterMetrics {
  connection_id: string
  connection_name?: string
  collected_at: string
  nodes: NodeMetrics[]
  summary: ClusterSummary
  pve_version?: number
}

interface NodeMetrics {
  node: string
  status: string
  cpu_usage: number
  memory_usage: number
  vm_count: number
  ct_count?: number
  running_vms: number
  in_maintenance?: boolean
}

interface ClusterSummary {
  total_nodes: number
  online_nodes: number
  total_vms: number
  running_vms: number
  avg_cpu_usage: number
  avg_memory_usage: number
  imbalance: number
}

// Type pour le résultat de check-migration
interface LocalDiskInfo {
  device: string
  storage: string
  volume: string
  size: number
  size_str: string
  is_shared: boolean
  storage_type: string
}

// Type pour les infos du stockage cible
interface TargetStorageInfo {
  storage: string           // nom du stockage (ex: "local")
  node: string              // nœud cible
  total_size: number        // taille totale en bytes
  used_size: number         // espace utilisé en bytes
  avail_size: number        // espace disponible en bytes
  usage_percent: number     // % utilisé actuel
  
  // Après migration
  used_after: number        // espace utilisé après migration
  avail_after: number       // espace dispo après migration
  usage_after_pct: number   // % utilisé après migration
  
  // Alertes
  will_exceed: boolean      // true si espace insuffisant
  warning_level: 'ok' | 'warning' | 'critical' | 'full'  // niveau d'alerte
}

interface MigrationCheckResult {
  can_migrate: boolean
  migration_safe: boolean
  warning?: string
  local_disks: LocalDiskInfo[]
  shared_disks: LocalDiskInfo[]
  total_local_size: number
  total_shared_size: number
  estimated_time?: string
  target_storage?: TargetStorageInfo  // Nouveau: infos stockage cible
}

// ============================================
// Fetcher & API calls
// ============================================

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  
return res.json()
})

async function apiAction(url: string, method = 'POST', body?: any) {
  const res = await fetch(url, { 
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))

    throw new Error(data.error || 'Action failed')
  }

  
return res.json()
}

// ============================================
// Helpers
// ============================================

const pct = (v: number) => Math.max(0, Math.min(100, Number(v ?? 0)))

const formatDate = (iso: string, locale?: string) => {
  if (!iso) return '—'

return new Date(iso).toLocaleString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const getPriorityLabel = (priority: number | string): string => {
  const labels: Record<number, string> = { 0: 'low', 1: 'medium', 2: 'high', 3: 'critical' }

  
return typeof priority === 'number' ? labels[priority] || 'low' : priority
}

const getPriorityColor = (priority: number | string): 'error' | 'warning' | 'info' | 'default' => {
  const p = getPriorityLabel(priority)

  const colors: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
    critical: 'error',
    high: 'warning',
    medium: 'info',
    low: 'default'
  }

  
return colors[p] || 'default'
}


// Helper pour s'assurer qu'on a un tableau (évite les erreurs .filter is not a function)
const ensureArray = <T,>(data: T[] | undefined | null | { error?: string }): T[] => {
  if (Array.isArray(data)) return data
  
return []
}

// ============================================
// Sub Components
// ============================================

// Gauge component pour visualiser CPU/RAM
const ResourceGauge = ({ 
  value, 
  label, 
  size = 60,
  thresholds = { warning: 70, critical: 85 }
}: { 
  value: number
  label: string
  size?: number
  thresholds?: { warning: number, critical: number }
}) => {
  const theme = useTheme()

  const color = value >= thresholds.critical 
    ? theme.palette.error.main 
    : value >= thresholds.warning 
      ? theme.palette.warning.main 
      : theme.palette.success.main

  return (
    <Box sx={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
      <Box sx={{ position: 'relative', display: 'inline-flex' }}>
        <CircularProgress
          variant="determinate"
          value={100}
          size={size}
          thickness={4}
          sx={{ color: alpha(color, 0.15) }}
        />
        <CircularProgress
          variant="determinate"
          value={pct(value)}
          size={size}
          thickness={4}
          sx={{ 
            color,
            position: 'absolute',
            left: 0,
          }}
        />
        <Box
          sx={{
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
            position: 'absolute',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, fontSize: size * 0.2 }}>
            {value.toFixed(0)}%
          </Typography>
        </Box>
      </Box>
      <Typography variant="caption" sx={{ mt: 0.5, opacity: 0.7, fontSize: '0.65rem' }}>
        {label}
      </Typography>
    </Box>
  )
}

// Cluster Card - Affiche un cluster avec ses nœuds
const ClusterCard = ({ 
  clusterId,
  clusterName,
  metrics,
  recommendations,
  expanded,
  onToggle
}: { 
  clusterId: string
  clusterName: string
  metrics: ClusterMetrics
  recommendations: DRSRecommendation[]
  expanded: boolean
  onToggle: () => void
}) => {
  const theme = useTheme()
  const clusterRecs = recommendations.filter(r => r.connection_id === clusterId)
  
  // Calculer le spread (écart max-min) de mémoire
  const memorySpread = useMemo(() => {
    if (!metrics?.nodes || metrics.nodes.length < 2) return 0
    const memValues = metrics.nodes.map(n => n.memory_usage)
    const max = Math.max(...memValues)
    const min = Math.min(...memValues)

    
return max - min
  }, [metrics.nodes])

  // Calculer le score de santé du cluster avec breakdown
  const healthBreakdown = useMemo(() => computeDrsHealthScore(metrics?.summary), [metrics])
  const healthScore = healthBreakdown.score

  const t = useTranslations()
  const healthColor = healthScore >= 80 ? 'success' : healthScore >= 50 ? 'warning' : 'error'
  const healthLabel = healthScore >= 80 ? t('drsPage.balanced') : healthScore >= 50 ? t('drsPage.toOptimize') : t('drsPage.unbalanced')
  
  // Couleur du spread selon le seuil (10% = warning)
  const spreadColor = memorySpread > 10 ? 'error' : memorySpread > 6 ? 'warning' : 'success'

  // Trier les nœuds par mémoire décroissante
  const sortedNodes = useMemo(() => 
    [...(metrics.nodes || [])].sort((a, b) => b.memory_usage - a.memory_usage),
    [metrics.nodes]
  )

  // Identifier sources et cibles potentielles
  const avgMem = metrics?.summary?.avg_memory_usage ?? 0

  const getNodeRole = (node: NodeMetrics) => {
    if (node.in_maintenance) return 'maintenance'
    const diff = node.memory_usage - avgMem

    if (diff > 5) return 'source'
    if (diff < -5) return 'target'
    
return 'neutral'
  }

  return (
    <Card 
      variant="outlined" 
      sx={{ 
        borderRadius: 2,
        overflow: 'hidden',
        borderColor: clusterRecs.length > 0 ? alpha(theme.palette.warning.main, 0.5) : 'divider'
      }}
    >
      {/* Header cliquable */}
      <Box
        onClick={onToggle}
        sx={{
          p: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          bgcolor: alpha(theme.palette.primary.main, 0.03),
          '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.06) },
          borderBottom: expanded ? '1px solid' : 'none',
          borderColor: 'divider'
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <DnsIcon sx={{ opacity: 0.7 }} />
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {clusterName || clusterId.slice(0, 12)}
              </Typography>
              {metrics.pve_version && (
                <Chip 
                  label={`PVE ${metrics.pve_version}`} 
                  size="small" 
                  variant="outlined"
                  sx={{ height: 20, fontSize: '0.65rem' }}
                />
              )}
            </Box>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {metrics?.summary?.online_nodes ?? 0} {t('drsPage.nodesLabel')} • {metrics?.summary?.running_vms ?? 0} VMs
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {/* Recommendations count */}
          {clusterRecs.length > 0 && (
            <Chip
              size="small"
              label={`${clusterRecs.length} rec.`}
              color="warning"
            />
          )}

          {/* Health badge */}
          <Tooltip title={
            <Box sx={{ fontSize: '0.75rem' }}>
              <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>{t('drsPage.healthScore')}: {healthScore}/100</Typography>
              <Box>RAM {Math.round(healthBreakdown.avgMem)}% → {healthBreakdown.memPenalty === 0 ? 'OK' : healthBreakdown.memPenalty}</Box>
              <Box>CPU {Math.round(healthBreakdown.avgCpu)}% → {healthBreakdown.cpuPenalty === 0 ? 'OK' : healthBreakdown.cpuPenalty}</Box>
              <Box>{t('drsPage.imbalanceLabel')} {healthBreakdown.imbalance.toFixed(1)}% → {healthBreakdown.imbalancePenalty === 0 ? 'OK' : healthBreakdown.imbalancePenalty}</Box>
            </Box>
          } arrow disableInteractive>
            <Chip
              size="small"
              icon={healthScore >= 80 ? <CheckCircleIcon /> : <WarningAmberIcon />}
              label={healthLabel}
              color={healthColor}
              variant="outlined"
            />
          </Tooltip>

          {/* Spread indicator */}
          <Tooltip title={t('drsPage.memorySpreadBetweenNodes', { pct: memorySpread.toFixed(1) })} disableInteractive>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 1,
              py: 0.5,
              borderRadius: 1,
              bgcolor: alpha(theme.palette[spreadColor].main, 0.1),
            }}>
              <SwapHorizIcon sx={{ fontSize: 16, color: `${spreadColor}.main` }} />
              <Typography
                variant="caption"
                sx={{
                  fontWeight: 600,
                  color: `${spreadColor}.main`,
                  fontSize: '0.7rem'
                }}
              >
                {memorySpread.toFixed(0)}%
              </Typography>
            </Box>
          </Tooltip>

          {/* Mini stats - toujours à droite avec largeur fixe */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 120 }}>
            <ResourceGauge value={metrics?.summary?.avg_cpu_usage ?? 0} label="CPU" size={44} />
            <ResourceGauge value={metrics?.summary?.avg_memory_usage ?? 0} label="RAM" size={44} />
          </Box>

          <IconButton size="small" onClick={(e) => { e.stopPropagation(); onToggle() }}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Box>
      </Box>

      {/* Contenu expandable - Liste des nœuds */}
      <Collapse in={expanded}>
        <Box sx={{ p: 2 }}>
          {/* Légende */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2, opacity: 0.7 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TrendingUpIcon sx={{ fontSize: 14, color: 'error.main' }} />
              <Typography variant="caption">{t('drsPage.sourceToUnload')}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <TrendingDownIcon sx={{ fontSize: 14, color: 'success.main' }} />
              <Typography variant="caption">{t('drsPage.targetCanReceive')}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <BuildIcon sx={{ fontSize: 14, color: 'warning.main' }} />
              <Typography variant="caption">{t('drsPage.maintenance')}</Typography>
            </Box>
          </Box>

          {/* Liste des nœuds */}
          <Stack spacing={1}>
            {sortedNodes.map(node => {
              const role = getNodeRole(node)
              const isSource = role === 'source'
              const isTarget = role === 'target'
              const isMaintenance = role === 'maintenance'
              
              return (
                <Box
                  key={node.node}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    p: 1.5,
                    borderRadius: 1,
                    bgcolor: isMaintenance
                      ? alpha(theme.palette.warning.main, 0.08)
                      : isSource 
                        ? alpha(theme.palette.error.main, 0.06)
                        : isTarget 
                          ? alpha(theme.palette.success.main, 0.06)
                          : alpha(theme.palette.action.hover, 0.04),

                    // Bordure gauche épaisse colorée pour les rôles
                    borderLeft: isMaintenance || isSource || isTarget ? '4px solid' : 'none',
                    borderLeftColor: isMaintenance
                      ? 'warning.main'
                      : isSource
                        ? 'error.main'
                        : isTarget
                          ? 'success.main'
                          : 'transparent',
                    borderTop: 'none',
                    borderRight: 'none',
                    borderBottom: 'none',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      bgcolor: isMaintenance
                        ? alpha(theme.palette.warning.main, 0.12)
                        : isSource 
                          ? alpha(theme.palette.error.main, 0.1)
                          : isTarget 
                            ? alpha(theme.palette.success.main, 0.1)
                            : alpha(theme.palette.action.hover, 0.08),
                    }
                  }}
                >
                  {/* Indicateur de rôle */}
                  <Box sx={{ width: 24 }}>
                    {isMaintenance && <BuildIcon sx={{ fontSize: 18, color: 'warning.main' }} />}
                    {isSource && <TrendingUpIcon sx={{ fontSize: 18, color: 'error.main' }} />}
                    {isTarget && <TrendingDownIcon sx={{ fontSize: 18, color: 'success.main' }} />}
                  </Box>

                  {/* Nom du nœud */}
                  <Box sx={{ minWidth: 180 }}>
                    <Typography 
                      sx={{ 
                        fontWeight: 600, 
                        fontSize: '0.875rem'
                      }}
                    >
                      {node.node}
                    </Typography>
                    {isMaintenance && (
                      <Chip
                        label={t('drsPage.inMaintenance')}
                        size="small"
                        color="warning"
                        sx={{ height: 18, fontSize: '0.65rem', mt: 0.5 }}
                      />
                    )}
                  </Box>

                  {/* Barres CPU & RAM */}
                  <Box sx={{ flex: 1, display: 'flex', gap: 3 }}>
                    {/* CPU */}
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" sx={{ opacity: 0.6, mb: 0.5, display: 'block' }}>CPU</Typography>
                      <Box sx={{ position: 'relative' }}>
                        <LinearProgress
                          variant="determinate"
                          value={pct(node.cpu_usage)}
                          sx={{
                            height: 14,
                            borderRadius: 0,
                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                            '& .MuiLinearProgress-bar': { borderRadius: 0, bgcolor: node.cpu_usage > 90 ? 'error.main' : 'primary.main' }
                          }}
                        />
                        <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                          {node.cpu_usage.toFixed(1)}%
                        </Typography>
                      </Box>
                    </Box>

                    {/* RAM */}
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="caption" sx={{ opacity: 0.6, mb: 0.5, display: 'block' }}>RAM</Typography>
                      <Box sx={{ position: 'relative' }}>
                        <LinearProgress
                          variant="determinate"
                          value={pct(node.memory_usage)}
                          sx={{
                            height: 14,
                            borderRadius: 0,
                            bgcolor: alpha(theme.palette.primary.main, 0.1),
                            '& .MuiLinearProgress-bar': { borderRadius: 0, bgcolor: node.memory_usage > 90 ? 'error.main' : 'primary.main' }
                          }}
                        />
                        <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                          {node.memory_usage.toFixed(1)}%
                        </Typography>
                      </Box>
                    </Box>
                  </Box>

                  {/* VMs count */}
                  <Box sx={{ textAlign: 'right', minWidth: 70 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {node.running_vms}/{node.vm_count}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.5 }}>VMs</Typography>
                  </Box>
                </Box>
              )
            })}
          </Stack>
        </Box>
      </Collapse>
    </Card>
  )
}

// Active Migration Row - Affiche une migration en cours avec barre de progression
const ActiveMigrationRow = ({
  migration,
  progress
}: {
  migration: DRSMigration
  progress: MigrationProgress | null
}) => {
  const theme = useTheme()
  const t = useTranslations()
  const pct = progress?.progress ?? 0
  const message = progress?.message ?? t('drsPage.loading')
  const isComplete = migration.status === 'completed'
  const isFailed = migration.status === 'failed'
  
  const progressColor = isFailed 
    ? theme.palette.error.main 
    : isComplete 
      ? theme.palette.success.main 
      : theme.palette.info.main

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        py: 1.5,
        px: 2,
        borderRadius: 1,
        border: '1px solid',
        borderColor: alpha(progressColor, 0.5),
        bgcolor: alpha(progressColor, 0.05),
      }}
    >
      {/* Header row */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {/* Icône avec animation */}
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
          {!isComplete && !isFailed ? (
            <CircularProgress size={20} thickness={5} sx={{ color: progressColor }} />
          ) : isComplete ? (
            <CheckCircleIcon sx={{ color: 'success.main', fontSize: 20 }} />
          ) : (
            <WarningAmberIcon sx={{ color: 'error.main', fontSize: 20 }} />
          )}
        </Box>

        {/* VM Name + Type */}
        <Box sx={{ minWidth: 140 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }} noWrap>
            {migration.vm_name || `VM ${migration.vmid}`}
          </Typography>
          {migration.guest_type === 'lxc' && (
            <Chip label="CT" size="small" sx={{ height: 16, fontSize: '0.6rem' }} />
          )}
        </Box>

        {/* Migration path */}
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip 
            size="small" 
            label={migration.source_node} 
            sx={{ 
              bgcolor: alpha(theme.palette.error.main, 0.1),
              color: 'error.main',
              fontWeight: 500,
              fontSize: '0.75rem'
            }} 
          />
          <Typography sx={{ opacity: 0.4 }}>→</Typography>
          <Chip 
            size="small" 
            label={migration.target_node}
            sx={{ 
              bgcolor: alpha(theme.palette.success.main, 0.1),
              color: 'success.main',
              fontWeight: 500,
              fontSize: '0.75rem'
            }} 
          />
        </Box>

      </Box>

      {/* Progress bar */}
      <Box sx={{ width: '100%' }}>
        <Box sx={{ position: 'relative' }}>
          <LinearProgress
            variant="determinate"
            value={pct}
            sx={{
              height: 14,
              borderRadius: 0,
              bgcolor: alpha(progressColor, 0.15),
              '& .MuiLinearProgress-bar': {
                borderRadius: 0,
                bgcolor: progressColor,
                transition: 'transform 0.5s ease-in-out'
              }
            }}
          />
          <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
            {pct.toFixed(0)}%
          </Typography>
        </Box>
        <Typography variant="caption" sx={{ opacity: 0.7, mt: 0.5, display: 'block' }}>
          {message}
        </Typography>
      </Box>
    </Box>
  )
}

// Recommendation Row - Ligne compacte pour une recommandation
const RecommendationRow = ({
  rec,
  onClick
}: {
  rec: DRSRecommendation
  onClick: () => void
}) => {
  const theme = useTheme()
  const t = useTranslations()
  const priorityLabel = getPriorityLabel(rec.priority)
  const priorityColor = getPriorityColor(rec.priority)

  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        py: 1.5,
        px: 2,
        borderRadius: 1,
        cursor: 'pointer',
        border: '1px solid',
        borderColor: rec.maintenance_evacuation ? alpha(theme.palette.warning.main, 0.5) : 'divider',
        bgcolor: rec.maintenance_evacuation ? alpha(theme.palette.warning.main, 0.03) : 'transparent',
        '&:hover': {
          borderColor: 'primary.main',
          bgcolor: alpha(theme.palette.primary.main, 0.03)
        }
      }}
    >
      {/* Icône migration */}
      <SwapHorizIcon sx={{ opacity: 0.5, fontSize: 20 }} />

      {/* VM Name + Type */}
      <Box sx={{ minWidth: 160 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.875rem' }} noWrap>
          {rec.vm_name || `VM ${rec.vmid}`}
        </Typography>
        {rec.guest_type === 'lxc' && (
          <Chip label="CT" size="small" sx={{ height: 16, fontSize: '0.6rem' }} />
        )}
        {rec.maintenance_evacuation && (
          <Chip label={t('drsPage.evacuation')} size="small" color="warning" sx={{ height: 16, fontSize: '0.6rem', ml: 0.5 }} />
        )}
      </Box>

      {/* Migration path */}
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip 
          size="small" 
          label={rec.source_node} 
          sx={{ 
            bgcolor: alpha(theme.palette.error.main, 0.1),
            color: 'error.main',
            fontWeight: 500,
            fontSize: '0.75rem'
          }} 
        />
        <Typography sx={{ opacity: 0.4 }}>→</Typography>
        <Chip 
          size="small" 
          label={rec.target_node}
          sx={{ 
            bgcolor: alpha(theme.palette.success.main, 0.1),
            color: 'success.main',
            fontWeight: 500,
            fontSize: '0.75rem'
          }} 
        />
      </Box>

      {/* Priority & Score */}
      <Stack direction="row" spacing={1} alignItems="center">
        <Chip
          size="small"
          label={priorityLabel.toUpperCase()}
          color={priorityColor}
          sx={{ minWidth: 70 }}
        />
        <Tooltip title={t('drsPage.scoreTooltip', { score: rec.score.toFixed(1) })} arrow>
          <Chip
            size="small"
            variant="outlined"
            label={`+${rec.score.toFixed(0)}%`}
            sx={{ minWidth: 55, cursor: 'help' }}
          />
        </Tooltip>
      </Stack>
    </Box>
  )
}

// ============================================
// Storage Warning Component pour le Drawer
// ============================================

const StorageWarningPanel = ({
  migrationCheck,
  loading,
  targetNode
}: {
  migrationCheck: MigrationCheckResult | null
  loading: boolean
  targetNode?: string
}) => {
  const theme = useTheme()
  const t = useTranslations()

  if (loading) {
    return (
      <Box sx={{ py: 2 }}>
        <Skeleton variant="rectangular" height={80} sx={{ borderRadius: 1 }} />
      </Box>
    )
  }

  if (!migrationCheck) return null

  const hasLocalDisks = migrationCheck.local_disks && migrationCheck.local_disks.length > 0
  const targetStorage = migrationCheck.target_storage

  // Fonction pour obtenir la couleur selon le niveau d'alerte
  const getWarningColor = (level?: string) => {
    switch (level) {
      case 'full': return theme.palette.error.main
      case 'critical': return theme.palette.error.main
      case 'warning': return theme.palette.warning.main
      default: return theme.palette.success.main
    }
  }

  if (!hasLocalDisks) {
    // Stockage partagé - migration sûre
    return (
      <Alert
        severity="success"
        icon={<CheckCircleIcon />}
        sx={{ mb: 2 }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {t('drsPage.sharedStorageOnly')}
        </Typography>
        <Typography variant="caption">
          {t('drsPage.sharedStorageSafe')}
        </Typography>
      </Alert>
    )
  }

  // Stockage local détecté - afficher le warning
  return (
    <Stack spacing={2} sx={{ mb: 2 }}>
      {/* Alert stockage local */}
      <Alert
        severity="warning"
        icon={<WarningAmberIcon />}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
          {t('drsPage.localStorageDetected')}
        </Typography>
        <Typography variant="caption" component="div" sx={{ mb: 1.5 }}>
          {migrationCheck.warning}
        </Typography>

        {/* Liste des disques locaux */}
        <Box sx={{ mb: 1.5 }}>
          {migrationCheck.local_disks.map((disk, idx) => (
            <Box
              key={idx}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                py: 0.75,
                px: 1,
                mb: 0.5,
                bgcolor: alpha(theme.palette.warning.main, 0.1),
                borderRadius: 0.5,
                fontSize: '0.75rem'
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <HardwareIcon sx={{ fontSize: 14, opacity: 0.7 }} />
                <Typography variant="caption" sx={{ fontWeight: 500 }}>
                  {disk.device}
                </Typography>
                <Chip 
                  label={disk.storage} 
                  size="small" 
                  sx={{ 
                    height: 18, 
                    fontSize: '0.65rem',
                    bgcolor: alpha(theme.palette.warning.main, 0.2)
                  }} 
                />
              </Box>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {disk.size_str || formatBytes(disk.size)}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Stats totales */}
        <Box sx={{ 
          display: 'flex', 
          gap: 2, 
          pt: 1, 
          borderTop: '1px dashed',
          borderColor: alpha(theme.palette.warning.main, 0.3)
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <StorageIcon sx={{ fontSize: 14, opacity: 0.7 }} />
            <Typography variant="caption">
              {t('drsPage.totalSize')}: <strong>{formatBytes(migrationCheck.total_local_size)}</strong>
            </Typography>
          </Box>
          {migrationCheck.estimated_time && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 14, opacity: 0.7 }} />
              <Typography variant="caption">
                {t('drsPage.estimatedDuration')}: <strong>{migrationCheck.estimated_time}</strong>
              </Typography>
            </Box>
          )}
        </Box>
      </Alert>

      {/* Info stockage cible */}
      {targetStorage && (
        <Alert 
          severity={targetStorage.will_exceed ? 'error' : targetStorage.warning_level === 'critical' ? 'error' : targetStorage.warning_level === 'warning' ? 'warning' : 'info'}
          icon={<StorageIcon />}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('drsPage.targetStorageLabel', { storage: targetStorage.storage, node: targetStorage.node })}
          </Typography>

          {/* Barre de progression actuelle vs après migration */}
          <Box sx={{ mb: 1.5 }}>
            {/* État actuel */}
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" sx={{ opacity: 0.7, mb: 0.5, display: 'block' }}>{t('drsPage.currently')} — {formatBytes(targetStorage.used_size)} / {formatBytes(targetStorage.total_size)}</Typography>
              <Box sx={{ position: 'relative' }}>
                <LinearProgress
                  variant="determinate"
                  value={pct(targetStorage.usage_percent)}
                  sx={{
                    height: 14,
                    borderRadius: 0,
                    bgcolor: alpha(theme.palette.grey[500], 0.2),
                    '& .MuiLinearProgress-bar': { borderRadius: 0, bgcolor: targetStorage.usage_percent >= 90 ? 'error.main' : 'primary.main' }
                  }}
                />
                <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                  {targetStorage.usage_percent.toFixed(1)}%
                </Typography>
              </Box>
            </Box>

            {/* Après migration */}
            <Box>
              <Typography variant="caption" sx={{ opacity: 0.7, mb: 0.5, display: 'block', color: getWarningColor(targetStorage.warning_level) }}>{t('drsPage.afterMigration')} — {formatBytes(targetStorage.used_after)} / {formatBytes(targetStorage.total_size)}</Typography>
              <Box sx={{ position: 'relative' }}>
                <LinearProgress
                  variant="determinate"
                  value={pct(targetStorage.usage_after_pct)}
                  sx={{
                    height: 14,
                    borderRadius: 0,
                    bgcolor: alpha(theme.palette.grey[500], 0.2),
                    '& .MuiLinearProgress-bar': { borderRadius: 0, bgcolor: getWarningColor(targetStorage.warning_level) }
                  }}
                />
                <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                  {targetStorage.usage_after_pct.toFixed(1)}%
                </Typography>
              </Box>
            </Box>
          </Box>

          {/* Message de warning/erreur */}
          {targetStorage.will_exceed ? (
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1,
              p: 1,
              bgcolor: alpha(theme.palette.error.main, 0.1),
              borderRadius: 1
            }}>
              <WarningAmberIcon sx={{ fontSize: 18, color: 'error.main' }} />
              <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
                {t('drsPage.insufficientSpace')}
              </Typography>
            </Box>
          ) : targetStorage.warning_level === 'critical' ? (
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1,
              p: 1,
              bgcolor: alpha(theme.palette.error.main, 0.1),
              borderRadius: 1
            }}>
              <WarningAmberIcon sx={{ fontSize: 18, color: 'error.main' }} />
              <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
                {t('drsPage.storageCriticalAfter')}
              </Typography>
            </Box>
          ) : targetStorage.warning_level === 'warning' ? (
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 1,
              p: 1,
              bgcolor: alpha(theme.palette.warning.main, 0.1),
              borderRadius: 1
            }}>
              <WarningAmberIcon sx={{ fontSize: 18, color: 'warning.main' }} />
              <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 600 }}>
                {t('drsPage.storageHighAfter')}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
              <Typography variant="caption" sx={{ color: 'success.main' }}>
                {t('drsPage.spaceAvailable', { space: formatBytes(targetStorage.avail_after) })}
              </Typography>
            </Box>
          )}
        </Alert>
      )}

      {/* Message si pas d'info stockage cible (backend pas encore mis à jour) */}
      {!targetStorage && hasLocalDisks && (
        <Alert severity="info" icon={<StorageIcon />}>
          <Typography variant="caption" dangerouslySetInnerHTML={{ __html: t('drsPage.checkStorageManually', { node: targetNode }) }} />
        </Alert>
      )}
    </Stack>
  )
}

// ============================================
// Main Page Component
// ============================================

export default function DRSPage() {
  const theme = useTheme()
  const t = useTranslations()
  const dateLocale = getDateLocale(useLocale())
  const { isEnterprise } = useLicense()
  const [tab, setTab] = useState(0)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(new Set())
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [selectedRec, setSelectedRec] = useState<DRSRecommendation | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [selectedCluster, setSelectedCluster] = useState<string>('')
  const [executedRecIds, setExecutedRecIds] = useState<Set<string>>(new Set())

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('drs.title'), t('drs.subtitle'), 'ri-loop-left-fill')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])
  
  // État pour la vérification de migration
  const [migrationCheck, setMigrationCheck] = useState<MigrationCheckResult | null>(null)
  const [migrationCheckLoading, setMigrationCheckLoading] = useState(false)
  
  // État pour la progression des migrations actives
  const [migrationsProgress, setMigrationsProgress] = useState<Record<string, MigrationProgress>>({})

  // Data fetching (only when Enterprise mode is active)
  const { data: status, mutate: mutateStatus, isLoading: statusLoading } = useDRSStatus(isEnterprise)

  const { data: recommendationsRaw, mutate: mutateRecs, isLoading: recsLoading } = useDRSRecsHook(isEnterprise)

  const recommendations: DRSRecommendation[] = (ensureArray(recommendationsRaw as any) as DRSRecommendation[]).filter(r => !executedRecIds.has(r.id))

  const { data: migrationsRaw, mutate: mutateMigrations, isLoading: migrationsLoading } = useDRSMigrations(isEnterprise)


  // Garder toutes les migrations non-null (useMemo pour éviter les re-renders inutiles)
  const migrations = useMemo(() =>
    ensureArray(migrationsRaw as any).filter((m: any) => m != null) as DRSMigration[],
    [migrationsRaw]
  )

  const { data: metricsData, mutate: mutateMetrics } = useDRSMetrics(isEnterprise)

  const { data: drsSettings, mutate: mutateSettings } = useDRSSettings(isEnterprise)

  const { data: affinityRulesRaw, mutate: mutateRules } = useDRSRules(isEnterprise)

  const affinityRules: any[] = ensureArray(affinityRulesRaw as any).map((r: any) => {
    // Parse vmids: could be an array, a JSON string (vm_ids_json), or undefined
    let vmids = r.vmids || r.vm_ids || []
    if (typeof vmids === 'string') {
      try { vmids = JSON.parse(vmids) } catch { vmids = [] }
    }

    // Parse nodes: could be an array, a JSON string (nodes_json), or undefined
    let nodes = r.nodes || []
    if (typeof nodes === 'string') {
      try { nodes = JSON.parse(nodes) } catch { nodes = [] }
    }

    return {
      ...r,
      connectionId: r.connectionId || r.connection_id,
      vmids,
      nodes,
      fromTag: r.fromTag || r.from_tag || false,
      fromPool: r.fromPool || r.from_pool || false,
    }
  })

  // Récupérer les connexions PVE pour avoir les noms
  const { data: connectionsData } =
    useSWR<{ data: Connection[] }>('/api/v1/connections?type=pve', fetcher)
  
  // Map connectionId -> name
  const connectionNames = useMemo(() => {
    const map: Record<string, string> = {}

    if (connectionsData?.data) {
      connectionsData.data.forEach(c => {
        map[c.id] = c.name
      })
    }

    
return map
  }, [connectionsData])

  const { data: allVMsData } =
    useSWR<{ data: { vms: VMFromAPI[] } }>('/api/v1/vms', fetcher)
  
  // Extraire les VMs du format de réponse existant et les convertir pour AffinityRulesManager
  const allVMs: AffinityVMInfo[] = useMemo(() => {
    if (!allVMsData?.data?.vms) return []
    
return allVMsData.data.vms.map(vm => ({
      vmid: parseInt(vm.vmid, 10) || 0,
      name: vm.name,
      node: vm.node || vm.host,
      type: vm.type,
      connectionId: vm.connId,
    }))
  }, [allVMsData])

  // Computed
  // Set of node names currently in maintenance — used to filter out bad targets
  // Combines: orchestrator metrics (in_maintenance) + DRS settings (maintenance_nodes)
  const maintenanceNodeNames = useMemo(() => {
    const set = new Set<string>()

    // Source 1: orchestrator metrics
    if (metricsData) {
      for (const [, metrics] of Object.entries(metricsData as Record<string, any>)) {
        for (const n of (metrics?.nodes || [])) {
          if (n.in_maintenance) set.add(n.node)
        }
      }
    }

    // Source 2: DRS settings maintenance_nodes list
    if (drsSettings?.maintenance_nodes) {
      for (const name of drsSettings.maintenance_nodes) {
        set.add(name)
      }
    }

    return set
  }, [metricsData, drsSettings])

  const pendingRecs = useMemo(() =>
    recommendations.filter(r =>
      (r.status === 'pending' || r.status === 'approved') &&
      !maintenanceNodeNames.has(r.target_node)
    ),
    [recommendations, maintenanceNodeNames]
  )

  const clusters = useMemo(() => {
    if (!metricsData) return []
    
return Object.entries(metricsData as any)

      // Filtrer pour ne garder que les vrais clusters (plus d'un nœud)
      .filter(([_, metrics]: [string, any]) => (metrics.nodes?.length || 0) > 1)
      .map(([id, metrics]: [string, any]) => ({
        id,
        name: connectionNames[id] || metrics.connection_name || id.slice(0, 12),
        metrics,
        recommendations: pendingRecs.filter(r => r.connection_id === id)
      }))
  }, [metricsData, pendingRecs, connectionNames])

  // Cluster versions for PSI support check
  const clusterVersions: ClusterVersionInfo[] = useMemo(() => {
    return clusters.map(c => ({
      connectionId: c.id,
      name: c.name,
      version: c.metrics.pve_version || 8
    }))
  }, [clusters])

  // All nodes list
  const allNodes = useMemo(() => {
    return clusters.flatMap(c => c.metrics.nodes?.map(n => n.node) || [])
  }, [clusters])

  // Set default selected cluster
  useEffect(() => {
    if (clusters.length > 0 && !selectedCluster) {
      setSelectedCluster(clusters[0].id)
    }
  }, [clusters, selectedCluster])

  // Expand first cluster with recommendations by default
  useEffect(() => {
    if (clusters.length > 0 && expandedClusters.size === 0) {
      const clusterWithRecs = clusters.find(c => c.recommendations.length > 0)

      if (clusterWithRecs) {
        setExpandedClusters(new Set([clusterWithRecs.id]))
      } else {
        setExpandedClusters(new Set([clusters[0].id]))
      }
    }
  }, [clusters])

  // Detect PVE HA groups / affinity rules that may conflict with DRS
  const clusterIds = useMemo(() => clusters.map(c => c.id).sort().join(','), [clusters])

  const { data: haDataMap } = useSWR(
    clusterIds ? `ha-check:${clusterIds}` : null,
    async () => {
      const results: Record<string, { groups: number; rules: number; majorVersion: number }> = {}
      await Promise.all(clusters.map(async (c) => {
        try {
          const res = await fetch(`/api/v1/connections/${c.id}/ha`)
          if (!res.ok) return
          const { data } = await res.json()
          results[c.id] = {
            groups: data?.groups?.length || 0,
            rules: data?.rules?.length || 0,
            majorVersion: data?.majorVersion || 8,
          }
        } catch { /* ignore */ }
      }))
      return results
    },
    { revalidateOnFocus: false }
  )

  // Only warn for PVE 9+ clusters that have native affinity rules.
  // PVE 8 HA groups are the normal HA mechanism, not a conflict.
  const haWarnings = useMemo(() => {
    if (!haDataMap) return []
    const warnings: { clusterId: string; clusterName: string; majorVersion: number; groups: number; rules: number }[] = []
    for (const c of clusters) {
      const ha = haDataMap[c.id]
      if (!ha) continue
      if (ha.majorVersion >= 9 && ha.rules > 0) {
        warnings.push({ clusterId: c.id, clusterName: c.name, majorVersion: ha.majorVersion, groups: ha.groups, rules: ha.rules })
      }
    }
    return warnings
  }, [haDataMap, clusters])

  // Récupérer la progression des migrations actives
  const activeMigrations = useMemo(() =>
    migrations.filter(m => m.status === 'running'),
    [migrations]
  )

  // IDs des migrations actives (string stable pour la dépendance)
  const activeMigrationIds = useMemo(() =>
    activeMigrations.map(m => m.id).sort().join(','),
    [activeMigrations]
  )

  // Effet pour mettre à jour la progression des migrations actives
  useEffect(() => {
    if (!activeMigrationIds) {
      // Seulement réinitialiser si l'objet n'est pas déjà vide
      setMigrationsProgress(prev => {
        if (Object.keys(prev).length === 0) return prev
        return {}
      })
      return
    }

    const migrationIds = activeMigrationIds.split(',')

    // Fonction pour récupérer la progression d'une migration
    let needsRefresh = false
    const fetchProgress = async (migrationId: string) => {
      try {
        const res = await fetch(`/api/v1/orchestrator/drs/migrations/${migrationId}/progress`)

        if (res.ok) {
          const data = await res.json()

          setMigrationsProgress(prev => ({ ...prev, [migrationId]: data }))

          // If progress shows task is done, trigger a migrations list refresh
          // so the "running" migration gets updated to completed/failed
          if (data.progress >= 100 || data.status === 'stopped') {
            needsRefresh = true
          }
        }
      } catch (err) {
        console.error('Error fetching migration progress:', err)
      }
    }

    // Récupérer la progression de toutes les migrations actives
    const fetchAll = async () => {
      needsRefresh = false
      await Promise.all(migrationIds.map(id => fetchProgress(id)))
      if (needsRefresh) mutateMigrations()
    }

    fetchAll()

    // Rafraîchir toutes les 2 secondes
    const interval = setInterval(fetchAll, 2000)

    return () => clearInterval(interval)
  }, [activeMigrationIds])

  // Fonction pour vérifier la migration quand on ouvre le drawer
  const checkMigration = useCallback(async (rec: DRSRecommendation) => {
    setMigrationCheckLoading(true)
    setMigrationCheck(null)
    
    try {
      const guestType = rec.guest_type || 'qemu'

      // Inclure le nœud cible pour vérifier l'espace disponible
      const url = `/api/v1/orchestrator/drs/check-migration/${rec.vmid}?connection_id=${rec.connection_id}&node=${rec.source_node}&target_node=${rec.target_node}&type=${guestType}`
      const res = await fetch(url)
      
      if (res.ok) {
        const data = await res.json()

        setMigrationCheck(data)
      } else {
        console.error('Failed to check migration:', res.status, res.statusText)
      }
    } catch (err) {
      console.error('Error checking migration:', err)
    } finally {
      setMigrationCheckLoading(false)
    }
  }, [])

  // Handlers
  const toggleCluster = (id: string) => {
    setExpandedClusters(prev => {
      const next = new Set(prev)

      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }

      
return next
    })
  }

  const handleRefresh = useCallback(async () => {
    await Promise.all([mutateStatus(), mutateRecs(), mutateMigrations(), mutateMetrics()])
  }, [mutateStatus, mutateRecs, mutateMigrations, mutateMetrics])

  const handleTriggerEvaluation = useCallback(async () => {
    try {
      setActionLoading('evaluate')
      await apiAction('/api/v1/orchestrator/drs/evaluate', 'POST')
      await new Promise(r => setTimeout(r, 2000))
      await mutateRecs()
    } catch (e) {
      console.error(e)
    } finally {
      setActionLoading(null)
    }
  }, [mutateRecs])

  const openRecommendation = useCallback(async (rec: DRSRecommendation) => {
    setSelectedRec(rec)
    setDrawerOpen(true)

    // Lancer la vérification de migration
    checkMigration(rec)
    
    // Valider que la recommandation est toujours valide (VM toujours sur le bon nœud)
    try {
      const res = await fetch(`/api/v1/orchestrator/drs/recommendations?validate=true`)
      const validated = await res.json()
      const updatedRec = validated.find((r: DRSRecommendation) => r.id === rec.id)
      
      if (updatedRec) {
        // Mettre à jour avec les données validées
        setSelectedRec(updatedRec)
        
        // Si la recommandation est devenue stale, avertir l'utilisateur
        if (updatedRec.status === 'stale') {
          // La recommendation sera affichée avec son nouveau statut
        }
      }


      // Mettre à jour le cache SWR avec les données validées
      mutateRecs(validated, false)
    } catch (e) {
      console.error('Error validating recommendation:', e)
    }
  }, [checkMigration, mutateRecs])

  const handleRecommendationAction = useCallback(async (id: string, action: 'approve' | 'reject' | 'execute') => {
    try {
      setActionLoading(`${action}-${id}`)
      await apiAction(`/api/v1/orchestrator/drs/recommendations/${id}/${action}`, 'POST')

      if (action === 'execute') {
        // Track executed recommendation so it stays hidden even after SWR revalidation
        setExecutedRecIds(prev => new Set(prev).add(id))

        await mutateMigrations()
        setDrawerOpen(false)
        setSelectedRec(null)
      } else {
        // For approve/reject, refresh with validation
        const res = await fetch(`/api/v1/orchestrator/drs/recommendations?validate=true`)
        const validated = await res.json()
        mutateRecs(validated, false)
        setDrawerOpen(false)
      }
    } catch (e: any) {
      console.error('Error executing recommendation action:', e)
      
      // Gérer les différents cas d'erreur
      const errorMsg = e.message || ''
      
      if (errorMsg.includes('has moved') || errorMsg.includes('stale')) {
        // VM a bougé depuis la création de la recommandation
        setDrawerOpen(false)
        setSelectedRec(null)

        // Rafraîchir avec validation
        const res = await fetch(`/api/v1/orchestrator/drs/recommendations?validate=true`)
        const validated = await res.json()

        mutateRecs(validated, false)
        alert('Cette VM a été déplacée depuis la création de la recommandation. La liste a été actualisée.')
      } else if (errorMsg.includes('404') || errorMsg.includes('not found') || errorMsg.includes('Recommendation not found')) {
        // Recommandation n'existe plus
        setDrawerOpen(false)
        setSelectedRec(null)
        await mutateRecs()
        alert('Cette recommandation a expiré suite à une réévaluation. La liste a été actualisée.')
      } else if (errorMsg.includes('already on target')) {
        // VM déjà sur la cible
        setDrawerOpen(false)
        setSelectedRec(null)
        const res = await fetch(`/api/v1/orchestrator/drs/recommendations?validate=true`)
        const validated = await res.json()

        mutateRecs(validated, false)
        alert('Cette VM est déjà sur le nœud cible. La liste a été actualisée.')
      }
    } finally {
      setActionLoading(null)
    }
  }, [mutateRecs, mutateMigrations])

  // Fermer le drawer et nettoyer
  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    setMigrationCheck(null)
    setSelectedRec(null)
  }, [])

  // Settings handlers
  const handleSaveSettings = useCallback(async (settings: DRSSettings) => {
    await apiAction('/api/v1/orchestrator/drs/settings', 'PUT', settings)
    await mutateSettings()
  }, [mutateSettings])

  // Affinity rules handlers
  const handleCreateRule = useCallback(async (rule: Omit<AffinityRule, 'id'>) => {
    await apiAction('/api/v1/orchestrator/drs/rules', 'POST', rule)
    await mutateRules()
  }, [mutateRules])

  const handleUpdateRule = useCallback(async (id: string, rule: Partial<AffinityRule>) => {
    await apiAction(`/api/v1/orchestrator/drs/rules/${id}`, 'PUT', rule)
    await mutateRules()
  }, [mutateRules])

  const handleDeleteRule = useCallback(async (id: string) => {
    await apiAction(`/api/v1/orchestrator/drs/rules/${id}`, 'DELETE')
    await mutateRules()
  }, [mutateRules])

  // Stats globales
  const globalStats = useMemo(() => {
    const allNodesArr = clusters.flatMap(c => c.metrics.nodes || [])
    const totalVMs = clusters.reduce((acc, c) => acc + (c.metrics.summary?.running_vms || 0), 0)

    // Compute weighted health score across all clusters with breakdown
    let healthSum = 0
    let clusterCount = 0
    let maxImbalance = 0
    let totalMemPenalty = 0, totalCpuPenalty = 0, totalImbalancePenalty = 0
    let avgMemAll = 0, avgCpuAll = 0, avgImbalanceAll = 0
    for (const c of clusters) {
      const b = computeDrsHealthScore(c.metrics?.summary)
      healthSum += b.score
      totalMemPenalty += b.memPenalty
      totalCpuPenalty += b.cpuPenalty
      totalImbalancePenalty += b.imbalancePenalty
      avgMemAll += b.avgMem
      avgCpuAll += b.avgCpu
      avgImbalanceAll += b.imbalance
      clusterCount++
      if (b.imbalance > maxImbalance) maxImbalance = b.imbalance
    }

    return {
      clusters: clusters.length,
      nodes: allNodesArr.length,
      vms: totalVMs,
      recommendations: pendingRecs.length,
      migrations: migrations.filter(m => m.status === 'running').length,
      healthScore: clusterCount > 0 ? Math.round(healthSum / clusterCount) : 100,
      maxImbalance,
      breakdown: clusterCount > 0 ? {
        avgMem: avgMemAll / clusterCount,
        memPenalty: Math.round(totalMemPenalty / clusterCount),
        avgCpu: avgCpuAll / clusterCount,
        cpuPenalty: Math.round(totalCpuPenalty / clusterCount),
        imbalance: avgImbalanceAll / clusterCount,
        imbalancePenalty: Math.round(totalImbalancePenalty / clusterCount),
      } : null,
    }
  }, [clusters, pendingRecs, migrations])

  // Chart data for resource distribution
  const chartData = useMemo(() => {
    if (clusters.length === 1 && clusters[0].metrics.nodes?.length > 1) {
      // Single cluster: show bars per node
      return (clusters[0].metrics.nodes || []).map((n: NodeMetrics) => ({
        name: n.node.length > 10 ? n.node.slice(0, 10) + '…' : n.node,
        CPU: Math.round(n.cpu_usage * 10) / 10,
        RAM: Math.round(n.memory_usage * 10) / 10,
      }))
    }
    return clusters.map(c => ({
      name: (connectionNames[c.id] || c.name || c.id).slice(0, 12),
      CPU: Math.round((c.metrics.summary?.avg_cpu_usage ?? 0) * 10) / 10,
      RAM: Math.round((c.metrics.summary?.avg_memory_usage ?? 0) * 10) / 10,
    }))
  }, [clusters, connectionNames])

  return (
    <EnterpriseGuard requiredFeature={Features.DRS} featureName="DRS (Distributed Resource Scheduler)">
      <Box sx={{ p: 3 }}>
        {/* Header Actions */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 3 }}>
          <IconButton onClick={handleRefresh} size="small">
            <RefreshIcon />
          </IconButton>
        <Button
          variant="outlined"
          size="small"
          startIcon={actionLoading === 'evaluate' ? <CircularProgress size={16} /> : <SpeedIcon />}
          onClick={handleTriggerEvaluation}
          disabled={!!actionLoading}
        >
          {t('drsPage.evaluate')}
        </Button>
      </Box>

      {/* KPI Dashboard */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 2fr 1fr' }, gap: 2, mb: 3 }}>
        {/* Column 1 — Health Overview */}
        <Tooltip title={globalStats.breakdown ? (
          <Box sx={{ fontSize: '0.75rem' }}>
            <Typography variant="caption" sx={{ fontWeight: 700, display: 'block', mb: 0.5 }}>{t('drsPage.scoreCalculation')}</Typography>
            <Box>RAM {Math.round(globalStats.breakdown.avgMem)}% → {globalStats.breakdown.memPenalty === 0 ? 'OK' : globalStats.breakdown.memPenalty} pts</Box>
            <Box>CPU {Math.round(globalStats.breakdown.avgCpu)}% → {globalStats.breakdown.cpuPenalty === 0 ? 'OK' : globalStats.breakdown.cpuPenalty} pts</Box>
            <Box>{t('drsPage.imbalanceLabel')} {globalStats.breakdown.imbalance.toFixed(1)}% → {globalStats.breakdown.imbalancePenalty === 0 ? 'OK' : globalStats.breakdown.imbalancePenalty} pts</Box>
            <Divider sx={{ my: 0.5, borderColor: 'rgba(255,255,255,0.2)' }} />
            <Box sx={{ fontWeight: 600 }}>{t('drsPage.scoreFormula')}</Box>
          </Box>
        ) : ''} arrow placement="right">
          <Paper sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1, borderRadius: 2, cursor: 'help' }} variant="outlined">
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircularProgress
                variant="determinate"
                value={100}
                size={100}
                thickness={5}
                sx={{ color: alpha(
                  globalStats.healthScore >= 80 ? theme.palette.success.main
                  : globalStats.healthScore >= 50 ? theme.palette.warning.main
                  : theme.palette.error.main, 0.15
                ) }}
              />
              <CircularProgress
                variant="determinate"
                value={pct(globalStats.healthScore)}
                size={100}
                thickness={5}
                sx={{
                  color: globalStats.healthScore >= 80 ? 'success.main'
                    : globalStats.healthScore >= 50 ? 'warning.main'
                    : 'error.main',
                  position: 'absolute', left: 0,
                }}
              />
              <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1 }}>
                  {globalStats.healthScore}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.5, fontSize: '0.6rem' }}>/ 100</Typography>
              </Box>
            </Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mt: 0.5 }}>
              {t('drsPage.healthScore')}
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              {globalStats.clusters} {t('drsPage.clustersTab').toLowerCase()} • {globalStats.nodes} {t('drsPage.nodesLabel')}
            </Typography>
          </Paper>
        </Tooltip>

        {/* Column 2 — Resource Distribution Chart */}
        <Paper sx={{ p: 2, borderRadius: 2 }} variant="outlined">
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
            {t('drsPage.resourceDistribution')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: 'info.main' }} />
              <Typography variant="caption" sx={{ opacity: 0.7 }}>CPU</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: 'warning.main' }} />
              <Typography variant="caption" sx={{ opacity: 0.7 }}>RAM</Typography>
            </Box>
          </Box>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={chartData} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke={alpha(theme.palette.divider, 0.4)} />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke={theme.palette.text.secondary} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke={theme.palette.text.secondary} unit="%" />
                <RechartsTooltip
                  contentStyle={{
                    backgroundColor: theme.palette.background.paper,
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  itemStyle={{ color: theme.palette.text.primary }}
                  labelStyle={{ color: theme.palette.text.secondary }}
                  cursor={false}
                  formatter={(value: number) => [`${value.toFixed(1)}%`]}
                />
                <Bar dataKey="CPU" fill={theme.palette.info.main} radius={[3, 3, 0, 0]} name="CPU" />
                <Bar dataKey="RAM" fill={theme.palette.warning.main} radius={[3, 3, 0, 0]} name="RAM" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Box sx={{ height: 140, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('drsPage.noClusterConnected')}</Typography>
            </Box>
          )}
          <Typography variant="caption" sx={{ opacity: 0.6, mt: 0.5, display: 'block', textAlign: 'center' }}>
            {globalStats.vms} VMs {t('drsPage.activeVms').toLowerCase()}
          </Typography>
        </Paper>

        {/* Column 3 — Activity Panel */}
        <Paper sx={{ p: 2, borderRadius: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }} variant="outlined">
          {/* Recommendations */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {globalStats.recommendations > 0
                ? <WarningAmberIcon style={{ fontSize: 18, color: theme.palette.warning.main }} />
                : <CheckCircleIcon style={{ fontSize: 18, color: theme.palette.success.main }} />}
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('drsPage.recommendations')}</Typography>
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{globalStats.recommendations}</Typography>
          </Box>

          {/* Active migrations */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{
                width: 8, height: 8, borderRadius: '50%',
                bgcolor: globalStats.migrations > 0 ? 'info.main' : 'text.disabled',
                ...(globalStats.migrations > 0 && {
                  animation: 'pulse 1.5s ease-in-out infinite',
                  '@keyframes pulse': {
                    '0%, 100%': { opacity: 1 },
                    '50%': { opacity: 0.4 },
                  },
                }),
              }} />
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('drsPage.migrationsLabel')}</Typography>
            </Box>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>{globalStats.migrations}</Typography>
          </Box>

          <Divider />

          {/* DRS Mode */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>Mode</Typography>
            <Chip
              size="small"
              label={(status?.mode || 'manual').toUpperCase()}
              color={status?.mode === 'automatic' ? 'success' : status?.mode === 'partial' ? 'warning' : 'info'}
            />
          </Box>

          {/* Max Imbalance */}
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>Imbalance</Typography>
            <Box sx={{ position: 'relative' }}>
              <LinearProgress
                variant="determinate"
                value={Math.min(100, globalStats.maxImbalance)}
                sx={{
                  height: 14,
                  borderRadius: 0,
                  bgcolor: alpha(theme.palette.grey[500], 0.15),
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 0,
                    bgcolor: globalStats.maxImbalance > 10 ? theme.palette.error.main
                      : globalStats.maxImbalance > 5 ? theme.palette.warning.main
                      : theme.palette.success.main,
                  }
                }}
              />
              <Typography variant="caption" sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff', lineHeight: 1, textShadow: '0 0 2px rgba(0,0,0,0.5)' }}>
                {globalStats.maxImbalance.toFixed(1)}
              </Typography>
            </Box>
          </Box>
        </Paper>
      </Box>

      {/* Tabs */}
      {/* HA conflict warnings */}
      {haWarnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} icon={<i className="ri-error-warning-line" style={{ fontSize: 20 }} />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {t('drsPage.haConflictTitle')}
          </Typography>
          {haWarnings.map(w => (
            <Typography key={w.clusterId} variant="body2">
              <strong>{w.clusterName}</strong> (PVE {w.majorVersion}){' — '}
              {t('drsPage.haConflictPve9', { rules: w.rules, groups: w.groups })}
            </Typography>
          ))}
          <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.85 }}>
            {t('drsPage.haConflictHint')}
          </Typography>
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        variant="scrollable"
        scrollButtons="auto"
      >
        <Tab icon={<DnsIcon />} iconPosition="start" label={t('drsPage.clustersTab')} />
        <Tab
          icon={<SwapHorizIcon />}
          iconPosition="start"
          label={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {t('drsPage.recommendationsTab')}
              {activeMigrations.length > 0 && (
                <Chip size="small" label={activeMigrations.length} color="info" sx={{ minWidth: 20 }} />
              )}
              {pendingRecs.length > 0 && (
                <Chip size="small" label={pendingRecs.length} color="warning" />
              )}
            </Box>
          }
        />
        <Tab icon={<LocalOfferIcon />} iconPosition="start" label={t('drsPage.affinity')} />
        <Tab icon={<SettingsIcon />} iconPosition="start" label={t('drsPage.configuration')} />
      </Tabs>

      {/* Tab: Clusters */}
      {tab === 0 && (
        <Stack spacing={2}>
          {clusters.length === 0 ? (
            <EmptyState
              illustration={<DRSBalancingIllustration />}
              title={t('emptyState.noDrs')}
              description={t('emptyState.noDrsDesc')}
              size="large"
            />
          ) : (
            clusters.map(cluster => (
              <ClusterCard
                key={cluster.id}
                clusterId={cluster.id}
                clusterName={cluster.name}
                metrics={cluster.metrics}
                recommendations={pendingRecs}
                expanded={expandedClusters.has(cluster.id)}
                onToggle={() => toggleCluster(cluster.id)}
              />
            ))
          )}
        </Stack>
      )}

      {/* Tab: Recommendations */}
      {tab === 1 && (
        <Stack spacing={2}>
          {/* Migrations actives en cours */}
          {activeMigrations.length > 0 && (
            <Card variant="outlined" sx={{ borderRadius: 2, borderColor: 'info.main' }}>
              <CardContent>
                <Typography variant="subtitle2" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} />
                  {t('drsPage.migrationsInProgress', { count: activeMigrations.length })}
                </Typography>
                <Stack spacing={1}>
                  {activeMigrations.map(m => (
                    <ActiveMigrationRow
                      key={m.id}
                      migration={m}
                      progress={migrationsProgress[m.id] || null}
                    />
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}

          {/* Recommandations en attente */}
          <Card variant="outlined" sx={{ borderRadius: 2 }}>
            <CardContent>
              {recsLoading ? (
                <Stack spacing={1}>
                  {[1, 2, 3].map(i => <Skeleton key={i} height={56} />)}
                </Stack>
              ) : pendingRecs.length === 0 && activeMigrations.length === 0 ? (
                <Alert severity="success" icon={<CheckCircleIcon />}>
                  {t('drsPage.clustersEquilibrated')}
                </Alert>
              ) : pendingRecs.length === 0 ? (
                <Alert severity="info">
                  {t('drsPage.noNewRecommendation', { count: activeMigrations.length })}
                </Alert>
              ) : (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 2, opacity: 0.7 }}>
                    {t('drsPage.pendingRecommendations', { count: pendingRecs.length })}
                  </Typography>
                  <Stack spacing={1}>
                    {pendingRecs.map(rec => (
                      <RecommendationRow
                        key={rec.id}
                        rec={rec}
                        onClick={() => openRecommendation(rec)}
                      />
                    ))}
                  </Stack>
                </>
              )}
            </CardContent>
          </Card>
        </Stack>
      )}

      {/* Tab: Affinity Rules */}
      {tab === 2 && (
        <Box>
          {/* Cluster selector */}
          {clusters.length > 1 && (
            <FormControl size="small" sx={{ mb: 2, minWidth: 250 }}>
              <InputLabel>Cluster</InputLabel>
              <Select
                value={selectedCluster}
                label="Cluster"
                onChange={(e) => setSelectedCluster(e.target.value)}
              >
                {clusters.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
              </Select>
            </FormControl>
          )}
          
          <AffinityRulesManager
            rules={affinityRules.filter(r => r.connectionId === selectedCluster)}
            vms={allVMs.filter(v => v.connectionId === selectedCluster)}
            nodes={clusters.find(c => c.id === selectedCluster)?.metrics.nodes?.map(n => n.node) || []}
            connectionId={selectedCluster}
            onCreateRule={handleCreateRule}
            onUpdateRule={handleUpdateRule}
            onDeleteRule={handleDeleteRule}
            loading={!affinityRulesRaw}
          />
        </Box>
      )}

      {/* Tab: Configuration */}
      {tab === 3 && (
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <DRSSettingsPanel
              settings={drsSettings || defaultDRSSettings}
              nodes={allNodes}
              clusterVersions={clusterVersions}
              onSave={handleSaveSettings}
              loading={!drsSettings}
            />
          </CardContent>
        </Card>
      )}

      {/* Drawer for recommendation details */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={handleCloseDrawer}
        PaperProps={{ sx: { width: { xs: '100%', sm: 420 }, p: 3 } }}
      >
        {selectedRec && (
          <Stack spacing={3}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {t('drsPage.recommendedMigration')}
              </Typography>
              <IconButton onClick={handleCloseDrawer} size="small">
                <CloseIcon />
              </IconButton>
            </Box>

            <Divider />

            {/* Maintenance badge */}
            {selectedRec.maintenance_evacuation && (
              <Alert severity="warning" icon={<BuildIcon />}>
                {t('drsPage.evacuationForMaintenance')}
              </Alert>
            )}

            {/* ⚠️ Warning stockage local + vérification stockage cible */}
            <StorageWarningPanel 
              migrationCheck={migrationCheck} 
              loading={migrationCheckLoading}
              targetNode={selectedRec.target_node}
            />

            {/* VM Info */}
            <Box>
              <Typography variant="overline" sx={{ opacity: 0.5 }}>
                {selectedRec.guest_type === 'lxc' ? t('drsPage.container') : t('drsPage.vm')}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {selectedRec.vm_name || `VM ${selectedRec.vmid}`}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.6 }}>
                {selectedRec.guest_type === 'lxc' ? t('drsPage.ctidLabel') : t('drsPage.vmidLabel')}: {selectedRec.vmid}
              </Typography>
            </Box>

            {/* Migration visualization */}
            <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('drsPage.source')}</Typography>
                  <Typography sx={{ fontWeight: 600, color: 'error.main' }}>
                    {selectedRec.source_node}
                  </Typography>
                </Box>
                <SwapHorizIcon sx={{ fontSize: 32, opacity: 0.3 }} />
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="caption" sx={{ opacity: 0.5 }}>{t('drsPage.target')}</Typography>
                  <Typography sx={{ fontWeight: 600, color: 'success.main' }}>
                    {selectedRec.target_node}
                  </Typography>
                </Box>
              </Box>
            </Paper>

            {/* Details */}
            <Stack spacing={1.5}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('drsPage.priority')}</Typography>
                <Chip
                  size="small"
                  label={getPriorityLabel(selectedRec.priority).toUpperCase()}
                  color={getPriorityColor(selectedRec.priority)}
                />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('drsPage.estimatedImprovement')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: 'success.main' }}>
                  +{selectedRec.score.toFixed(1)}%
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('drsPage.reason')}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                  {selectedRec.reason}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('common.status')}</Typography>
                <Chip size="small" label={selectedRec.status} variant="outlined" />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" sx={{ opacity: 0.6 }}>{t('drsPage.createdOn')}</Typography>
                <Typography variant="body2">{formatDate(selectedRec.created_at, dateLocale)}</Typography>
              </Box>
            </Stack>

            <Divider />

            {/* Actions */}
            {(selectedRec.status === 'pending' || selectedRec.status === 'approved') && (
              <Stack spacing={1.5}>
                <Button
                  fullWidth
                  variant="contained"
                  color="primary"
                  size="large"
                  startIcon={actionLoading === `execute-${selectedRec.id}` ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                  onClick={() => handleRecommendationAction(selectedRec.id, 'execute')}
                  disabled={!!actionLoading}
                >
                  {t('drsPage.executeMigration')}
                </Button>

                {selectedRec.status === 'pending' && (
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      fullWidth
                      variant="outlined"
                      color="success"
                      startIcon={actionLoading === `approve-${selectedRec.id}` ? <CircularProgress size={16} /> : <CheckIcon />}
                      onClick={() => handleRecommendationAction(selectedRec.id, 'approve')}
                      disabled={!!actionLoading}
                    >
                      {t('drsPage.approve')}
                    </Button>
                    <Button
                      fullWidth
                      variant="outlined"
                      color="error"
                      startIcon={actionLoading === `reject-${selectedRec.id}` ? <CircularProgress size={16} /> : <CloseIcon />}
                      onClick={() => handleRecommendationAction(selectedRec.id, 'reject')}
                      disabled={!!actionLoading}
                    >
                      {t('drsPage.reject')}
                    </Button>
                  </Box>
                )}
              </Stack>
            )}

            {selectedRec.status === 'executed' && (
              <Alert severity="success">{t('drsPage.migrationExecuted')}</Alert>
            )}
            {selectedRec.status === 'rejected' && (
              <Alert severity="warning">{t('drsPage.recommendationRejected')}</Alert>
            )}
            {selectedRec.status === 'stale' && (
              <Alert severity="error" icon={<WarningAmberIcon />}>
                {t('drsPage.recommendationStale')}
              </Alert>
            )}
          </Stack>
        )}
      </Drawer>
    </Box>
    </EnterpriseGuard>
  )
}