// What the Settings > License tab says about the license, computed once from
// the orchestrator's /license/status (and the imports table rows) so the
// components only lay it out. Two rules drive it: the only date shown outside
// an alert is the commercial expiry, and the connected-mode lease surfaces
// only inside the alert that needs it (sync failing, license moved).

import { leaseDaysLeft } from '@/components/settings/leaseDays'
import { isMovedLicenseExpired } from '@/components/settings/movedLicenseExpired'

import type { LicenseTableRow } from './view'

const DAY_MS = 24 * 60 * 60 * 1000
const CLOCK_SKEW_ALERT_SECONDS = 5 * 60

export interface HeldLicense {
  license_id: string
  kind?: string
  label?: string
  lease_until?: string
  lost?: boolean
  grace_until?: string | null
}

export interface LicenseConnection {
  available?: boolean
  status?: string
  portal_url?: string
  instance_name?: string
  instance_id?: string
  customer_name?: string
  last_ok_at?: string
  next_checkin_at?: string
  consecutive_failures?: number
  lease_until?: string
  lease_warn?: boolean
  server_skew_seconds?: number
  held?: HeldLicense[]
  partner?: { name?: string; has_logo?: boolean; logo_sha256?: string | null } | null
}

export interface LicenseStatus {
  licensed?: boolean
  edition?: string
  license_id?: string
  customer?: { name?: string; company?: string }
  options?: string[]
  limits?: { max_nodes?: number }
  node_status?: { current_nodes?: number; max_nodes?: number; exceeded?: boolean }
  expires_at?: string
  days_remaining?: number
  expired?: boolean
  expiration_warn?: boolean
  is_nfr?: boolean
  binding?: string
  binding_error?: string
  lease_until?: string
  lease_error?: string
  offline?: boolean
  connection?: LicenseConnection | null
}

export type SummarySource =
  | { kind: 'portal'; lastSyncAt: string | null; failing: boolean; partner: { name: string; logoUrl: string | null } | null }
  | { kind: 'file' }
  | { kind: 'key' }

export interface LicenseSummary {
  state: 'community' | 'licensed' | 'expired'
  edition: 'enterprise' | 'community'
  customer: string | null
  // used is null when the orchestrator did not count the nodes.
  nodes: { used: number | null; max: number; unlimited: boolean; fleet: boolean } | null
  // here: a license moved to another instance, only usable here until date.
  // next: several licenses, this is the first to expire; label names it (the
  // name given on proxcenter.io, else its customer) and role says which kind.
  validUntil: { date: string; days: number; here: boolean; next: boolean; label: string | null; role: LicenseTableRow['role'] | null } | null
  source: SummarySource | null
  options: string[]
  licenseCount: number
  nfr: boolean
}

export type AlertSeverity = 'error' | 'warning' | 'info'
export type AlertAction = 'addNodes' | 'renew' | 'sync' | 'requestFile' | 'resetIdentity' | 'reconnect' | 'openAccount'

export interface LicenseAlert {
  id: string
  severity: AlertSeverity
  // ISO dates stay ISO here; the component formats them for the locale.
  values: Record<string, string | number>
  actions: AlertAction[]
}

const isConnectedMode = (c?: LicenseConnection | null) => c?.status === 'connected' || c?.status === 'disconnected'

// Whole days left, never negative: the card reads "in N days".
function daysUntil(date: string, now: number): number {
  const ms = new Date(date).getTime() - now

  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY_MS) : 0
}

function customerName(status: LicenseStatus): string | null {
  return status.customer?.company || status.customer?.name || null
}

// The partner that delivered a connected license (K4). The logo url carries
// the digest so a replaced logo is fetched again despite the browser cache.
function portalPartner(connection: LicenseConnection | null): { name: string; logoUrl: string | null } | null {
  const p = connection?.partner

  if (!p?.name) return null

  return { name: p.name, logoUrl: p.has_logo && p.logo_sha256 ? `/api/v1/license/partner-logo?v=${p.logo_sha256}` : null }
}

export function buildLicenseSummary(status: LicenseStatus, rows: LicenseTableRow[], now: number = Date.now()): LicenseSummary {
  const connection = status.connection || null
  const licensed = !!status.licensed
  const editionRows = rows.filter(r => r.role !== 'option')
  const hasImports = rows.some(r => r.role === 'import')
  const state: LicenseSummary['state'] = status.expired ? 'expired' : licensed ? 'licensed' : 'community'
  const enterprise = status.edition === 'enterprise' || status.edition === 'enterprise_plus'

  if (state === 'community') {
    return { state, edition: 'community', customer: null, nodes: null, validUntil: null, source: null, options: [], licenseCount: 0, nfr: false }
  }

  // Several edition licenses: the fleet total (node_status) and the first
  // expiry among them. One license: its own limit and expiry.
  const fleet = hasImports && editionRows.length > 1
  const max = fleet ? status.node_status?.max_nodes ?? 0 : status.limits?.max_nodes ?? 0
  const used = status.node_status?.current_nodes ?? null
  const nodes = { used, max, unlimited: max <= 0, fleet }

  let validUntil: LicenseSummary['validUntil'] = null

  const primaryHeld = connection?.held?.find(h => h.license_id === status.license_id)

  if (primaryHeld?.lost && primaryHeld.grace_until && leaseDaysLeft(primaryHeld.grace_until, now) !== null) {
    validUntil = { date: primaryHeld.grace_until, days: daysUntil(primaryHeld.grace_until, now), here: true, next: false, label: null, role: null }
  } else if (fleet) {
    const next = editionRows
      .filter(r => r.expiresAt && new Date(r.expiresAt).getTime() > now)
      .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime())[0]

    if (next?.expiresAt) {
      const held = connection?.held?.find(h => h.license_id === next.licenseId)

      validUntil = {
        date: next.expiresAt, days: daysUntil(next.expiresAt, now), here: false, next: true,
        label: held?.label || (next.role === 'primary' ? null : next.licensedTo || null), role: next.role,
      }
    }
  } else if (status.expires_at) {
    validUntil = { date: status.expires_at, days: daysUntil(status.expires_at, now), here: false, next: false, label: null, role: null }
  }

  let source: SummarySource

  if (!status.offline && isConnectedMode(connection) && status.binding === 'connected') {
    source = { kind: 'portal', lastSyncAt: connection?.last_ok_at || null, failing: connection?.status === 'disconnected', partner: portalPartner(connection) }
  } else if (status.binding === 'install') {
    source = { kind: 'file' }
  } else {
    source = { kind: 'key' }
  }

  return {
    state,
    edition: enterprise ? 'enterprise' : 'community',
    customer: customerName(status),
    nodes,
    validUntil,
    source,
    options: status.options || [],
    licenseCount: Math.max(rows.length, 1),
    nfr: !!status.is_nfr,
  }
}

// Every problem the tab must explain, worst first. Several can show at once;
// the card's status pill takes the first one.
export function buildLicenseAlerts(
  status: LicenseStatus,
  extra: { bindingMismatch?: boolean } = {},
  now: number = Date.now(),
): LicenseAlert[] {
  const alerts: LicenseAlert[] = []
  const connection = status.offline ? null : status.connection || null
  const nodeStatus = status.node_status
  const maxNodes = nodeStatus?.max_nodes ?? status.limits?.max_nodes ?? 0

  if (nodeStatus?.exceeded && maxNodes > 0) {
    const used = nodeStatus.current_nodes ?? 0

    alerts.push({ id: 'quota', severity: 'error', values: { used, max: maxNodes, over: Math.max(0, used - maxNodes) }, actions: ['addNodes'] })
  }

  if (status.expired) {
    alerts.push({ id: 'expired', severity: 'error', values: { date: status.expires_at || '' }, actions: ['renew'] })
  }

  if (status.lease_error) {
    // D5: the license was claimed by another instance, not merely unsynced.
    if (isMovedLicenseExpired(status, connection)) {
      alerts.push({ id: 'movedEnded', severity: 'error', values: { date: status.lease_until || '' }, actions: ['openAccount'] })
    } else {
      alerts.push({ id: 'leaseEnded', severity: 'error', values: { date: status.lease_until || connection?.last_ok_at || '' }, actions: ['sync'] })
    }
  }

  if (status.binding_error || extra.bindingMismatch) {
    alerts.push({ id: 'binding', severity: 'error', values: { licenseId: status.license_id || '—' }, actions: ['requestFile'] })
  }

  if (connection?.status === 'cloned') {
    alerts.push({ id: 'cloned', severity: 'error', values: {}, actions: ['resetIdentity', 'reconnect'] })
  } else if (connection?.status === 'revoked') {
    alerts.push({ id: 'revoked', severity: 'error', values: {}, actions: ['reconnect'] })
  } else if (connection?.status === 'identity_changed') {
    alerts.push({ id: 'identityChanged', severity: 'error', values: {}, actions: ['reconnect'] })
  }

  if (connection?.status === 'disconnected' && !status.lease_error) {
    alerts.push({
      id: connection.lease_until ? 'syncFailing' : 'syncFailingNoLease',
      severity: connection.lease_warn ? 'error' : 'warning',
      values: {
        since: connection.last_ok_at || '',
        failures: connection.consecutive_failures || 0,
        next: connection.next_checkin_at || '',
        until: connection.lease_until || '',
      },
      actions: ['sync'],
    })
  }

  for (const h of connection?.held || []) {
    if (!h.lost || (status.lease_error && h.license_id === status.license_id)) continue
    const days = leaseDaysLeft(h.grace_until, now)

    if (days === null) continue
    alerts.push({ id: 'moved', severity: 'warning', values: { label: h.label || h.license_id, days, until: h.grace_until || '' }, actions: ['openAccount'] })
  }

  if (status.expiration_warn && !status.expired && status.expires_at) {
    const portal = isConnectedMode(connection) && status.binding === 'connected'

    alerts.push({
      id: portal ? 'expiring' : 'expiringFile',
      severity: 'info',
      values: { date: status.expires_at, days: daysUntil(status.expires_at, now) },
      actions: ['renew'],
    })
  }

  // Connected, but proxcenter.io has not assigned any license to this
  // instance yet: the card says Community, this says why and where to act.
  if (isConnectedMode(connection) && !status.licensed && !status.lease_error && (connection?.held || []).length === 0) {
    alerts.push({ id: 'noLicense', severity: 'info', values: {}, actions: ['openAccount'] })
  }

  if (Math.abs(connection?.server_skew_seconds || 0) >= CLOCK_SKEW_ALERT_SECONDS) {
    alerts.push({ id: 'clockSkew', severity: 'warning', values: { minutes: Math.round(Math.abs(connection!.server_skew_seconds!) / 60) }, actions: [] })
  }

  return alerts
}
