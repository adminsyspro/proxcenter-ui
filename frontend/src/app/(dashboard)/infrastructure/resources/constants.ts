import type { ResourceThresholds } from './types'

export const COLORS = {
  cpu: '#f97316',
  ram: '#8b5cf6',
  storage: '#06b6d4',
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',
  primary: '#6366f1',
  network: '#ec4899',
}

export const DEFAULT_THRESHOLDS: ResourceThresholds = {
  cpu: { warning: 80, critical: 90 },
  ram: { warning: 80, critical: 90 },
  storage: { warning: 80, critical: 90 },
}

export const VM_COLORS = [
  '#6366f1', '#f97316', '#22c55e', '#ec4899', '#06b6d4',
  '#eab308', '#8b5cf6', '#ef4444', '#14b8a6', '#f43f5e',
]
