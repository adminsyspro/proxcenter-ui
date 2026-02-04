import { api } from './client'

export type MonitoringHotspot = {
  id: string
  type: 'cluster' | 'node' | 'vm' | 'storage' | 'network'
  name: string
  metric: string
  value: string
  trend: 'up' | 'down' | 'flat'
}

export type MonitoringPoint = {
  ts: string
  cpu: number
  ram: number
  latencyMs: number
}

export type MonitoringSummary = {
  healthScore: number
  kpis: {
    cpuUsagePct: number
    ramUsagePct: number
    latencyMs: number
  }
  series: MonitoringPoint[]
  hotspots: MonitoringHotspot[]
}

export const monitoringApi = {
  summary: () => api.get<{ data: MonitoringSummary }>('/api/v1/monitoring/summary')
}

