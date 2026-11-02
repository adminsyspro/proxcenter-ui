/**
 * Icon, colour and severity label of an orchestrator alert in the navbar bell.
 * The severity is the bell's short form: crit, warn or info.
 */

export type BellSeverity = 'crit' | 'warn' | 'info'

export interface BellAlert {
  message?: string
  severity: BellSeverity | string
  type?: string
}

export type BellColor = 'error' | 'warning' | 'info'

function severityColor(severity: BellAlert['severity']): BellColor {
  if (severity === 'crit') return 'error'
  if (severity === 'info') return 'info'

  return 'warning'
}

export function getAlertIcon(alert: BellAlert): { icon: string; color: BellColor } {
  const msg = alert.message?.toLowerCase() || ''
  const color = severityColor(alert.severity)

  // Pending updates of the nodes of a cluster (node updates watcher).
  if (alert.type === 'node_updates') return { icon: 'ri-download-cloud-2-line', color }
  if (msg.includes('offline') || msg.includes('quorum')) return { icon: 'ri-server-line', color: 'error' }
  if (msg.includes('ceph')) return { icon: 'ri-database-2-line', color }
  if (msg.includes('pbs') || msg.includes('backup')) return { icon: 'ri-shield-check-line', color }
  if (msg.includes('cpu')) return { icon: 'ri-cpu-line', color }
  if (msg.includes('ram') || msg.includes('memory')) return { icon: 'ri-ram-line', color }
  if (msg.includes('stockage') || msg.includes('storage')) return { icon: 'ri-hard-drive-2-line', color }

  const icon = { error: 'ri-error-warning-line', warning: 'ri-alarm-warning-line', info: 'ri-information-line' }[color]

  return { icon, color }
}

/** i18n key of the severity chip of an alert. */
export function severityLabelKey(severity: BellAlert['severity']): string {
  if (severity === 'crit') return 'alerts.critical'
  if (severity === 'info') return 'alerts.infoLevel'

  return 'alerts.warning'
}
