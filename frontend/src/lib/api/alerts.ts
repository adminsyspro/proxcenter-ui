import { api } from './client'

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low'
export type AlertStatus = 'open' | 'acknowledged' | 'silenced' | 'resolved'

export type AlertItem = {
  id: string
  title: string
  severity: AlertSeverity
  status: AlertStatus
  source: { type: string; name: string }
  labels: string[]
  createdAt: string
  updatedAt: string
  message: string
}

export const alertsApi = {
  list: () => api.get<{ data: AlertItem[] }>('/api/v1/alerts')
}

