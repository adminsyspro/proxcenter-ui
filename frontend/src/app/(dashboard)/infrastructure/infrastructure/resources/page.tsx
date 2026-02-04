'use client'

import { useEffect, useState, useCallback } from 'react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material'
import { lighten, alpha } from '@mui/material/styles'
import RefreshIcon from '@mui/icons-material/Refresh'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import WarningAmberIcon from '@mui/icons-material/WarningAmber'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import StorageIcon from '@mui/icons-material/Storage'
import MemoryIcon from '@mui/icons-material/Memory'
import SpeedIcon from '@mui/icons-material/Speed'
import CloudIcon from '@mui/icons-material/Cloud'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
} from 'recharts'

import { usePageTitle } from '@/contexts/PageTitleContext'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type KpiData = {
  cpu: { used: number; allocated: number; total: number; trend: number }
  ram: { used: number; allocated: number; total: number; trend: number }
  storage: { used: number; total: number; trend: number }
  vms: { total: number; running: number; stopped: number }
  efficiency: number
}

type ResourceTrend = {
  t: string
  cpu: number
  ram: number
  storage: number
}

type TopVm = {
  id: string
  name: string
  node: string
  cpu: number
  ram: number
  cpuAllocated: number
  ramAllocated: number
}

type Recommendation = {
  id: string
  type: 'overprovisioned' | 'underused' | 'stopped' | 'snapshot' | 'orphan' | 'prediction'
  severity: 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  savings?: string
  vmId?: string
  vmName?: string
  action?: string
}

type AiAnalysis = {
  summary: string
  recommendations: Recommendation[]
  loading: boolean
  error?: string
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i]
}

function formatPct(value: number): string {
  return `${Math.round(value)}%`
}

const COLORS = {
  cpu: '#f97316',
  ram: '#8b5cf6', 
  storage: '#06b6d4',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
}

/* ------------------------------------------------------------------ */
/* KPI Card Component                                                  */
/* ------------------------------------------------------------------ */

function KpiCard({ 
  title, 
  icon, 
  value, 
  subtitle, 
  percentage, 
  trend, 
  color,
  loading 
}: {
  title: string
  icon: React.ReactNode
  value: string
  subtitle: string
  percentage: number
  trend?: number
  color: string
  loading?: boolean
}) {
  const theme = useTheme()
  
  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Skeleton variant="text" width="60%" />
          <Skeleton variant="text" width="40%" height={40} />
          <Skeleton variant="rectangular" height={8} sx={{ mt: 2, borderRadius: 1 }} />
        </CardContent>
      </Card>
    )
  }
  
  return (
    <Card 
      variant="outlined" 
      sx={{ 
        height: '100%',
        transition: 'all 0.2s',
        '&:hover': { 
          borderColor: color,
          boxShadow: `0 0 0 1px ${alpha(color, 0.3)}`
        }
      }}
    >
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              {title}
            </Typography>
            <Typography variant="h4" fontWeight={700} sx={{ color }}>
              {value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          </Box>
          <Box 
            sx={{ 
              p: 1, 
              borderRadius: 2, 
              bgcolor: alpha(color, 0.1),
              color: color,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            {icon}
          </Box>
        </Stack>
        
        <Box sx={{ mt: 2 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Utilisation
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="caption" fontWeight={600}>
                {formatPct(percentage)}
              </Typography>
              {trend !== undefined && (
                <Chip
                  size="small"
                  icon={trend >= 0 ? <TrendingUpIcon sx={{ fontSize: 12 }} /> : <TrendingDownIcon sx={{ fontSize: 12 }} />}
                  label={`${trend >= 0 ? '+' : ''}${trend.toFixed(1)}%`}
                  sx={{ 
                    height: 18, 
                    fontSize: '0.65rem',
                    bgcolor: trend >= 0 ? alpha(COLORS.warning, 0.1) : alpha(COLORS.success, 0.1),
                    color: trend >= 0 ? COLORS.warning : COLORS.success,
                    '& .MuiChip-icon': { fontSize: 12 }
                  }}
                />
              )}
            </Stack>
          </Stack>
          <LinearProgress 
            variant="determinate" 
            value={Math.min(100, percentage)} 
            sx={{ 
              height: 6, 
              borderRadius: 1,
              bgcolor: alpha(color, 0.1),
              '& .MuiLinearProgress-bar': { 
                bgcolor: color,
                borderRadius: 1
              }
            }} 
          />
        </Box>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Efficiency Score Component                                          */
/* ------------------------------------------------------------------ */

function EfficiencyScore({ score, loading }: { score: number; loading?: boolean }) {
  const theme = useTheme()
  
  const getColor = (s: number) => {
    if (s >= 80) return COLORS.success
    if (s >= 60) return COLORS.warning
    
return COLORS.error
  }
  
  const getLabel = (s: number) => {
    if (s >= 80) return 'Excellent'
    if (s >= 60) return 'Bon'
    if (s >= 40) return 'À améliorer'
    
return 'Critique'
  }
  
  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <Skeleton variant="circular" width={120} height={120} />
          <Skeleton variant="text" width="60%" sx={{ mt: 2 }} />
        </CardContent>
      </Card>
    )
  }
  
  const color = getColor(score)
  
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', py: 3 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Score d'efficacité
        </Typography>
        
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          <CircularProgress
            variant="determinate"
            value={100}
            size={120}
            thickness={4}
            sx={{ color: alpha(color, 0.1) }}
          />
          <CircularProgress
            variant="determinate"
            value={score}
            size={120}
            thickness={4}
            sx={{ 
              color: color,
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
              flexDirection: 'column'
            }}
          >
            <Typography variant="h3" fontWeight={700} sx={{ color }}>
              {score}
            </Typography>
          </Box>
        </Box>
        
        <Chip 
          label={getLabel(score)} 
          sx={{ 
            mt: 2, 
            bgcolor: alpha(color, 0.1), 
            color: color,
            fontWeight: 600
          }} 
        />
        
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, textAlign: 'center' }}>
          Basé sur l'utilisation CPU, RAM et stockage
        </Typography>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* AI Analysis Component                                               */
/* ------------------------------------------------------------------ */

function AiAnalysisCard({ 
  analysis, 
  onAnalyze 
}: { 
  analysis: AiAnalysis
  onAnalyze: () => void 
}) {
  const theme = useTheme()
  
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'high': return COLORS.error
      case 'medium': return COLORS.warning
      case 'low': return COLORS.info
      default: return COLORS.success
    }
  }
  
  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'high': return <WarningAmberIcon sx={{ fontSize: 18 }} />
      case 'medium': return <WarningAmberIcon sx={{ fontSize: 18 }} />
      case 'low': return <CheckCircleIcon sx={{ fontSize: 18 }} />
      default: return <CheckCircleIcon sx={{ fontSize: 18 }} />
    }
  }
  
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <AutoFixHighIcon sx={{ color: COLORS.info }} />
            <Typography variant="h6" fontWeight={700}>
              Analyse IA
            </Typography>
          </Stack>
          <Button
            variant="outlined"
            size="small"
            startIcon={analysis.loading ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
            onClick={onAnalyze}
            disabled={analysis.loading}
          >
            {analysis.loading ? 'Analyse...' : 'Analyser'}
          </Button>
        </Stack>
        
        {analysis.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {analysis.error}
          </Alert>
        )}
        
        {analysis.summary && (
          <Paper 
            sx={{ 
              p: 2, 
              mb: 2, 
              bgcolor: alpha(COLORS.info, 0.05),
              border: '1px solid',
              borderColor: alpha(COLORS.info, 0.2)
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
              {analysis.summary}
            </Typography>
          </Paper>
        )}
        
        {analysis.recommendations.length > 0 && (
          <Stack spacing={1.5}>
            <Typography variant="subtitle2" fontWeight={600}>
              Recommandations ({analysis.recommendations.length})
            </Typography>
            
            {analysis.recommendations.map((rec) => (
              <Paper
                key={rec.id}
                sx={{
                  p: 1.5,
                  border: '1px solid',
                  borderColor: alpha(getSeverityColor(rec.severity), 0.3),
                  bgcolor: alpha(getSeverityColor(rec.severity), 0.02),
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <Box sx={{ color: getSeverityColor(rec.severity), mt: 0.25 }}>
                    {getSeverityIcon(rec.severity)}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="subtitle2" fontWeight={600}>
                        {rec.title}
                      </Typography>
                      {rec.savings && (
                        <Chip 
                          size="small" 
                          label={rec.savings} 
                          sx={{ 
                            height: 18, 
                            fontSize: '0.65rem',
                            bgcolor: alpha(COLORS.success, 0.1),
                            color: COLORS.success
                          }} 
                        />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {rec.description}
                    </Typography>
                  </Box>
                </Stack>
              </Paper>
            ))}
          </Stack>
        )}
        
        {!analysis.loading && !analysis.summary && analysis.recommendations.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4, opacity: 0.5 }}>
            <AutoFixHighIcon sx={{ fontSize: 48, mb: 1 }} />
            <Typography variant="body2">
              Cliquez sur "Analyser" pour obtenir des recommandations IA
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Top VMs Table                                                       */
/* ------------------------------------------------------------------ */

function TopVmsTable({ vms, loading, title, metric }: { 
  vms: TopVm[]
  loading?: boolean
  title: string
  metric: 'cpu' | 'ram'
}) {
  const theme = useTheme()
  const color = metric === 'cpu' ? COLORS.cpu : COLORS.ram
  
  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Skeleton variant="text" width="40%" sx={{ mb: 2 }} />
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} variant="rectangular" height={40} sx={{ mb: 1, borderRadius: 1 }} />
          ))}
        </CardContent>
      </Card>
    )
  }
  
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
          {title}
        </Typography>
        
        <Stack spacing={1}>
          {vms.slice(0, 5).map((vm, index) => {
            const value = metric === 'cpu' ? vm.cpu : vm.ram
            const allocated = metric === 'cpu' ? vm.cpuAllocated : vm.ramAllocated
            
            return (
              <Box key={vm.id}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        width: 20, 
                        height: 20, 
                        borderRadius: '50%', 
                        bgcolor: alpha(color, 0.1),
                        color: color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 600
                      }}
                    >
                      {index + 1}
                    </Typography>
                    <Typography variant="body2" fontWeight={500}>
                      {vm.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {vm.node}
                    </Typography>
                  </Stack>
                  <Typography variant="body2" fontWeight={600} sx={{ color }}>
                    {formatPct(value)}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, value)}
                  sx={{
                    height: 4,
                    borderRadius: 1,
                    bgcolor: alpha(color, 0.1),
                    '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 1 }
                  }}
                />
              </Box>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Main Page Component                                                 */
/* ------------------------------------------------------------------ */

export default function ResourcesPage() {
  const { setPageInfo } = usePageTitle()
  const theme = useTheme()
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpis, setKpis] = useState<KpiData | null>(null)
  const [trends, setTrends] = useState<ResourceTrend[]>([])
  const [topCpuVms, setTopCpuVms] = useState<TopVm[]>([])
  const [topRamVms, setTopRamVms] = useState<TopVm[]>([])

  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis>({
    summary: '',
    recommendations: [],
    loading: false
  })

  const [activeTab, setActiveTab] = useState(0)

  // Page title
  useEffect(() => {
    setPageInfo('Ressources', "Vue d'ensemble et optimisation", 'ri-pie-chart-fill')
    
return () => setPageInfo('', '', '')
  }, [setPageInfo])
  
  // Charger les données
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    try {
      const res = await fetch('/api/v1/resources/overview', { cache: 'no-store' })

      if (!res.ok) throw new Error('Erreur lors du chargement')
      
      const json = await res.json()
      const data = json.data
      
      setKpis(data.kpis)
      setTrends(data.trends || [])
      setTopCpuVms(data.topCpuVms || [])
      setTopRamVms(data.topRamVms || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])
  
  useEffect(() => {
    loadData()
  }, [loadData])
  
  // Analyse IA
  const runAiAnalysis = async () => {
    setAiAnalysis(prev => ({ ...prev, loading: true, error: undefined }))
    
    try {
      const res = await fetch('/api/v1/resources/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kpis, topCpuVms, topRamVms })
      })
      
      if (!res.ok) throw new Error('Erreur lors de l\'analyse')
      
      const json = await res.json()

      setAiAnalysis({
        summary: json.data?.summary || '',
        recommendations: json.data?.recommendations || [],
        loading: false
      })
    } catch (e: any) {
      setAiAnalysis(prev => ({
        ...prev,
        loading: false,
        error: e.message
      }))
    }
  }
  
  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>
            Ressources
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Vue d'ensemble et optimisation des ressources infrastructure
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={loadData}
          disabled={loading}
        >
          Actualiser
        </Button>
      </Stack>
      
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}
      
      {/* KPIs */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            title="CPU"
            icon={<SpeedIcon />}
            value={kpis ? formatPct(kpis.cpu.used) : '—'}
            subtitle={kpis ? `${kpis.cpu.allocated} vCPUs alloués` : ''}
            percentage={kpis?.cpu.used || 0}
            trend={kpis?.cpu.trend}
            color={COLORS.cpu}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            title="Mémoire"
            icon={<MemoryIcon />}
            value={kpis ? formatPct(kpis.ram.used) : '—'}
            subtitle={kpis ? `${formatBytes(kpis.ram.allocated)} alloués` : ''}
            percentage={kpis?.ram.used || 0}
            trend={kpis?.ram.trend}
            color={COLORS.ram}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <KpiCard
            title="Stockage"
            icon={<StorageIcon />}
            value={kpis ? formatPct((kpis.storage.used / kpis.storage.total) * 100) : '—'}
            subtitle={kpis ? `${formatBytes(kpis.storage.used)} / ${formatBytes(kpis.storage.total)}` : ''}
            percentage={kpis ? (kpis.storage.used / kpis.storage.total) * 100 : 0}
            trend={kpis?.storage.trend}
            color={COLORS.storage}
            loading={loading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          <EfficiencyScore score={kpis?.efficiency || 0} loading={loading} />
        </Grid>
      </Grid>
      
      {/* Charts & Analysis */}
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {/* Trends Chart */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                Évolution des ressources (7 derniers jours)
              </Typography>
              
              {loading ? (
                <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 1 }} />
              ) : trends.length > 0 ? (
                <Box sx={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trends}>
                      <defs>
                        <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.cpu} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={COLORS.cpu} stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="ramGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={COLORS.ram} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={COLORS.ram} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="t" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} />
                      <RTooltip 
                        contentStyle={{ 
                          background: theme.palette.background.paper, 
                          border: `1px solid ${theme.palette.divider}`,
                          borderRadius: 8
                        }}
                        formatter={(v: any) => [`${Number(v).toFixed(1)}%`]}
                      />
                      <Legend />
                      <Area
                        type="monotone"
                        dataKey="cpu"
                        name="CPU"
                        stroke={COLORS.cpu}
                        strokeWidth={2}
                        fill="url(#cpuGradient)"
                        dot={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="ram"
                        name="RAM"
                        stroke={COLORS.ram}
                        strokeWidth={2}
                        fill="url(#ramGradient)"
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </Box>
              ) : (
                <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5 }}>
                  <Typography>Aucune donnée disponible</Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        
        {/* VMs Stats */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>
                Machines virtuelles
              </Typography>
              
              {loading ? (
                <Skeleton variant="rectangular" height={280} sx={{ borderRadius: 1 }} />
              ) : kpis ? (
                <Box sx={{ width: '100%', height: 280, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Running', value: kpis.vms.running, color: COLORS.success },
                          { name: 'Stopped', value: kpis.vms.stopped, color: COLORS.error },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={2}
                        dataKey="value"
                      >
                        {[
                          { name: 'Running', value: kpis.vms.running, color: COLORS.success },
                          { name: 'Stopped', value: kpis.vms.stopped, color: COLORS.error },
                        ].map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <RTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <Stack direction="row" spacing={3} sx={{ mt: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: COLORS.success }} />
                      <Typography variant="body2">{kpis.vms.running} running</Typography>
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: COLORS.error }} />
                      <Typography variant="body2">{kpis.vms.stopped} stopped</Typography>
                    </Stack>
                  </Stack>
                  <Typography variant="h5" fontWeight={700} sx={{ mt: 1 }}>
                    {kpis.vms.total} VMs
                  </Typography>
                </Box>
              ) : null}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      
      {/* Top VMs & AI Analysis */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          <TopVmsTable 
            vms={topCpuVms} 
            loading={loading} 
            title="Top 5 CPU" 
            metric="cpu" 
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <TopVmsTable 
            vms={topRamVms} 
            loading={loading} 
            title="Top 5 RAM" 
            metric="ram" 
          />
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          <AiAnalysisCard analysis={aiAnalysis} onAnalyze={runAiAnalysis} />
        </Grid>
      </Grid>
    </Box>
  )
}
