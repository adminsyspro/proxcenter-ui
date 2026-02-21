/* ═══════════════════════════════════════════════════════════════════════════
   Security Map — Color palette
═══════════════════════════════════════════════════════════════════════════ */

const ZONE_COLORS = [
  '#1976d2', // blue
  '#7b1fa2', // purple
  '#00838f', // teal
  '#2e7d32', // green
  '#f57c00', // orange
  '#c62828', // red
  '#0277bd', // light blue
  '#6a1b9a', // deep purple
]

export function getZoneColor(index: number): string {
  return ZONE_COLORS[index % ZONE_COLORS.length]
}

export function getFlowStatusColor(status: string): string {
  switch (status) {
    case 'allowed': return '#4caf50'
    case 'blocked': return '#f44336'
    case 'partial': return '#ff9800'
    case 'self': return '#9e9e9e'
    default: return '#9e9e9e'
  }
}

export function getVmProtectionColor(isIsolated: boolean, firewallEnabled: boolean): string {
  if (isIsolated) return '#4caf50'       // green — fully isolated
  if (firewallEnabled) return '#ff9800'   // orange — fw enabled but not isolated
  return '#f44336'                        // red — unprotected
}

export function getVmStatusColor(status: string): string {
  switch (status) {
    case 'running': return '#4caf50'
    case 'stopped': return '#f44336'
    case 'paused': return '#ff9800'
    default: return '#9e9e9e'
  }
}
