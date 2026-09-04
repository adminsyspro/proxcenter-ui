import { NO_SEGMENT_KEY } from '@/lib/proxmox/nicSegment'

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

const SEGMENT_COLORS = ['#1976d2', '#7b1fa2', '#00838f', '#c62828', '#2e7d32', '#f57c00']

/**
 * Colour of a network segment bucket, keyed by its segment id (a VLAN id, or a
 * VXLAN VNI). Grey when the bucket names no segment, so the "No VLAN" bucket
 * stays visually neutral. Both VLAN bucket node types share this palette.
 */
export function getSegmentColor(tag: number | null | undefined): string {
  if (tag == null) return '#9e9e9e'

  return SEGMENT_COLORS[Math.abs(tag) % SEGMENT_COLORS.length]
}

/**
 * Icon of a segment bucket, following the inventory Network view: an SDN VNet
 * is a branch, a plain VLAN a router, and no segment a broken link.
 */
export function segmentIcon(segmentKey: string, vnet?: string): string {
  if (vnet) return 'ri-git-branch-line'
  if (segmentKey === NO_SEGMENT_KEY) return 'ri-link-unlink'

  return 'ri-router-line'
}
