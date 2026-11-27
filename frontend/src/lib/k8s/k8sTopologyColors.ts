/** Per-kind accent color for type label chips in the topology canvas */
export function kindColor(kind: string): string {
  switch (kind) {
    case 'deployment': return '#1976d2'
    case 'statefulset': return '#7b1fa2'
    case 'daemonset': return '#0288d1'
    case 'job': return '#f57c00'
    case 'cronjob': return '#ef6c00'
    case 'replicaset': return '#5c6bc0'
    case 'podGroup': return '#43a047'
    case 'pod': return '#388e3c'
    case 'service': return '#00838f'
    case 'ingress': return '#6d4c41'
    case 'configmap': return '#546e7a'
    default: return '#78909c'
  }
}

/** Per-kind remixicon class (mirrors resourceKinds icons; adds topology-only kinds) */
export function kindIcon(kind: string): string {
  switch (kind) {
    case 'deployment': return 'ri-rocket-line'
    case 'statefulset': return 'ri-database-2-line'
    case 'daemonset': return 'ri-loop-left-line'
    case 'job': return 'ri-play-circle-line'
    case 'cronjob': return 'ri-timer-line'
    case 'replicaset': return 'ri-file-copy-line'
    case 'podGroup': return 'ri-stack-line'
    case 'pod': return 'ri-box-3-line'
    case 'service': return 'ri-router-line'
    case 'ingress': return 'ri-global-line'
    case 'configmap': return 'ri-file-list-2-line'
    default: return 'ri-shapes-line'
  }
}

/** Deterministic accent color per app-group, for the group box header. */
const GROUP_PALETTE = [
  '#43a047', '#1976d2', '#8e24aa', '#00838f', '#ef6c00',
  '#5c6bc0', '#c2185b', '#00897b', '#6d4c41', '#3949ab',
]
export function groupColor(key: string): string {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return GROUP_PALETTE[h % GROUP_PALETTE.length]
}

/** Health color: red for unhealthy, orange for degraded, green for healthy */
export function healthColor(healthy: boolean, reason?: string): string {
  if (!healthy) return '#f44336'
  if (reason) return '#ff9800'
  return '#4caf50'
}

/** Phase badge color (matches healthDotColor conventions from ClusterCard) */
export function phaseColor(phase: string): string {
  switch (phase.toLowerCase()) {
    case 'running':
    case 'active':
    case 'bound':
      return '#4caf50'
    case 'pending':
    case 'unknown':
      return '#ff9800'
    case 'failed':
    case 'terminating':
      return '#f44336'
    case 'succeeded':
    case 'completed':
      return '#9e9e9e'
    default: return '#9e9e9e'
  }
}
