import { describe, expect, it } from 'vitest'

import { getAlertIcon, severityLabelKey } from './bellAlertStyle'

describe('getAlertIcon', () => {
  it('shows the pending node updates as an info download', () => {
    expect(getAlertIcon({ type: 'node_updates', severity: 'info', message: '12 updates available on PVE-PROD (pve1: 4)' }))
      .toEqual({ icon: 'ri-download-cloud-2-line', color: 'info' })
  })

  it('keeps the icons picked from the message, coloured by severity', () => {
    expect(getAlertIcon({ severity: 'crit', message: 'Node pve1 offline' })).toEqual({ icon: 'ri-server-line', color: 'error' })
    expect(getAlertIcon({ severity: 'warn', message: 'Cluster lost quorum' })).toEqual({ icon: 'ri-server-line', color: 'error' })
    expect(getAlertIcon({ severity: 'warn', message: 'Ceph noout set' })).toEqual({ icon: 'ri-database-2-line', color: 'warning' })
    expect(getAlertIcon({ severity: 'crit', message: 'PBS datastore full' })).toEqual({ icon: 'ri-shield-check-line', color: 'error' })
    expect(getAlertIcon({ severity: 'warn', message: 'Backup coverage' })).toEqual({ icon: 'ri-shield-check-line', color: 'warning' })
    expect(getAlertIcon({ severity: 'warn', message: 'Node pve1: CPU warning' })).toEqual({ icon: 'ri-cpu-line', color: 'warning' })
    expect(getAlertIcon({ severity: 'warn', message: 'Node pve2: RAM warning' })).toEqual({ icon: 'ri-ram-line', color: 'warning' })
    expect(getAlertIcon({ severity: 'info', message: 'Memory pressure' })).toEqual({ icon: 'ri-ram-line', color: 'info' })
    expect(getAlertIcon({ severity: 'warn', message: 'Node pve1: Storage warning' })).toEqual({ icon: 'ri-hard-drive-2-line', color: 'warning' })
  })

  it('falls back on the severity', () => {
    expect(getAlertIcon({ severity: 'crit' })).toEqual({ icon: 'ri-error-warning-line', color: 'error' })
    expect(getAlertIcon({ severity: 'warn', message: 'x' })).toEqual({ icon: 'ri-alarm-warning-line', color: 'warning' })
    expect(getAlertIcon({ severity: 'info', message: 'x' })).toEqual({ icon: 'ri-information-line', color: 'info' })
  })
})

describe('severityLabelKey', () => {
  it('names each severity', () => {
    expect(severityLabelKey('crit')).toBe('alerts.critical')
    expect(severityLabelKey('warn')).toBe('alerts.warning')
    expect(severityLabelKey('info')).toBe('alerts.infoLevel')
  })
})
