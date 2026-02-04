import { api } from './client'

export type JobStatus = 'queued' | 'running' | 'success' | 'failed' | 'canceled'

export type JobStep = {
  name: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
}

export type JobItem = {
  id: string
  type: string
  status: JobStatus
  target: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  progress: number
  durationSec: number
  steps: JobStep[]
  logs: string[]
}

export const jobsApi = {
  list: () => api.get<{ data: JobItem[] }>('/api/v1/jobs')
}

