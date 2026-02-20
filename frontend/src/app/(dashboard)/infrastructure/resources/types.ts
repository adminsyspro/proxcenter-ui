export type KpiData = {
  cpu: { used: number; allocated: number; total: number; trend: number }
  ram: { used: number; allocated: number; total: number; trend: number }
  storage: { used: number; total: number; trend: number }
  vms: { total: number; running: number; stopped: number }
  efficiency: number
}

export type ResourceTrend = {
  t: string
  cpu: number
  ram: number
  storage?: number
  cpuProjection?: number
  ramProjection?: number
  storageProjection?: number
  cpuMin?: number
  cpuMax?: number
  ramMin?: number
  ramMax?: number
  storageMin?: number
  storageMax?: number
}

export type TopVm = {
  id: string
  name: string
  node: string
  cpu: number
  ram: number
  cpuAllocated: number
  ramAllocated: number
}

export type Recommendation = {
  id: string
  type: 'overprovisioned' | 'underused' | 'stopped' | 'snapshot' | 'orphan' | 'prediction' | 'optimization'
  severity: 'high' | 'medium' | 'low' | 'info'
  title: string
  description: string
  savings?: string
  vmId?: string
  vmName?: string
  // i18n keys for basic (rule-based) provider
  titleKey?: string
  descriptionKey?: string
  savingsKey?: string
  params?: Record<string, string | number>
}

export type PredictiveAlert = {
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

export type AiAnalysis = {
  summary: string
  recommendations: Recommendation[]
  loading: boolean
  error?: string
  provider?: string
  // i18n keys for basic (rule-based) provider
  summaryKey?: string
  summaryParams?: Record<string, string | number>
}

export type GreenMetrics = {
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

export type OverprovisioningData = {
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

export type ResourceThresholds = {
  cpu: { warning: number; critical: number }
  ram: { warning: number; critical: number }
  storage: { warning: number; critical: number }
}

export type StoragePool = {
  name: string
  type: string
  used: number
  total: number
  pct: number
  nodes: string[]
  projectedFullDate?: string | null
}

export type NetworkMetrics = {
  totalIn: number
  totalOut: number
  perNode: {
    name: string
    netin: number
    netout: number
  }[]
  topVms: {
    id: string
    name: string
    node: string
    netin: number
    netout: number
  }[]
  trends: { t: string; netin: number; netout: number }[]
}

export type HealthScoreHistoryEntry = {
  date: string
  score: number
  cpu_pct?: number
  ram_pct?: number
  storage_pct?: number
}

export type ConnectionInfo = {
  id: string
  name: string
}

export type VmTrendPoint = {
  t: string
  cpu: number
  ram: number
  netin?: number
  netout?: number
}

export type VmIdentity = {
  id: string
  name: string
  node: string
  connId: string
  type: string
  vmid: string | number
}

export type ConsumerMetric = 'cpu' | 'ram' | 'network'
