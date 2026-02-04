import { api } from './client'

export type EventLevel = 'info' | 'warning' | 'error'

export type EventItem = {
  id: string
  ts: string
  level: EventLevel
  category: string
  actor: string
  scope: string
  message: string
  meta?: Record<string, any>
}

export const eventsApi = {
  list: () => api.get<{ data: EventItem[] }>('/api/v1/events')
}
