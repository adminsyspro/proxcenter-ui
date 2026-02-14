import type { NodeStatus } from '../types'

export function getResourceStatus(usage: number, isOnline: boolean): NodeStatus {
  if (!isOnline) return 'critical'
  if (usage > 0.95) return 'critical'
  if (usage >= 0.80) return 'warning'

  return 'ok'
}

export function getStatusColor(status: NodeStatus): string {
  switch (status) {
    case 'ok':
      return '#4caf50'
    case 'warning':
      return '#ff9800'
    case 'critical':
      return '#f44336'
    case 'offline':
      return '#9e9e9e'
    default:
      return '#9e9e9e'
  }
}

export function getStatusBorderColor(status: NodeStatus): string {
  switch (status) {
    case 'ok':
      return '#388e3c'
    case 'warning':
      return '#f57c00'
    case 'critical':
      return '#d32f2f'
    case 'offline':
      return '#757575'
    default:
      return '#757575'
  }
}

export function getVmStatusColor(status: string): string {
  switch (status) {
    case 'running':
      return '#4caf50'
    case 'stopped':
      return '#f44336'
    default:
      return '#9e9e9e'
  }
}
