'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

import { useTranslations } from 'next-intl'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'
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
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
// RemixIcon replacements for @mui/icons-material
const RefreshIcon = (props: any) => <i className="ri-refresh-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TrendingUpIcon = (props: any) => <i className="ri-arrow-up-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TrendingDownIcon = (props: any) => <i className="ri-arrow-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TrendingFlatIcon = (props: any) => <i className="ri-subtract-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const WarningAmberIcon = (props: any) => <i className="ri-alert-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CheckCircleIcon = (props: any) => <i className="ri-checkbox-circle-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ErrorIcon = (props: any) => <i className="ri-error-warning-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StorageIcon = (props: any) => <i className="ri-hard-drive-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MemoryIcon = (props: any) => <i className="ri-cpu-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const SpeedIcon = (props: any) => <i className="ri-speed-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const CloudIcon = (props: any) => <i className="ri-cloud-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const AccessTimeIcon = (props: any) => <i className="ri-time-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const InsightsIcon = (props: any) => <i className="ri-line-chart-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const PsychologyIcon = (props: any) => <i className="ri-brain-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const RocketLaunchIcon = (props: any) => <i className="ri-rocket-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ShieldIcon = (props: any) => <i className="ri-shield-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const BoltIcon = (props: any) => <i className="ri-flashlight-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const EnergySavingsLeafIcon = (props: any) => <i className="ri-leaf-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const Co2Icon = (props: any) => <i className="ri-cloud-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ElectricBoltIcon = (props: any) => <i className="ri-flashlight-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const ParkIcon = (props: any) => <i className="ri-plant-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const DirectionsCarIcon = (props: any) => <i className="ri-car-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const EuroIcon = (props: any) => <i className="ri-money-euro-circle-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const LayersIcon = (props: any) => <i className="ri-stack-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const TipsAndUpdatesIcon = (props: any) => <i className="ri-lightbulb-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const SavingsIcon = (props: any) => <i className="ri-funds-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
import {
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  PieChart,
  Pie,
  Cell,
  ReferenceLine,
  ComposedChart,
  Line,
  Area,
} from 'recharts'

import { usePageTitle } from "@/contexts/PageTitleContext"

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
  storage?: number
  cpuProjection?: number
  ramProjection?: number
  storageProjection?: number

  // Intervalles de confiance
  cpuMin?: number
  cpuMax?: number
  ramMin?: number
  ramMax?: number
  storageMin?: number
  storageMax?: number
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
  type: 'overprovisioned' | 'underused' | 'stopped' | 'snapshot' | 'orphan' | 'prediction' | 'optimization'
  severity: 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  savings?: string
  vmId?: string
  vmName?: string
}

type PredictiveAlert = {
  resource: 'cpu' | 'ram' | 'storage'
  currentValue: number
  predictedValue: number
  daysToThreshold: number | null
  threshold: number
  trend: 'up' | 'down' | 'stable'
  severity: 'critical' | 'warning' | 'ok'
  trendType?: 'stable' | 'linear' | 'accelerating' | 'decelerating'
  confidence?: number
}

type AiAnalysis = {
  summary: string
  recommendations: Recommendation[]
  loading: boolean
  error?: string
  provider?: string
}

type GreenMetrics = {
  power: {
    current: number
    max: number
    monthly: number
    yearly: number
  }
  co2: {
    hourly: number
    daily: number
    monthly: number
    yearly: number
    factor: number
    equivalentKmCar: number
    equivalentTrees: number
  }
  cost: {
    hourly: number
    daily: number
    monthly: number
    yearly: number
    pricePerKwh: number
  }
  efficiency: {
    pue: number
    vmPerKw: number
    score: number
  }
}

type OverprovisioningData = {
  cpu: {
    allocated: number
    used: number
    physical: number
    ratio: number
    efficiency: number
  }
  ram: {
    allocated: number
    used: number
    physical: number
    ratio: number
    efficiency: number
  }
  perNode: {
    name: string
    cpuRatio: number
    ramRatio: number
    cpuAllocated: number
    cpuPhysical: number
    ramAllocated: number
    ramPhysical: number
  }[]
  topOverprovisioned: {
    vmid: string
    name: string
    node: string
    cpuAllocated: number
    cpuUsedPct: number
    ramAllocatedGB: number
    ramUsedPct: number
    recommendedCpu: number
    recommendedRamGB: number
    potentialSavings: { cpu: number; ramGB: number }
  }[]
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

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
  primary: '#6366f1',
}

/* ------------------------------------------------------------------ */
/* Advanced Prediction Algorithm                                       */
/* ------------------------------------------------------------------ */

// Régression linéaire simple - plus stable pour les projections d'infrastructure
function linearRegression(data: number[]): { slope: number, intercept: number, predict: (x: number) => number } {
  const n = data.length

  if (n < 2) {
    const avg = data.length > 0 ? data[0] : 0

    
return { slope: 0, intercept: avg, predict: () => avg }
  }

  // Calculer les moyennes
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0

  for (let i = 0; i < n; i++) {
    sumX += i
    sumY += data[i]
    sumXY += i * data[i]
    sumX2 += i * i
  }

  const meanX = sumX / n
  const meanY = sumY / n

  // Pente et ordonnée à l'origine
  const slope = (sumXY - n * meanX * meanY) / (sumX2 - n * meanX * meanX || 1)
  const intercept = meanY - slope * meanX

  const predict = (x: number): number => {
    return Math.max(0, Math.min(100, intercept + slope * x))
  }

  return { slope, intercept, predict }
}

// Calculer l'écart-type pour les intervalles de confiance
function calculateStdDev(data: number[], predict: (x: number) => number): number {
  if (data.length < 2) return 0
  const residuals = data.map((val, i) => val - predict(i))
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length
  const variance = residuals.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / residuals.length

  
return Math.sqrt(variance)
}

// Détecter le type de tendance basé sur la pente
function detectTrendType(slope: number): 'stable' | 'linear' | 'accelerating' | 'decelerating' {
  if (Math.abs(slope) < 0.05) return 'stable'
  
return 'linear' // Avec régression linéaire, c'est toujours linéaire
}

function calculatePredictions(kpis: KpiData, trends: ResourceTrend[]): {
  projectedTrends: ResourceTrend[]
  alerts: PredictiveAlert[]
} {
  const alerts: PredictiveAlert[] = []
  const projectedTrends: ResourceTrend[] = [...trends]
  
  // Extraire les séries temporelles des données historiques
  const cpuHistory = trends.map(t => t.cpu).filter(v => v !== undefined && !isNaN(v))
  const ramHistory = trends.map(t => t.ram).filter(v => v !== undefined && !isNaN(v))
  const storageHistory = trends.map(t => t.storage).filter(v => v !== undefined && !isNaN(v))
  
  const currentStoragePct = kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0
  
  // Valeurs actuelles (dernière valeur de l'historique ou KPI)
  const lastCpu = cpuHistory.length > 0 ? cpuHistory[cpuHistory.length - 1] : kpis.cpu.used
  const lastRam = ramHistory.length > 0 ? ramHistory[ramHistory.length - 1] : kpis.ram.used
  const lastStorage = storageHistory.length > 0 ? storageHistory[storageHistory.length - 1] : currentStoragePct
  
  // Si pas assez d'historique, créer des données minimales
  if (cpuHistory.length < 2) {
    for (let i = cpuHistory.length; i < 2; i++) cpuHistory.unshift(lastCpu)
  }

  if (ramHistory.length < 2) {
    for (let i = ramHistory.length; i < 2; i++) ramHistory.unshift(lastRam)
  }

  if (storageHistory.length < 2) {
    for (let i = storageHistory.length; i < 2; i++) storageHistory.unshift(lastStorage)
  }
  
  // Appliquer la régression linéaire
  const cpuRegression = linearRegression(cpuHistory)
  const ramRegression = linearRegression(ramHistory)
  const storageRegression = linearRegression(storageHistory)
  
  // Calculer les écarts-types pour les intervalles de confiance
  const cpuStdDev = calculateStdDev(cpuHistory, cpuRegression.predict)
  const ramStdDev = calculateStdDev(ramHistory, ramRegression.predict)
  const storageStdDev = calculateStdDev(storageHistory, storageRegression.predict)
  
  // Détecter les types de tendance
  const cpuTrendType = detectTrendType(cpuRegression.slope)
  const ramTrendType = detectTrendType(ramRegression.slope)
  const storageTrendType = detectTrendType(storageRegression.slope)
  
  const historyLength = cpuHistory.length
  const lastDate = new Date()
  
  // Utiliser la pente de la régression linéaire
  // Pour les ressources qui ne peuvent que croître (RAM, Storage), 
  // on utilise au minimum une pente conservatrice basée sur un taux de croissance typique
  // Taux de croissance mensuel minimum estimé : 0.5% pour RAM, 1% pour storage
  const MIN_RAM_GROWTH_PER_DAY = 0.5 / 30  // ~0.017% par jour
  const MIN_STORAGE_GROWTH_PER_DAY = 1.0 / 30  // ~0.033% par jour
  
  const cpuSlope = cpuRegression.slope


  // Pour RAM et Storage : utiliser la pente calculée si positive, sinon un minimum de croissance
  const ramSlope = ramRegression.slope > MIN_RAM_GROWTH_PER_DAY 
    ? ramRegression.slope 
    : MIN_RAM_GROWTH_PER_DAY

  const storageSlope = storageRegression.slope > MIN_STORAGE_GROWTH_PER_DAY 
    ? storageRegression.slope 
    : MIN_STORAGE_GROWTH_PER_DAY
  
  // Ajouter les valeurs de projection au dernier point historique pour la continuité des lignes
  if (projectedTrends.length > 0) {
    const lastIndex = projectedTrends.length - 1
    projectedTrends[lastIndex] = {
      ...projectedTrends[lastIndex],
      cpuProjection: lastCpu,
      ramProjection: lastRam,
      storageProjection: lastStorage,
    }
  }
  
  // Générer les projections sur 30 jours EN PARTANT DE LA DERNIÈRE VALEUR RÉELLE
  for (let i = 1; i <= 30; i++) {
    const date = new Date(lastDate)

    date.setDate(date.getDate() + i)
    
    // Projection linéaire simple
    let projectedCpu = lastCpu + cpuSlope * i
    let projectedRam = lastRam + ramSlope * i
    let projectedStorage = lastStorage + storageSlope * i
    
    // Limiter entre 0 et 100
    projectedCpu = Math.max(0, Math.min(100, projectedCpu))
    projectedRam = Math.max(0, Math.min(100, projectedRam))
    projectedStorage = Math.max(0, Math.min(100, projectedStorage))
    
    // Intervalles de confiance (±1 écart-type, élargi avec le temps)
    const confidenceFactor = 1 + (i / 30) * 1.5 // L'incertitude augmente avec le temps
    
    projectedTrends.push({
      t: date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
      // Ne PAS inclure cpu, ram, storage ici pour éviter que les Area ne recouvrent les pointillés
      cpu: undefined as any,
      ram: undefined as any,
      storage: undefined as any,
      // Seules les projections ont des valeurs dans la zone future
      cpuProjection: projectedCpu,
      ramProjection: projectedRam,
      storageProjection: projectedStorage,

      // Intervalles de confiance
      cpuMin: Math.max(0, projectedCpu - cpuStdDev * confidenceFactor),
      cpuMax: Math.min(100, projectedCpu + cpuStdDev * confidenceFactor),
      ramMin: Math.max(0, projectedRam - ramStdDev * confidenceFactor),
      ramMax: Math.min(100, projectedRam + ramStdDev * confidenceFactor),
      storageMin: Math.max(0, projectedStorage - storageStdDev * confidenceFactor),
      storageMax: Math.min(100, projectedStorage + storageStdDev * confidenceFactor),
    } as ResourceTrend)
  }
  
  const threshold = 90
  
  // Fonction de prédiction linéaire pour trouver le seuil
  const predictLinear = (last: number, slope: number) => (day: number): number => {
    return Math.max(0, Math.min(100, last + slope * day))
  }
  
  // CPU Alert
  const cpuPredicted30 = predictLinear(lastCpu, cpuSlope)(30)
  const cpuDaysTo90 = findThresholdDayLinear(lastCpu, cpuSlope, threshold)
  const cpuTrendDirection = cpuSlope > 0.05 ? 'up' : cpuSlope < -0.05 ? 'down' : 'stable'
  
  alerts.push({
    resource: 'cpu',
    currentValue: lastCpu,
    predictedValue: cpuPredicted30,
    daysToThreshold: cpuDaysTo90,
    threshold,
    trend: cpuTrendDirection,
    severity: cpuDaysTo90 && cpuDaysTo90 <= 14 ? 'critical' : cpuDaysTo90 && cpuDaysTo90 <= 30 ? 'warning' : 'ok',
    trendType: cpuTrendType,
    confidence: Math.max(0, 100 - cpuStdDev * 3),
  } as PredictiveAlert)
  
  // RAM Alert
  const ramPredicted30 = predictLinear(lastRam, ramSlope)(30)
  const ramDaysTo90 = findThresholdDayLinear(lastRam, ramSlope, threshold)
  const ramTrendDirection = ramSlope > 0.05 ? 'up' : ramSlope < -0.05 ? 'down' : 'stable'
  
  alerts.push({
    resource: 'ram',
    currentValue: lastRam,
    predictedValue: ramPredicted30,
    daysToThreshold: ramDaysTo90,
    threshold,
    trend: ramTrendDirection,
    severity: ramDaysTo90 && ramDaysTo90 <= 14 ? 'critical' : ramDaysTo90 && ramDaysTo90 <= 30 ? 'warning' : 'ok',
    trendType: ramTrendType,
    confidence: Math.max(0, 100 - ramStdDev * 3),
  } as PredictiveAlert)
  
  // Storage Alert
  const storagePredicted30 = predictLinear(lastStorage, storageSlope)(30)
  const storageDaysTo90 = findThresholdDayLinear(lastStorage, storageSlope, threshold)
  const storageTrendDirection = storageSlope > 0.05 ? 'up' : storageSlope < -0.05 ? 'down' : 'stable'
  
  alerts.push({
    resource: 'storage',
    currentValue: lastStorage,
    predictedValue: storagePredicted30,
    daysToThreshold: storageDaysTo90,
    threshold,
    trend: storageTrendDirection,
    severity: storageDaysTo90 && storageDaysTo90 <= 14 ? 'critical' : storageDaysTo90 && storageDaysTo90 <= 30 ? 'warning' : 'ok',
    trendType: storageTrendType,
    confidence: Math.max(0, 100 - storageStdDev * 3),
  } as PredictiveAlert)
  
  return { projectedTrends, alerts }
}

// Trouver quand on atteint un seuil avec la projection linéaire
function findThresholdDayLinear(currentValue: number, slope: number, threshold: number, maxDays: number = 180): number | null {
  if (slope <= 0) return null // Si la pente est négative ou nulle, on n'atteindra jamais le seuil
  if (currentValue >= threshold) return 0 // Déjà au-dessus du seuil
  
  const daysToThreshold = (threshold - currentValue) / slope
  
  if (daysToThreshold > 0 && daysToThreshold <= maxDays) {
    return Math.ceil(daysToThreshold)
  }

  
return null
}

function calculateHealthScore(kpis: KpiData, alerts: PredictiveAlert[]): number {
  let score = 100

  // ===== CPU (max -20 points) =====
  // Pénalité pour surcharge
  if (kpis.cpu.used > 90) score -= 20
  else if (kpis.cpu.used > 80) score -= 15
  else if (kpis.cpu.used > 70) score -= 8
  else if (kpis.cpu.used > 60) score -= 4

  // Zone optimale : 20-60% (pas de pénalité)
  // Pénalité pour sous-utilisation excessive (gaspillage de ressources)
  else if (kpis.cpu.used < 5) score -= 5
  else if (kpis.cpu.used < 10) score -= 2

  // ===== RAM (max -25 points) =====
  // Pénalité pour surcharge
  if (kpis.ram.used > 90) score -= 25
  else if (kpis.ram.used > 85) score -= 18
  else if (kpis.ram.used > 80) score -= 12
  else if (kpis.ram.used > 75) score -= 6

  // Zone optimale : 40-75% (pas de pénalité)
  // Pénalité pour sous-utilisation (ressources gaspillées)
  else if (kpis.ram.used < 20) score -= 8
  else if (kpis.ram.used < 30) score -= 4

  // ===== Storage (max -25 points) =====
  const storagePct = kpis.storage.total > 0 ? (kpis.storage.used / kpis.storage.total) * 100 : 0

  if (storagePct > 95) score -= 25
  else if (storagePct > 90) score -= 20
  else if (storagePct > 85) score -= 15
  else if (storagePct > 80) score -= 10
  else if (storagePct > 75) score -= 5

  // Zone optimale : 30-75%
  // Sous-utilisation du stockage est moins problématique (réserve de capacité)

  // ===== Alertes prédictives (max -30 points) =====
  let alertPenalty = 0

  alerts.forEach(alert => {
    if (alert.severity === 'critical') alertPenalty += 12
    else if (alert.severity === 'warning') alertPenalty += 5
  })
  score -= Math.min(30, alertPenalty) // Plafonner à -30

  // ===== Efficacité (max -15 / +5 points) =====
  // L'efficacité mesure le ratio utilisation réelle vs allocation
  if (kpis.efficiency >= 80) score += 5  // Excellent
  else if (kpis.efficiency >= 70) score += 2  // Très bien
  else if (kpis.efficiency < 30) score -= 15  // Très mauvais (sur-provisionnement massif)
  else if (kpis.efficiency < 40) score -= 10  // Mauvais
  else if (kpis.efficiency < 50) score -= 5   // À améliorer

  // ===== VMs arrêtées (max -10 points) =====
  const stoppedRatio = kpis.vms.total > 0 ? kpis.vms.stopped / kpis.vms.total : 0

  if (stoppedRatio > 0.4) score -= 10  // Plus de 40% arrêtées
  else if (stoppedRatio > 0.3) score -= 7
  else if (stoppedRatio > 0.25) score -= 4
  else if (stoppedRatio > 0.2) score -= 2

  return Math.max(0, Math.min(100, Math.round(score)))
}

/* ------------------------------------------------------------------ */
/* Global Health Score Component                                       */
/* ------------------------------------------------------------------ */

function GlobalHealthScore({ score, kpis, alerts, loading }: {
  score: number
  kpis: KpiData | null
  alerts: PredictiveAlert[]
  loading?: boolean
}) {
  const theme = useTheme()
  const t = useTranslations()

  const getScoreColor = (s: number) => {
    if (s >= 80) return COLORS.success
    if (s >= 60) return COLORS.warning
    if (s >= 40) return '#f97316'
    
return COLORS.error
  }

  const getScoreLabel = (s: number) => {
    if (s >= 80) return 'Excellent'
    if (s >= 60) return 'Bon'
    if (s >= 40) return 'À surveiller'
    
return 'Critique'
  }

  const getScoreIcon = (s: number) => {
    if (s >= 80) return <ShieldIcon sx={{ fontSize: 32 }} />
    if (s >= 60) return <CheckCircleIcon sx={{ fontSize: 32 }} />
    if (s >= 40) return <WarningAmberIcon sx={{ fontSize: 32 }} />
    
return <ErrorIcon sx={{ fontSize: 32 }} />
  }

  const criticalAlerts = alerts.filter(a => a.severity === 'critical').length
  const warningAlerts = alerts.filter(a => a.severity === 'warning').length

  if (loading) {
    return (
      <Card sx={{ background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.1)} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: 3 }}>
          <Stack direction="row" spacing={4} alignItems="center">
            <Skeleton variant="circular" width={140} height={140} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="text" width="60%" height={40} />
              <Skeleton variant="text" width="80%" />
            </Box>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  const color = getScoreColor(score)

  return (
    <Card sx={{
      background: `linear-gradient(135deg, ${alpha(color, 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 50%, ${alpha(color, 0.03)} 100%)`,
      border: '1px solid',
      borderColor: alpha(color, 0.3),
      position: 'relative',
      overflow: 'hidden',
      '&:hover': { borderColor: alpha(color, 0.5), boxShadow: `0 8px 32px ${alpha(color, 0.15)}` },
    }}>
      <Box sx={{ position: 'absolute', top: -50, right: -50, width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${alpha(color, 0.1)} 0%, transparent 70%)` }} />
      <CardContent sx={{ p: 3, position: 'relative' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={4} alignItems="center">
          <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <CircularProgress variant="determinate" value={100} size={160} thickness={3} sx={{ color: alpha(color, 0.15) }} />
            <CircularProgress variant="determinate" value={score} size={160} thickness={3} sx={{ color, position: 'absolute', left: 0, filter: `drop-shadow(0 0 8px ${alpha(color, 0.4)})` }} />
            <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <Typography variant="h2" fontWeight={800} sx={{ color, lineHeight: 1 }}>{score}</Typography>
              <Typography variant="caption" color="text.secondary">/100</Typography>
            </Box>
          </Box>

          <Box sx={{ flex: 1 }}>
            <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1 }}>
              <Box sx={{ color }}>{getScoreIcon(score)}</Box>
              <Typography variant="h4" fontWeight={700}>{t('resources.infrastructureHealth')}</Typography>
            </Stack>
            <Chip label={getScoreLabel(score)} sx={{ bgcolor: alpha(color, 0.15), color, fontWeight: 700, fontSize: '0.9rem', height: 32, mb: 2 }} />
            <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.activeVms')}</Typography>
                <Typography variant="h6" fontWeight={700}>{kpis?.vms.running || 0}<Typography component="span" variant="body2" color="text.secondary"> / {kpis?.vms.total || 0}</Typography></Typography>
              </Box>
              <Divider orientation="vertical" flexItem />
              <Box>
                <Typography variant="caption" color="text.secondary">{t('resources.efficiency')}</Typography>
                <Typography variant="h6" fontWeight={700}>{kpis?.efficiency || 0}%</Typography>
              </Box>
              <Divider orientation="vertical" flexItem />
              <Box>
                <Typography variant="caption" color="text.secondary">Alertes</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  {criticalAlerts > 0 && <Chip size="small" label={criticalAlerts} sx={{ bgcolor: alpha(COLORS.error, 0.15), color: COLORS.error, fontWeight: 700 }} />}
                  {warningAlerts > 0 && <Chip size="small" label={warningAlerts} sx={{ bgcolor: alpha(COLORS.warning, 0.15), color: COLORS.warning, fontWeight: 700 }} />}
                  {criticalAlerts === 0 && warningAlerts === 0 && <Typography variant="h6" fontWeight={700} sx={{ color: COLORS.success }}>0</Typography>}
                </Stack>
              </Box>
            </Stack>
          </Box>

          <Stack spacing={1.5} sx={{ minWidth: 200 }}>
            {[
              { label: 'CPU', value: kpis?.cpu.used || 0, color: COLORS.cpu },
              { label: 'RAM', value: kpis?.ram.used || 0, color: COLORS.ram },
              { label: 'Stockage', value: kpis ? (kpis.storage.used / kpis.storage.total) * 100 : 0, color: COLORS.storage },
            ].map(item => (
              <Box key={item.label}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">{item.label}</Typography>
                  <Typography variant="caption" fontWeight={600}>{formatPct(item.value)}</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={Math.min(100, item.value)} sx={{ height: 6, borderRadius: 1, bgcolor: alpha(item.color, 0.1), '& .MuiLinearProgress-bar': { bgcolor: item.color, borderRadius: 1 } }} />
              </Box>
            ))}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Predictive Alerts Component                                         */
/* ------------------------------------------------------------------ */

function PredictiveAlertsCard({ alerts, loading }: { alerts: PredictiveAlert[]; loading?: boolean }) {
  const t = useTranslations()

  const getResourceIcon = (resource: string) => {
    switch (resource) {
      case 'cpu': return <SpeedIcon sx={{ fontSize: 20 }} />
      case 'ram': return <MemoryIcon sx={{ fontSize: 20 }} />
      case 'storage': return <StorageIcon sx={{ fontSize: 20 }} />
      default: return <CloudIcon sx={{ fontSize: 20 }} />
    }
  }

  const getResourceLabel = (resource: string) => {
    switch (resource) {
      case 'cpu': return 'CPU'
      case 'ram': return t('monitoring.memory')
      case 'storage': return t('storage.title')
      default: return resource
    }
  }

  const getResourceColor = (resource: string) => {
    switch (resource) {
      case 'cpu': return COLORS.cpu
      case 'ram': return COLORS.ram
      case 'storage': return COLORS.storage
      default: return COLORS.info
    }
  }

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return COLORS.error
      case 'warning': return COLORS.warning
      default: return COLORS.success
    }
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <TrendingUpIcon sx={{ fontSize: 16 }} />
      case 'down': return <TrendingDownIcon sx={{ fontSize: 16 }} />
      default: return <TrendingFlatIcon sx={{ fontSize: 16 }} />
    }
  }

  const getTrendTypeLabel = (trendType?: string) => {
    switch (trendType) {
      case 'accelerating': return `📈 ${t('resources.accelerating')}`
      case 'decelerating': return `📉 ${t('resources.decelerating')}`
      case 'linear': return `📊 ${t('resources.linear')}`
      case 'stable': return `➡️ ${t('resources.stable')}`
      default: return null
    }
  }

  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Skeleton variant="text" width="50%" height={32} sx={{ mb: 2 }} />
          <Stack spacing={1.5} sx={{ flex: 1 }}>
            {[1, 2, 3].map(i => <Skeleton key={i} variant="rectangular" sx={{ flex: 1, minHeight: 70, borderRadius: 2 }} />)}
          </Stack>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card variant="outlined" sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2.5 }}>
          <AccessTimeIcon sx={{ color: COLORS.primary }} />
          <Typography variant="h6" fontWeight={700}>{t('resources.capacityForecasts')}</Typography>
          <Chip size="small" label={t('resources.polynomialRegression')} sx={{ ml: 'auto', height: 20, fontSize: '0.6rem', bgcolor: alpha(COLORS.primary, 0.1), color: COLORS.primary }} />
        </Stack>
        <Stack spacing={1.5} sx={{ flex: 1 }}>
          {alerts.map(alert => {
            const resourceColor = getResourceColor(alert.resource)
            const severityColor = getSeverityColor(alert.severity)
            const trendTypeLabel = getTrendTypeLabel(alert.trendType)
            
            return (
              <Paper key={alert.resource} sx={{ flex: 1, p: 2, bgcolor: alpha(severityColor, 0.04), border: '1px solid', borderColor: alpha(severityColor, 0.2), borderRadius: 2, '&:hover': { bgcolor: alpha(severityColor, 0.08) }, display: 'flex', alignItems: 'center' }}>
                <Stack direction="row" spacing={2} alignItems="center" sx={{ width: '100%' }}>
                  <Box sx={{ p: 1, borderRadius: 1.5, bgcolor: alpha(resourceColor, 0.1), color: resourceColor, display: 'flex' }}>{getResourceIcon(alert.resource)}</Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                      <Typography variant="subtitle2" fontWeight={700}>{getResourceLabel(alert.resource)}</Typography>
                      <Chip size="small" icon={getTrendIcon(alert.trend)} label={`${alert.trend === 'up' ? '+' : alert.trend === 'down' ? '-' : ''}${Math.abs(alert.predictedValue - alert.currentValue).toFixed(1)}%`} sx={{ height: 20, fontSize: '0.7rem', bgcolor: alpha(alert.trend === 'up' ? COLORS.warning : alert.trend === 'down' ? COLORS.success : COLORS.info, 0.1), color: alert.trend === 'up' ? COLORS.warning : alert.trend === 'down' ? COLORS.success : COLORS.info, '& .MuiChip-icon': { fontSize: 14 } }} />
                      {trendTypeLabel && (
                        <Typography variant="caption" sx={{ opacity: 0.6, fontSize: '0.65rem' }}>{trendTypeLabel}</Typography>
                      )}
                    </Stack>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="body2" color="text.secondary">
                        {formatPct(alert.currentValue)} → {formatPct(alert.predictedValue)} 
                        <Typography component="span" variant="caption" sx={{ opacity: 0.7 }}> (30j)</Typography>
                      </Typography>
                      {alert.confidence !== undefined && (
                        <Chip 
                          size="small" 
                          label={`${Math.round(alert.confidence)}% conf.`} 
                          sx={{ 
                            height: 16, 
                            fontSize: '0.55rem', 
                            bgcolor: alpha(alert.confidence > 70 ? COLORS.success : alert.confidence > 40 ? COLORS.warning : COLORS.error, 0.1),
                            color: alert.confidence > 70 ? COLORS.success : alert.confidence > 40 ? COLORS.warning : COLORS.error,
                          }} 
                        />
                      )}
                    </Stack>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    {alert.daysToThreshold ? (
                      <>
                        <Typography variant="h6" fontWeight={700} sx={{ color: severityColor, lineHeight: 1 }}>{alert.daysToThreshold}j</Typography>
                        <Typography variant="caption" color="text.secondary">avant {alert.threshold}%</Typography>
                      </>
                    ) : (
                      <>
                        <CheckCircleIcon sx={{ color: COLORS.success, fontSize: 24 }} />
                        <Typography variant="caption" color="text.secondary" display="block">OK</Typography>
                      </>
                    )}
                  </Box>
                </Stack>
              </Paper>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* AI Insights Component                                               */
/* ------------------------------------------------------------------ */

function AiInsightsCard({ analysis, onAnalyze, loading }: { analysis: AiAnalysis; onAnalyze: () => void; loading?: boolean }) {
  const theme = useTheme()
  const t = useTranslations()

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
      case 'high': return <ErrorIcon sx={{ fontSize: 18 }} />
      case 'medium': return <WarningAmberIcon sx={{ fontSize: 18 }} />
      case 'low': return <InsightsIcon sx={{ fontSize: 18 }} />
      default: return <CheckCircleIcon sx={{ fontSize: 18 }} />
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'prediction': return '🔮'
      case 'optimization': return '⚡'
      case 'overprovisioned': return '📦'
      case 'underused': return '💤'
      case 'stopped': return '⏹️'
      default: return '💡'
    }
  }

  return (
    <Card sx={{ height: '100%', background: `linear-gradient(180deg, ${alpha(COLORS.primary, 0.03)} 0%, transparent 100%)`, border: '1px solid', borderColor: alpha(COLORS.primary, 0.2) }}>
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha(COLORS.primary, 0.1), color: COLORS.primary, display: 'flex' }}><PsychologyIcon /></Box>
            <Box>
              <Typography variant="h6" fontWeight={700}>Intelligence IA</Typography>
              {analysis.provider && <Typography variant="caption" color="text.secondary">{t('resources.poweredBy', { provider: analysis.provider === 'ollama' ? t('resources.ollamaLocal') : t('resources.basicAnalysis') })}</Typography>}
            </Box>
          </Stack>
          <Button variant={analysis.summary ? 'outlined' : 'contained'} size="small" startIcon={analysis.loading ? <CircularProgress size={16} color="inherit" /> : <BoltIcon />} onClick={onAnalyze} disabled={analysis.loading || loading} sx={{ borderRadius: 2, textTransform: 'none', fontWeight: 600 }}>
            {analysis.loading ? 'Analyse...' : analysis.summary ? 'Actualiser' : 'Analyser'}
          </Button>
        </Stack>

        {analysis.error && <Alert severity="error" sx={{ mb: 2 }}>{analysis.error}</Alert>}

        {analysis.summary && (
          <Paper sx={{ p: 2.5, mb: 2.5, bgcolor: alpha(COLORS.primary, 0.04), border: '1px solid', borderColor: alpha(COLORS.primary, 0.15), borderRadius: 2 }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <RocketLaunchIcon sx={{ color: COLORS.primary, fontSize: 20, mt: 0.25 }} />
              <Typography variant="body2" sx={{ lineHeight: 1.7 }}>{analysis.summary}</Typography>
            </Stack>
          </Paper>
        )}

        {analysis.recommendations.length > 0 && (
          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1.5 }}>Recommandations ({analysis.recommendations.length})</Typography>
            <Stack spacing={1.5}>
              {analysis.recommendations.slice(0, 5).map(rec => {
                const severityColor = getSeverityColor(rec.severity)

                
return (
                  <Paper key={rec.id} sx={{ p: 2, border: '1px solid', borderColor: alpha(severityColor, 0.25), bgcolor: alpha(severityColor, 0.03), borderRadius: 2, '&:hover': { bgcolor: alpha(severityColor, 0.06), transform: 'translateX(4px)' }, transition: 'all 0.2s' }}>
                    <Stack direction="row" spacing={1.5} alignItems="flex-start">
                      <Typography sx={{ fontSize: 18 }}>{getTypeIcon(rec.type)}</Typography>
                      <Box sx={{ flex: 1 }}>
                        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                          <Typography variant="subtitle2" fontWeight={700}>{rec.title}</Typography>
                          {rec.savings && <Chip size="small" label={rec.savings} sx={{ height: 18, fontSize: '0.65rem', bgcolor: alpha(COLORS.success, 0.1), color: COLORS.success, fontWeight: 600 }} />}
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.5 }}>{rec.description}</Typography>
                        {rec.vmName && <Chip size="small" label={rec.vmName} sx={{ mt: 1, height: 20, fontSize: '0.7rem' }} />}
                      </Box>
                      <Box sx={{ color: severityColor }}>{getSeverityIcon(rec.severity)}</Box>
                    </Stack>
                  </Paper>
                )
              })}
            </Stack>
          </Box>
        )}

        {!analysis.loading && !analysis.summary && analysis.recommendations.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <PsychologyIcon sx={{ fontSize: 64, color: alpha(COLORS.primary, 0.2), mb: 2 }} />
            <Typography variant="body1" fontWeight={600} sx={{ mb: 1 }}>Analysez votre infrastructure</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 300, mx: 'auto' }}>{t('resources.aiWillAnalyze')}</Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Projection Chart Component                                          */
/* ------------------------------------------------------------------ */

function ProjectionChart({ data, loading, period }: { data: ResourceTrend[]; loading?: boolean; period?: { start: string | null, end: string | null, daysCount: number } | null }) {
  const theme = useTheme()
  const [selectedResource, setSelectedResource] = useState<'all' | 'cpu' | 'ram' | 'storage'>('all')

  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Skeleton variant="text" width="50%" height={32} sx={{ mb: 2 }} />
          <Skeleton variant="rectangular" height={300} sx={{ borderRadius: 2 }} />
        </CardContent>
      </Card>
    )
  }

  const historicalCount = Math.max(0, data.length - 30)
  
  // Séparer les données historiques des projections pour un affichage distinct
  const historicalData = data.slice(0, historicalCount + 1) // +1 pour inclure le point de jonction
  const projectionData = data.slice(historicalCount) // Commence au dernier point historique pour continuité
  
  // Formater la période pour l'affichage
  const formatPeriod = () => {
    if (!period || !period.start || !period.end) return ''
    const startDate = new Date(period.start)
    const endDate = new Date(period.end)
    const formatOptions: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }

    
return `${startDate.toLocaleDateString('fr-FR', formatOptions)} → ${endDate.toLocaleDateString('fr-FR', formatOptions)}`
  }

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <InsightsIcon sx={{ color: COLORS.primary }} />
            <Typography variant="h6" fontWeight={700}>
              Évolution & Projections
              {period && period.start && (
                <Typography component="span" variant="body2" sx={{ ml: 1, color: 'text.secondary', fontWeight: 400 }}>
                  ({formatPeriod()})
                </Typography>
              )}
            </Typography>
          </Stack>
          <ToggleButtonGroup value={selectedResource} exclusive onChange={(_, v) => v && setSelectedResource(v)} size="small">
            <ToggleButton value="all" sx={{ px: 1.5, py: 0.5, textTransform: 'none' }}>Tout</ToggleButton>
            <ToggleButton value="cpu" sx={{ px: 1.5, py: 0.5, textTransform: 'none' }}>CPU</ToggleButton>
            <ToggleButton value="ram" sx={{ px: 1.5, py: 0.5, textTransform: 'none' }}>RAM</ToggleButton>
            <ToggleButton value="storage" sx={{ px: 1.5, py: 0.5, textTransform: 'none' }}>Stockage</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        <Box sx={{ width: '100%', height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data}>
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.cpu} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={COLORS.cpu} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ramGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.ram} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={COLORS.ram} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="storageGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.storage} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={COLORS.storage} stopOpacity={0} />
                </linearGradient>
                {/* Gradients plus légers pour les projections */}
                <linearGradient id="cpuGradProjection" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.cpu} stopOpacity={0.08} />
                  <stop offset="95%" stopColor={COLORS.cpu} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ramGradProjection" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.ram} stopOpacity={0.08} />
                  <stop offset="95%" stopColor={COLORS.ram} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="storageGradProjection" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={COLORS.storage} stopOpacity={0.08} />
                  <stop offset="95%" stopColor={COLORS.storage} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: theme.palette.divider }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={v => `${v}%`} tickLine={false} axisLine={{ stroke: theme.palette.divider }} />
              <RTooltip contentStyle={{ background: theme.palette.background.paper, border: `1px solid ${theme.palette.divider}`, borderRadius: 8 }} formatter={(v: any, name: string) => [`${Number(v).toFixed(1)}%`, name]} />
              <ReferenceLine y={90} stroke={COLORS.error} strokeDasharray="5 5" strokeOpacity={0.5} />
              {historicalCount > 0 && <ReferenceLine x={data[historicalCount - 1]?.t} stroke={theme.palette.divider} strokeDasharray="3 3" label={{ value: 'Projection →', position: 'top', fontSize: 10, fill: theme.palette.text.secondary }} />}

              {(selectedResource === 'all' || selectedResource === 'cpu') && (
                <>
                  {/* Données historiques CPU - trait plein */}
                  <Area type="monotone" dataKey="cpu" name="CPU" stroke={COLORS.cpu} strokeWidth={2} fill="url(#cpuGrad)" dot={false} />
                  {/* Projection CPU - pointillés */}
                  <Line type="monotone" dataKey="cpuProjection" name="CPU (projection)" stroke={COLORS.cpu} strokeWidth={2} strokeDasharray="6 4" dot={false} opacity={0.8} />
                </>
              )}
              {(selectedResource === 'all' || selectedResource === 'ram') && (
                <>
                  {/* Données historiques RAM - trait plein */}
                  <Area type="monotone" dataKey="ram" name="RAM" stroke={COLORS.ram} strokeWidth={2} fill="url(#ramGrad)" dot={false} />
                  {/* Projection RAM - pointillés */}
                  <Line type="monotone" dataKey="ramProjection" name="RAM (projection)" stroke={COLORS.ram} strokeWidth={2} strokeDasharray="6 4" dot={false} opacity={0.8} />
                </>
              )}
              {(selectedResource === 'all' || selectedResource === 'storage') && (
                <>
                  {/* Données historiques Stockage - trait plein */}
                  <Area type="monotone" dataKey="storage" name="Stockage" stroke={COLORS.storage} strokeWidth={2} fill="url(#storageGrad)" dot={false} />
                  {/* Projection Stockage - pointillés */}
                  <Line type="monotone" dataKey="storageProjection" name="Stockage (projection)" stroke={COLORS.storage} strokeWidth={2} strokeDasharray="6 4" dot={false} opacity={0.8} />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </Box>

        <Stack direction="row" spacing={3} justifyContent="center" sx={{ mt: 2 }}>
          {(selectedResource === 'all' || selectedResource === 'cpu') && <Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 12, height: 3, bgcolor: COLORS.cpu, borderRadius: 1 }} /><Typography variant="caption">CPU</Typography></Stack>}
          {(selectedResource === 'all' || selectedResource === 'ram') && <Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 12, height: 3, bgcolor: COLORS.ram, borderRadius: 1 }} /><Typography variant="caption">RAM</Typography></Stack>}
          {(selectedResource === 'all' || selectedResource === 'storage') && <Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 12, height: 3, bgcolor: COLORS.storage, borderRadius: 1 }} /><Typography variant="caption">Stockage</Typography></Stack>}
          <Stack direction="row" alignItems="center" spacing={0.75}><Box sx={{ width: 12, height: 2, borderTop: '2px dashed', borderColor: 'text.secondary' }} /><Typography variant="caption" color="text.secondary">Projection</Typography></Stack>
        </Stack>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Top VMs Component                                                   */
/* ------------------------------------------------------------------ */

function TopVmsCompact({ cpuVms, ramVms, loading }: { cpuVms: TopVm[]; ramVms: TopVm[]; loading?: boolean }) {
  const [tab, setTab] = useState(0)

  if (loading) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Skeleton variant="text" width="40%" sx={{ mb: 2 }} />
          {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} variant="rectangular" height={36} sx={{ mb: 1, borderRadius: 1 }} />)}
        </CardContent>
      </Card>
    )
  }

  const vms = tab === 0 ? cpuVms : ramVms
  const color = tab === 0 ? COLORS.cpu : COLORS.ram
  const metric = tab === 0 ? 'cpu' : 'ram'

  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0, textTransform: 'none' } }}>
          <Tab icon={<SpeedIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Top CPU" />
          <Tab icon={<MemoryIcon sx={{ fontSize: 18 }} />} iconPosition="start" label="Top RAM" />
        </Tabs>
        <Stack spacing={1}>
          {vms.slice(0, 5).map((vm, index) => {
            const value = metric === 'cpu' ? vm.cpu : vm.ram

            
return (
              <Box key={vm.id}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.25 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="caption" sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: alpha(color, index === 0 ? 0.2 : 0.1), color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{index + 1}</Typography>
                    <Typography variant="body2" fontWeight={index === 0 ? 600 : 400} noWrap sx={{ maxWidth: 150 }}>{vm.name}</Typography>
                  </Stack>
                  <Typography variant="body2" fontWeight={600} sx={{ color }}>{formatPct(value)}</Typography>
                </Stack>
                <LinearProgress variant="determinate" value={Math.min(100, value)} sx={{ height: 3, borderRadius: 1, bgcolor: alpha(color, 0.1), '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: 1 } }} />
              </Box>
            )
          })}
        </Stack>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* VMs Distribution Component                                          */
/* ------------------------------------------------------------------ */

function VmsDistribution({ kpis, loading }: { kpis: KpiData | null; loading?: boolean }) {
  const t = useTranslations()

  if (loading || !kpis) {
    return (
      <Card variant="outlined">
        <CardContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Skeleton variant="circular" width={150} height={150} />
          <Skeleton variant="text" width="60%" sx={{ mt: 2 }} />
        </CardContent>
      </Card>
    )
  }

  const data = [
    { name: 'Running', value: kpis.vms.running, color: COLORS.success },
    { name: 'Stopped', value: kpis.vms.stopped, color: COLORS.error },
  ]

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, textAlign: 'center' }}>Machines Virtuelles</Typography>
        <Box sx={{ width: '100%', height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                {data.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
              </Pie>
              <RTooltip />
            </PieChart>
          </ResponsiveContainer>
        </Box>
        <Stack direction="row" spacing={2} justifyContent="center">
          <Stack direction="row" alignItems="center" spacing={0.5}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: COLORS.success }} /><Typography variant="caption">{kpis.vms.running} actives</Typography></Stack>
          <Stack direction="row" alignItems="center" spacing={0.5}><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: COLORS.error }} /><Typography variant="caption">{kpis.vms.stopped} {t('resources.stopped')}</Typography></Stack>
        </Stack>
        <Typography variant="h5" fontWeight={700} textAlign="center" sx={{ mt: 1 }}>{kpis.vms.total} VMs</Typography>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Green Metrics Component (RSE / Environnement)                       */
/* ------------------------------------------------------------------ */

function GreenMetricsCard({ green, loading }: { green: GreenMetrics | null; loading?: boolean }) {
  const theme = useTheme()
  const t = useTranslations()

  if (loading || !green) {
    return (
      <Card
        sx={{
          background: `linear-gradient(135deg, ${alpha('#22c55e', 0.08)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 100%)`,
          border: '1px solid',
          borderColor: alpha('#22c55e', 0.2),
        }}
      >
        <CardContent sx={{ p: 3 }}>
          <Skeleton variant="text" width="40%" height={32} sx={{ mb: 2 }} />
          <Stack direction="row" spacing={2}>
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} variant="rectangular" width="25%" height={120} sx={{ borderRadius: 2 }} />
            ))}
          </Stack>
        </CardContent>
      </Card>
    )
  }

  const greenColor = '#22c55e'
  const scoreColor = green.efficiency.score >= 70 ? greenColor : green.efficiency.score >= 50 ? COLORS.warning : COLORS.error

  return (
    <Card
      sx={{
        background: `linear-gradient(135deg, ${alpha(greenColor, 0.05)} 0%, ${alpha(theme.palette.background.paper, 0.98)} 50%, ${alpha(greenColor, 0.02)} 100%)`,
        border: '1px solid',
        borderColor: alpha(greenColor, 0.25),
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Background decoration */}
      <Box
        sx={{
          position: 'absolute',
          top: -30,
          right: -30,
          width: 150,
          height: 150,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${alpha(greenColor, 0.08)} 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />

      <CardContent sx={{ p: 3, position: 'relative' }}>
        {/* Header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box
              sx={{
                p: 1,
                borderRadius: 2,
                bgcolor: alpha(greenColor, 0.1),
                color: greenColor,
                display: 'flex',
              }}
            >
              <EnergySavingsLeafIcon />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700}>
                Impact Environnemental
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Estimations basées sur votre infrastructure
              </Typography>
            </Box>
          </Stack>

          {/* Score Green */}
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircularProgress
                variant="determinate"
                value={100}
                size={56}
                thickness={4}
                sx={{ color: alpha(scoreColor, 0.15) }}
              />
              <CircularProgress
                variant="determinate"
                value={green.efficiency.score}
                size={56}
                thickness={4}
                sx={{ color: scoreColor, position: 'absolute', left: 0 }}
              />
              <Box
                sx={{
                  top: 0, left: 0, bottom: 0, right: 0,
                  position: 'absolute',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography variant="body2" fontWeight={800} sx={{ color: scoreColor }}>
                  {green.efficiency.score}
                </Typography>
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
                Score
              </Typography>
              <Typography variant="caption" fontWeight={700} sx={{ color: scoreColor }}>
                Green
              </Typography>
            </Box>
          </Stack>
        </Stack>

        {/* Metrics Grid */}
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          {/* Consommation électrique */}
          <Paper
            sx={{
              flex: 1,
              p: 2,
              bgcolor: alpha(COLORS.warning, 0.04),
              border: '1px solid',
              borderColor: alpha(COLORS.warning, 0.15),
              borderRadius: 2,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <ElectricBoltIcon sx={{ fontSize: 18, color: COLORS.warning }} />
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Consommation
              </Typography>
            </Stack>
            <Typography variant="h5" fontWeight={800} sx={{ color: COLORS.warning }}>
              {green.power.current.toLocaleString()} W
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Mensuel</Typography>
                <Typography variant="body2" fontWeight={600}>{green.power.monthly.toLocaleString()} kWh</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Annuel</Typography>
                <Typography variant="body2" fontWeight={600}>{green.power.yearly.toLocaleString()} kWh</Typography>
              </Box>
            </Stack>
          </Paper>

          {/* Émissions CO₂ */}
          <Paper
            sx={{
              flex: 1,
              p: 2,
              bgcolor: alpha('#64748b', 0.04),
              border: '1px solid',
              borderColor: alpha('#64748b', 0.15),
              borderRadius: 2,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Co2Icon sx={{ fontSize: 18, color: '#64748b' }} />
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Émissions CO₂
              </Typography>
            </Stack>
            <Typography variant="h5" fontWeight={800} sx={{ color: '#64748b' }}>
              {green.co2.yearly.toLocaleString()} kg/an
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Par jour</Typography>
                <Typography variant="body2" fontWeight={600}>{green.co2.daily} kg</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Facteur</Typography>
                <Typography variant="body2" fontWeight={600}>{green.co2.factor} kg/kWh</Typography>
              </Box>
            </Stack>
          </Paper>

          {/* Équivalences */}
          <Paper
            sx={{
              flex: 1,
              p: 2,
              bgcolor: alpha(greenColor, 0.04),
              border: '1px solid',
              borderColor: alpha(greenColor, 0.15),
              borderRadius: 2,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <ParkIcon sx={{ fontSize: 18, color: greenColor }} />
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Équivalences /an
              </Typography>
            </Stack>
            <Stack spacing={1}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <DirectionsCarIcon sx={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2">
                  <strong>{green.co2.equivalentKmCar.toLocaleString()}</strong> km en voiture
                </Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={1}>
                <ParkIcon sx={{ fontSize: 16, opacity: 0.6 }} />
                <Typography variant="body2">
                  <strong>{green.co2.equivalentTrees}</strong> arbres pour compenser
                </Typography>
              </Stack>
            </Stack>
          </Paper>

          {/* Coût énergie */}
          <Paper
            sx={{
              flex: 1,
              p: 2,
              bgcolor: alpha(COLORS.info, 0.04),
              border: '1px solid',
              borderColor: alpha(COLORS.info, 0.15),
              borderRadius: 2,
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <EuroIcon sx={{ fontSize: 18, color: COLORS.info }} />
              <Typography variant="caption" fontWeight={600} color="text.secondary">
                Coût Énergie
              </Typography>
            </Stack>
            <Typography variant="h5" fontWeight={800} sx={{ color: COLORS.info }}>
              {green.cost.yearly.toLocaleString()} €/an
            </Typography>
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Mensuel</Typography>
                <Typography variant="body2" fontWeight={600}>{green.cost.monthly} €</Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Prix kWh</Typography>
                <Typography variant="body2" fontWeight={600}>{green.cost.pricePerKwh} €</Typography>
              </Box>
            </Stack>
          </Paper>
        </Stack>

        {/* Footer avec indicateurs supplémentaires */}
        <Stack direction="row" spacing={3} sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
          <Chip
            size="small"
            icon={<BoltIcon sx={{ fontSize: 14 }} />}
            label={`PUE: ${green.efficiency.pue}`}
            sx={{ bgcolor: alpha(COLORS.warning, 0.1), color: COLORS.warning }}
          />
          <Chip
            size="small"
            icon={<CloudIcon sx={{ fontSize: 14 }} />}
            label={`${green.efficiency.vmPerKw} VMs/kW`}
            sx={{ bgcolor: alpha(COLORS.info, 0.1), color: COLORS.info }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            💡 {t('resources.optimizeScore')}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Overprovisioning Analysis Component                                 */
/* ------------------------------------------------------------------ */

function OverprovisioningCard({ data, loading }: { data: OverprovisioningData | null; loading?: boolean }) {
  const theme = useTheme()
  const t = useTranslations()
  const [activeTab, setActiveTab] = useState(0)

  const getRatioColor = (ratio: number, type: 'cpu' | 'ram') => {
    const thresholds = type === 'cpu' 
      ? { safe: 2, warning: 4, danger: 6 }
      : { safe: 1, warning: 1.3, danger: 1.5 }
    
    if (ratio <= thresholds.safe) return COLORS.success
    if (ratio <= thresholds.warning) return COLORS.warning
    if (ratio <= thresholds.danger) return '#f97316'
    
return COLORS.error
  }

  const getRatioLabel = (ratio: number, type: 'cpu' | 'ram') => {
    const thresholds = type === 'cpu' 
      ? { safe: 2, warning: 4, danger: 6 }
      : { safe: 1, warning: 1.3, danger: 1.5 }
    
    if (ratio <= thresholds.safe) return 'Conservateur'
    if (ratio <= thresholds.warning) return 'Optimal'
    if (ratio <= thresholds.danger) return 'Agressif'
    
return 'Critique'
  }

  const getEfficiencyStatus = (efficiency: number) => {
    if (efficiency >= 70) return { label: 'Excellent', color: COLORS.success }
    if (efficiency >= 50) return { label: 'Bon', color: COLORS.info }
    if (efficiency >= 30) return { label: 'Moyen', color: COLORS.warning }
    
return { label: 'Faible', color: COLORS.error }
  }

  if (loading) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent>
          <Skeleton variant="text" width="50%" height={32} sx={{ mb: 2 }} />
          <Stack direction="row" spacing={2}>
            <Skeleton variant="circular" width={140} height={140} />
            <Skeleton variant="circular" width={140} height={140} />
            <Box sx={{ flex: 1 }}>
              <Skeleton variant="rectangular" height={100} sx={{ borderRadius: 2 }} />
            </Box>
          </Stack>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card variant="outlined" sx={{ height: '100%' }}>
        <CardContent sx={{ textAlign: 'center', py: 6 }}>
          <LayersIcon sx={{ fontSize: 64, color: alpha(COLORS.info, 0.2), mb: 2 }} />
          <Typography variant="body1" fontWeight={600}>{t('resources.overprovisioningDataNotAvailable')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('resources.allocationMetricsWillBeShown')}</Typography>
        </CardContent>
      </Card>
    )
  }

  const cpuColor = getRatioColor(data.cpu.ratio, 'cpu')
  const ramColor = getRatioColor(data.ram.ratio, 'ram')
  const cpuEfficiency = getEfficiencyStatus(data.cpu.efficiency)
  const ramEfficiency = getEfficiencyStatus(data.ram.efficiency)

  const wastedCpu = Math.max(0, data.cpu.allocated - Math.ceil(data.cpu.used * 1.3))
  const wastedRam = Math.max(0, data.ram.allocated - Math.ceil(data.ram.used * 1.2))

  return (
    <Card 
      variant="outlined" 
      sx={{ 
        height: '100%',
        background: `linear-gradient(135deg, ${alpha(COLORS.info, 0.02)} 0%, transparent 50%, ${alpha(COLORS.primary, 0.02)} 100%)`,
      }}
    >
      <CardContent sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 3 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Box sx={{ p: 1, borderRadius: 2, bgcolor: alpha(COLORS.info, 0.1), color: COLORS.info, display: 'flex' }}>
              <LayersIcon />
            </Box>
            <Box>
              <Typography variant="h6" fontWeight={700}>Analyse Overprovisioning</Typography>
              <Typography variant="caption" color="text.secondary">Ratio allocation vs capacité physique</Typography>
            </Box>
          </Stack>
          <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} sx={{ minHeight: 32 }}>
            <Tab label="Vue globale" sx={{ minHeight: 32, py: 0.5, textTransform: 'none', fontSize: '0.8rem' }} />
            <Tab label="Par nœud" sx={{ minHeight: 32, py: 0.5, textTransform: 'none', fontSize: '0.8rem' }} />
            <Tab label="VMs à optimiser" sx={{ minHeight: 32, py: 0.5, textTransform: 'none', fontSize: '0.8rem' }} />
          </Tabs>
        </Stack>

        {activeTab === 0 && (
          <Stack spacing={3}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
              {/* CPU Gauge */}
              <Paper sx={{ flex: 1, p: 3, bgcolor: alpha(cpuColor, 0.04), border: '1px solid', borderColor: alpha(cpuColor, 0.2), borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={3}>
                  <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <CircularProgress variant="determinate" value={100} size={120} thickness={4} sx={{ color: alpha(cpuColor, 0.15) }} />
                    <CircularProgress variant="determinate" value={Math.min(100, (data.cpu.ratio / 8) * 100)} size={120} thickness={4} sx={{ color: cpuColor, position: 'absolute', left: 0, filter: `drop-shadow(0 0 6px ${alpha(cpuColor, 0.4)})` }} />
                    <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                      <Typography variant="h4" fontWeight={800} sx={{ color: cpuColor, lineHeight: 1 }}>{data.cpu.ratio.toFixed(1)}</Typography>
                      <Typography variant="caption" color="text.secondary">:1</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <SpeedIcon sx={{ color: COLORS.cpu, fontSize: 20 }} />
                      <Typography variant="subtitle1" fontWeight={700}>CPU vCPU/pCPU</Typography>
                      <Chip size="small" label={getRatioLabel(data.cpu.ratio, 'cpu')} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(cpuColor, 0.15), color: cpuColor, fontWeight: 600 }} />
                    </Stack>
                    <Stack spacing={1}>
                      <Box>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="caption" color="text.secondary">{t('resources.allocated')}</Typography>
                          <Typography variant="caption" fontWeight={600}>{data.cpu.allocated} vCPUs</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, (data.cpu.allocated / data.cpu.physical) * 100)} sx={{ height: 6, borderRadius: 1, bgcolor: alpha(COLORS.cpu, 0.1), '& .MuiLinearProgress-bar': { bgcolor: COLORS.cpu } }} />
                      </Box>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">Physiques</Typography>
                        <Typography variant="caption" fontWeight={600}>{data.cpu.physical} cœurs</Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">Utilisés (moy.)</Typography>
                        <Typography variant="caption" fontWeight={600}>{data.cpu.used.toFixed(1)} vCPUs</Typography>
                      </Stack>
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="caption" color="text.secondary">{t('resources.efficiency')}</Typography>
                        <Chip size="small" label={`${data.cpu.efficiency.toFixed(0)}% - ${cpuEfficiency.label}`} sx={{ height: 18, fontSize: '0.6rem', bgcolor: alpha(cpuEfficiency.color, 0.15), color: cpuEfficiency.color }} />
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Paper>

              {/* RAM Gauge */}
              <Paper sx={{ flex: 1, p: 3, bgcolor: alpha(ramColor, 0.04), border: '1px solid', borderColor: alpha(ramColor, 0.2), borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" spacing={3}>
                  <Box sx={{ position: 'relative', display: 'inline-flex' }}>
                    <CircularProgress variant="determinate" value={100} size={120} thickness={4} sx={{ color: alpha(ramColor, 0.15) }} />
                    <CircularProgress variant="determinate" value={Math.min(100, (data.ram.ratio / 2) * 100)} size={120} thickness={4} sx={{ color: ramColor, position: 'absolute', left: 0, filter: `drop-shadow(0 0 6px ${alpha(ramColor, 0.4)})` }} />
                    <Box sx={{ top: 0, left: 0, bottom: 0, right: 0, position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
                      <Typography variant="h4" fontWeight={800} sx={{ color: ramColor, lineHeight: 1 }}>{data.ram.ratio.toFixed(2)}</Typography>
                      <Typography variant="caption" color="text.secondary">:1</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <MemoryIcon sx={{ color: COLORS.ram, fontSize: 20 }} />
                      <Typography variant="subtitle1" fontWeight={700}>RAM vRAM/pRAM</Typography>
                      <Chip size="small" label={getRatioLabel(data.ram.ratio, 'ram')} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(ramColor, 0.15), color: ramColor, fontWeight: 600 }} />
                    </Stack>
                    <Stack spacing={1}>
                      <Box>
                        <Stack direction="row" justifyContent="space-between">
                          <Typography variant="caption" color="text.secondary">{t('resources.allocated')}</Typography>
                          <Typography variant="caption" fontWeight={600}>{data.ram.allocated.toFixed(0)} GB</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, (data.ram.allocated / data.ram.physical) * 100)} sx={{ height: 6, borderRadius: 1, bgcolor: alpha(COLORS.ram, 0.1), '& .MuiLinearProgress-bar': { bgcolor: COLORS.ram } }} />
                      </Box>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">Physique</Typography>
                        <Typography variant="caption" fontWeight={600}>{data.ram.physical.toFixed(0)} GB</Typography>
                      </Stack>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="caption" color="text.secondary">Utilisée</Typography>
                        <Typography variant="caption" fontWeight={600}>{data.ram.used.toFixed(1)} GB</Typography>
                      </Stack>
                      <Divider sx={{ my: 0.5 }} />
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="caption" color="text.secondary">{t('resources.efficiency')}</Typography>
                        <Chip size="small" label={`${data.ram.efficiency.toFixed(0)}% - ${ramEfficiency.label}`} sx={{ height: 18, fontSize: '0.6rem', bgcolor: alpha(ramEfficiency.color, 0.15), color: ramEfficiency.color }} />
                      </Stack>
                    </Stack>
                  </Box>
                </Stack>
              </Paper>
            </Stack>

            {/* Potentiel d'optimisation */}
            <Paper sx={{ p: 2, bgcolor: alpha(COLORS.primary, 0.03), border: '1px solid', borderColor: alpha(COLORS.primary, 0.15), borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems="center">
                <Stack direction="row" alignItems="center" spacing={1}>
                  <TipsAndUpdatesIcon sx={{ color: COLORS.warning, fontSize: 24 }} />
                  <Typography variant="subtitle2" fontWeight={700}>Potentiel d'optimisation</Typography>
                </Stack>
                <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
                {wastedCpu > 0 && (
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <SpeedIcon sx={{ fontSize: 18, color: COLORS.cpu }} />
                    <Typography variant="body2">{t('resources.recoverableVcpus', { count: wastedCpu })}</Typography>
                  </Stack>
                )}
                {wastedRam > 0 && (
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <MemoryIcon sx={{ fontSize: 18, color: COLORS.ram }} />
                    <Typography variant="body2">{t('resources.recoverableRam', { count: wastedRam.toFixed(0) })}</Typography>
                  </Stack>
                )}
                {wastedCpu === 0 && wastedRam === 0 && (
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <CheckCircleIcon sx={{ fontSize: 18, color: COLORS.success }} />
                    <Typography variant="body2" sx={{ color: COLORS.success }}>Ressources optimisées</Typography>
                  </Stack>
                )}
                <Box sx={{ ml: 'auto' }}>
                  <Chip size="small" icon={<SavingsIcon sx={{ fontSize: 14 }} />} label={t('resources.vmsToRightsize', { count: data.topOverprovisioned.length })} sx={{ bgcolor: alpha(data.topOverprovisioned.length > 0 ? COLORS.warning : COLORS.success, 0.1), color: data.topOverprovisioned.length > 0 ? COLORS.warning : COLORS.success, fontWeight: 600 }} />
                </Box>
              </Stack>
            </Paper>

            <Stack direction="row" spacing={2} justifyContent="center" sx={{ pt: 1 }}>
              <Typography variant="caption" color="text.secondary"><Box component="span" sx={{ color: COLORS.success, fontWeight: 600 }}>●</Box> Conservateur</Typography>
              <Typography variant="caption" color="text.secondary"><Box component="span" sx={{ color: COLORS.warning, fontWeight: 600 }}>●</Box> Optimal</Typography>
              <Typography variant="caption" color="text.secondary"><Box component="span" sx={{ color: '#f97316', fontWeight: 600 }}>●</Box> Agressif</Typography>
              <Typography variant="caption" color="text.secondary"><Box component="span" sx={{ color: COLORS.error, fontWeight: 600 }}>●</Box> Critique</Typography>
            </Stack>
          </Stack>
        )}

        {activeTab === 1 && (
          <Stack spacing={1.5}>
            <Stack direction="row" sx={{ px: 2, py: 1, bgcolor: alpha(COLORS.primary, 0.03), borderRadius: 1 }}>
              <Typography variant="caption" fontWeight={600} sx={{ width: 140 }}>Nœud</Typography>
              <Typography variant="caption" fontWeight={600} sx={{ flex: 1, textAlign: 'center' }}>CPU Ratio</Typography>
              <Typography variant="caption" fontWeight={600} sx={{ flex: 1, textAlign: 'center' }}>RAM Ratio</Typography>
              <Typography variant="caption" fontWeight={600} sx={{ width: 100, textAlign: 'right' }}>Statut</Typography>
            </Stack>
            {data.perNode.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">{t('resources.noNodeDataAvailable')}</Typography>
              </Box>
            ) : (
              data.perNode.map((node) => {
                const nodeCpuColor = getRatioColor(node.cpuRatio, 'cpu')
                const nodeRamColor = getRatioColor(node.ramRatio, 'ram')
                const worstRatio = Math.max(node.cpuRatio / 4, node.ramRatio / 1.3)
                const statusColor = worstRatio > 1.5 ? COLORS.error : worstRatio > 1 ? COLORS.warning : COLORS.success

                
return (
                  <Paper key={node.name} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2, '&:hover': { bgcolor: alpha(COLORS.primary, 0.02) } }}>
                    <Stack direction="row" alignItems="center">
                      <Stack direction="row" alignItems="center" spacing={1} sx={{ width: 140 }}>
                        <StorageIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="body2" fontWeight={600}>{node.name}</Typography>
                      </Stack>
                      <Box sx={{ flex: 1, px: 2 }}>
                        <Stack direction="row" alignItems="center" justifyContent="center" spacing={1}>
                          <Typography variant="body2" fontWeight={700} sx={{ color: nodeCpuColor }}>{node.cpuRatio.toFixed(1)}:1</Typography>
                          <Typography variant="caption" color="text.secondary">({node.cpuAllocated}/{node.cpuPhysical})</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, (node.cpuRatio / 8) * 100)} sx={{ height: 4, borderRadius: 1, mt: 0.5, bgcolor: alpha(nodeCpuColor, 0.1), '& .MuiLinearProgress-bar': { bgcolor: nodeCpuColor } }} />
                      </Box>
                      <Box sx={{ flex: 1, px: 2 }}>
                        <Stack direction="row" alignItems="center" justifyContent="center" spacing={1}>
                          <Typography variant="body2" fontWeight={700} sx={{ color: nodeRamColor }}>{node.ramRatio.toFixed(2)}:1</Typography>
                          <Typography variant="caption" color="text.secondary">({node.ramAllocated.toFixed(0)}/{node.ramPhysical.toFixed(0)} GB)</Typography>
                        </Stack>
                        <LinearProgress variant="determinate" value={Math.min(100, (node.ramRatio / 2) * 100)} sx={{ height: 4, borderRadius: 1, mt: 0.5, bgcolor: alpha(nodeRamColor, 0.1), '& .MuiLinearProgress-bar': { bgcolor: nodeRamColor } }} />
                      </Box>
                      <Box sx={{ width: 100, textAlign: 'right' }}>
                        <Chip size="small" icon={worstRatio > 1 ? <WarningAmberIcon sx={{ fontSize: 14 }} /> : <CheckCircleIcon sx={{ fontSize: 14 }} />} label={worstRatio > 1.5 ? 'Critique' : worstRatio > 1 ? 'Attention' : 'OK'} sx={{ height: 22, fontSize: '0.65rem', bgcolor: alpha(statusColor, 0.15), color: statusColor, '& .MuiChip-icon': { color: statusColor } }} />
                      </Box>
                    </Stack>
                  </Paper>
                )
              })
            )}
          </Stack>
        )}

        {activeTab === 2 && (
          <Stack spacing={1.5}>
            <Alert severity="info" sx={{ mb: 1 }}>VMs avec le plus grand potentiel de rightsizing basé sur l'utilisation moyenne</Alert>
            {data.topOverprovisioned.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <CheckCircleIcon sx={{ fontSize: 48, color: COLORS.success, mb: 1 }} />
                <Typography variant="body1" fontWeight={600}>{t('resources.allVmsCorrectlySized')}</Typography>
              </Box>
            ) : (
              data.topOverprovisioned.map((vm) => (
                <Paper key={vm.vmid} sx={{ p: 2, border: '1px solid', borderColor: alpha(COLORS.warning, 0.3), borderRadius: 2, bgcolor: alpha(COLORS.warning, 0.02), '&:hover': { bgcolor: alpha(COLORS.warning, 0.05), transform: 'translateX(4px)' }, transition: 'all 0.2s' }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                    <Box sx={{ minWidth: 180 }}>
                      <Typography variant="subtitle2" fontWeight={700}>{vm.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{vm.vmid} • {vm.node}</Typography>
                    </Box>
                    <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
                        <SpeedIcon sx={{ fontSize: 14, color: COLORS.cpu }} />
                        <Typography variant="caption" fontWeight={600}>CPU</Typography>
                      </Stack>
                      <Stack direction="row" alignItems="baseline" spacing={1}>
                        <Typography variant="body2"><strong>{vm.cpuAllocated}</strong> → <strong style={{ color: COLORS.success }}>{vm.recommendedCpu}</strong> vCPU</Typography>
                        <Chip size="small" label={`${vm.cpuUsedPct.toFixed(0)}% ${t('resources.used')}`} sx={{ height: 16, fontSize: '0.55rem' }} />
                      </Stack>
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 0.5 }}>
                        <MemoryIcon sx={{ fontSize: 14, color: COLORS.ram }} />
                        <Typography variant="caption" fontWeight={600}>RAM</Typography>
                      </Stack>
                      <Stack direction="row" alignItems="baseline" spacing={1}>
                        <Typography variant="body2"><strong>{vm.ramAllocatedGB.toFixed(0)}</strong> → <strong style={{ color: COLORS.success }}>{vm.recommendedRamGB.toFixed(0)}</strong> GB</Typography>
                        <Chip size="small" label={`${vm.ramUsedPct.toFixed(0)}% ${t('resources.used')}`} sx={{ height: 16, fontSize: '0.55rem' }} />
                      </Stack>
                    </Box>
                    <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', md: 'block' } }} />
                    <Box sx={{ minWidth: 120, textAlign: { xs: 'left', md: 'right' } }}>
                      <Typography variant="caption" color="text.secondary">Économies</Typography>
                      <Stack direction="row" spacing={1} justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
                        {vm.potentialSavings.cpu > 0 && <Chip size="small" label={`-${vm.potentialSavings.cpu} vCPU`} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(COLORS.success, 0.1), color: COLORS.success }} />}
                        {vm.potentialSavings.ramGB > 0 && <Chip size="small" label={`-${vm.potentialSavings.ramGB.toFixed(0)} GB`} sx={{ height: 20, fontSize: '0.65rem', bgcolor: alpha(COLORS.success, 0.1), color: COLORS.success }} />}
                      </Stack>
                    </Box>
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        )}
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* Main Page Component                                                 */
/* ------------------------------------------------------------------ */

export default function ResourcesPage() {
  const t = useTranslations()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [kpis, setKpis] = useState<KpiData | null>(null)
  const [trends, setTrends] = useState<ResourceTrend[]>([])
  const [trendsPeriod, setTrendsPeriod] = useState<{ start: string | null, end: string | null, daysCount: number } | null>(null)
  const [topCpuVms, setTopCpuVms] = useState<TopVm[]>([])
  const [topRamVms, setTopRamVms] = useState<TopVm[]>([])
  const [green, setGreen] = useState<GreenMetrics | null>(null)
  const [overprovisioning, setOverprovisioning] = useState<OverprovisioningData | null>(null)
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysis>({ summary: '', recommendations: [], loading: false })

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('navigation.resources'), t('dashboard.widgets.resources'), 'ri-pie-chart-fill')
    
return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/resources/overview')

      if (!res.ok) throw new Error('Erreur lors du chargement')
      const json = await res.json()

      setKpis(json.data.kpis)
      setTrends(json.data.trends || [])
      setTrendsPeriod(json.data.trendsPeriod || null)
      setTopCpuVms(json.data.topCpuVms || [])
      setTopRamVms(json.data.topRamVms || [])
      setGreen(json.data.green || null)
      setOverprovisioning(json.data.overprovisioning || null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (kpis && !aiAnalysis.summary && !aiAnalysis.loading) runAiAnalysis()
  }, [kpis])

  const runAiAnalysis = async () => {
    if (!kpis) return
    setAiAnalysis(prev => ({ ...prev, loading: true, error: undefined }))

    try {
      const res = await fetch('/api/v1/resources/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kpis, topCpuVms, topRamVms }),
      })

      if (!res.ok) throw new Error(t('errors.loadingError'))
      const json = await res.json()

      setAiAnalysis({ summary: json.data?.summary || '', recommendations: json.data?.recommendations || [], loading: false, provider: json.data?.provider })
    } catch (e: any) {
      setAiAnalysis(prev => ({ ...prev, loading: false, error: e.message }))
    }
  }

  const { projectedTrends, alerts } = useMemo(() => {
    if (!kpis || trends.length === 0) return { projectedTrends: [], alerts: [] }
    
return calculatePredictions(kpis, trends)
  }, [kpis, trends])

  const healthScore = useMemo(() => {
    if (!kpis) return 0
    
return calculateHealthScore(kpis, alerts)
  }, [kpis, alerts])

  return (
    <EnterpriseGuard requiredFeature={Features.GREEN_METRICS} featureName="Green Metrics / RSE">
      <Box sx={{ p: 3 }}>
        <Stack direction="row" justifyContent="flex-end" sx={{ mb: 3 }}>
          <Button variant="outlined" startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />} onClick={() => { loadData(); setAiAnalysis({ summary: '', recommendations: [], loading: false }) }} disabled={loading} sx={{ borderRadius: 2 }}>{t('common.refresh')}</Button>
        </Stack>

        {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

        <Box sx={{ mb: 3 }}>
          <GlobalHealthScore score={healthScore} kpis={kpis} alerts={alerts} loading={loading} />
        </Box>

        <Grid container spacing={3}>
          <Grid size={{ xs: 12, lg: 8 }}>
            <ProjectionChart data={projectedTrends} loading={loading} period={trendsPeriod} />
          </Grid>
          <Grid size={{ xs: 12, lg: 4 }}>
            <PredictiveAlertsCard alerts={alerts} loading={loading} />
          </Grid>

          {/* Section Green / RSE */}
          <Grid size={{ xs: 12 }}>
            <GreenMetricsCard green={green} loading={loading} />
          </Grid>

          {/* Section Overprovisioning */}
          <Grid size={{ xs: 12 }}>
            <OverprovisioningCard data={overprovisioning} loading={loading} />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <AiInsightsCard analysis={aiAnalysis} onAnalyze={runAiAnalysis} loading={loading} />
          </Grid>
        </Grid>
      </Box>
    </EnterpriseGuard>
  )
}