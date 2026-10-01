import { describe, expect, it } from 'vitest'

import { buildLicenseAlerts, buildLicenseSummary } from './summary'
import type { LicenseStatus } from './summary'
import type { LicenseTableRow } from './view'

const NOW = Date.parse('2026-09-30T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (days: number) => new Date(NOW + days * DAY).toISOString()

const connected = {
  available: true, status: 'connected', portal_url: 'https://proxcenter.io', instance_name: 'Lab A', customer_name: 'Lab SAS',
  last_ok_at: at(-0.01), next_checkin_at: at(1), lease_until: at(30), held: [{ license_id: 'P1', kind: 'edition', label: 'Enterprise', lease_until: at(30) }],
}

const base = (over: Partial<LicenseStatus> = {}): LicenseStatus => ({
  licensed: true, edition: 'enterprise', license_id: 'P1', customer: { name: 'Jean', company: 'Lab SAS' },
  options: ['control_plane_ha'], limits: { max_nodes: 8 }, node_status: { current_nodes: 6, max_nodes: 8 },
  expires_at: at(365), binding: 'connected', connection: connected, ...over,
})

const row = (over: Partial<LicenseTableRow>): LicenseTableRow => ({
  rowId: 'primary', licenseId: 'P1', role: 'primary', edition: 'enterprise', licensedTo: 'Lab SAS', usedNodes: 6, maxNodes: 8,
  unlimited: false, expiresAt: at(365), clusterUuid: null, connectionIds: [], state: 'active', capabilities: [], ...over,
})

const ids = (status: LicenseStatus, extra = {}) => buildLicenseAlerts(status, extra, NOW).map(a => a.id)

describe('buildLicenseSummary', () => {
  it('describes a connected Enterprise license with its own limit, expiry and last sync (nominal)', () => {
    const s = buildLicenseSummary(base(), [row({})], NOW)

    expect(s).toMatchObject({
      state: 'licensed', edition: 'enterprise', customer: 'Lab SAS', options: ['control_plane_ha'], licenseCount: 1,
      nodes: { used: 6, max: 8, unlimited: false, fleet: false },
      validUntil: { date: at(365), days: 365, here: false, next: false, label: null, role: null },
      source: { kind: 'portal', lastSyncAt: connected.last_ok_at, failing: false, partner: null },
    })
  })

  it('names the partner that delivered a connected license, with its logo url versioned by digest', () => {
    const sha = 'a'.repeat(64)
    const withLogo = buildLicenseSummary(base({ connection: { ...connected, partner: { name: 'Partner SAS', has_logo: true, logo_sha256: sha } } }), [], NOW)
    expect(withLogo.source).toEqual({ kind: 'portal', lastSyncAt: connected.last_ok_at, failing: false, partner: { name: 'Partner SAS', logoUrl: `/api/v1/license/partner-logo?v=${sha}` } })
    const noLogo = buildLicenseSummary(base({ connection: { ...connected, partner: { name: 'Partner SAS', has_logo: false } } }), [], NOW)
    expect(noLogo.source).toMatchObject({ partner: { name: 'Partner SAS', logoUrl: null } })
    const file = buildLicenseSummary(base({ binding: 'install', connection: { ...connected, partner: { name: 'Partner SAS', has_logo: true, logo_sha256: sha } } }), [], NOW)
    expect(file.source).toEqual({ kind: 'file' })
  })

  it('shows Community with no facts when there is no license', () => {
    expect(buildLicenseSummary({ licensed: false, edition: 'community' }, [], NOW)).toMatchObject({ state: 'community', nodes: null, validUntil: null, source: null })
  })

  it('reads a file-bound license as activated by a file, with no mention of the portal', () => {
    expect(buildLicenseSummary(base({ binding: 'install', connection: null }), [], NOW).source).toEqual({ kind: 'file' })
  })

  it('reads a legacy floating key as a license key', () => {
    expect(buildLicenseSummary(base({ binding: 'floating', connection: null }), [], NOW).source).toEqual({ kind: 'key' })
  })

  it('never names the portal on an air-gapped instance, whatever the orchestrator reports', () => {
    expect(buildLicenseSummary(base({ offline: true, binding: 'install' }), [], NOW).source).toEqual({ kind: 'file' })
  })

  it('marks the portal source as failing while check-ins fail', () => {
    const s = buildLicenseSummary(base({ connection: { ...connected, status: 'disconnected' } }), [], NOW)

    expect(s.source).toMatchObject({ kind: 'portal', failing: true })
  })

  it('totals the fleet and names the customer whose license expires first (MSP)', () => {
    const rows = [
      row({}),
      row({ rowId: 'i1', licenseId: 'I1', role: 'import', licensedTo: 'Client Durand', expiresAt: at(200) }),
      row({ rowId: 'i2', licenseId: 'I2', role: 'import', licensedTo: 'Client Martin', expiresAt: at(500) }),
      row({ rowId: 'o1', licenseId: 'O1', role: 'option', expiresAt: at(10) }),
    ]
    const s = buildLicenseSummary(base({ node_status: { current_nodes: 38, max_nodes: 52 } }), rows, NOW)

    expect(s.nodes).toEqual({ used: 38, max: 52, unlimited: false, fleet: true })
    // The add-on expiring in 10 days is not the edition coverage.
    expect(s.validUntil).toEqual({ date: at(200), days: 200, here: false, next: true, label: 'Client Durand', role: 'import' })
    expect(s.licenseCount).toBe(4)
  })

  it('names the first license to expire by its proxcenter.io name when it has one', () => {
    const rows = [row({}), row({ rowId: 'i1', licenseId: 'I1', role: 'import', licensedTo: '', expiresAt: at(100) })]
    const status = base({ node_status: { current_nodes: 6, max_nodes: 18 }, connection: { ...connected, held: [...connected.held, { license_id: 'I1', label: 'Recette Enterprise 10' }] } })

    expect(buildLicenseSummary(status, rows, NOW).validUntil).toMatchObject({ next: true, label: 'Recette Enterprise 10', role: 'import' })
  })

  it('shows the grace end as "valid here until" when the primary license moved to another instance', () => {
    const status = base({ connection: { ...connected, held: [{ license_id: 'P1', lost: true, grace_until: at(2) }] } })

    expect(buildLicenseSummary(status, [], NOW).validUntil).toEqual({ date: at(2), days: 2, here: true, next: false, label: null, role: null })
  })

  it('reads a zero node limit as unlimited', () => {
    expect(buildLicenseSummary(base({ limits: { max_nodes: 0 } }), [], NOW).nodes?.unlimited).toBe(true)
  })
})

describe('buildLicenseAlerts', () => {
  it('stays silent when everything is fine', () => {
    expect(buildLicenseAlerts(base(), {}, NOW)).toEqual([])
  })

  it('reports check-ins failing with the lease end as the date the licenses keep working until', () => {
    const status = base({ connection: { ...connected, status: 'disconnected', consecutive_failures: 3, last_ok_at: at(-2), next_checkin_at: at(0.1) } })
    const [alert] = buildLicenseAlerts(status, {}, NOW)

    expect(alert).toEqual({
      id: 'syncFailing', severity: 'warning', actions: ['sync'],
      values: { since: at(-2), failures: 3, next: at(0.1), until: connected.lease_until },
    })
  })

  it('turns a failing sync red once the lease is running out', () => {
    const status = base({ connection: { ...connected, status: 'disconnected', lease_warn: true } })

    expect(buildLicenseAlerts(status, {}, NOW)[0]).toMatchObject({ id: 'syncFailing', severity: 'error' })
  })

  it('drops the lease sentence when the connection has no lease date', () => {
    const status = base({ connection: { ...connected, status: 'disconnected', lease_until: undefined } })

    expect(ids(status)).toEqual(['syncFailingNoLease'])
  })

  it('reports a license moved to another instance with the grace days left and where to act', () => {
    const status = base({ connection: { ...connected, held: [{ license_id: 'I9', label: 'Site B', lost: true, grace_until: at(2.5) }] } })

    expect(buildLicenseAlerts(status, {}, NOW)).toEqual([
      { id: 'moved', severity: 'warning', values: { label: 'Site B', days: 2, until: at(2.5) }, actions: ['openAccount'] },
    ])
  })

  it('does not report a moved license whose grace already ran out as still usable', () => {
    const status = base({ connection: { ...connected, held: [{ license_id: 'I9', lost: true, grace_until: at(-1) }] } })

    expect(ids(status)).toEqual([])
  })

  it('tells a lease that ended on a moved license apart from one that ended for lack of sync (D5)', () => {
    const moved = base({ licensed: false, lease_error: 'expired', lease_until: at(-1), connection: { ...connected, held: [{ license_id: 'P1', lost: true }] } })
    const unsynced = base({ licensed: false, lease_error: 'expired', lease_until: at(-1), connection: { ...connected, status: 'disconnected' } })

    expect(ids(moved)).toEqual(['movedEnded'])
    // The ended lease supersedes the failing-sync warning: one message, not two.
    expect(ids(unsynced)).toEqual(['leaseEnded'])
  })

  it('reports an expiring license with the renewal path that fits its source', () => {
    expect(buildLicenseAlerts(base({ expiration_warn: true, expires_at: at(12) }), {}, NOW)).toEqual([
      { id: 'expiring', severity: 'info', values: { date: at(12), days: 12 }, actions: ['renew'] },
    ])
    expect(ids(base({ expiration_warn: true, expires_at: at(12), binding: 'install', connection: null }))).toEqual(['expiringFile'])
  })

  it('reports an exceeded quota with how many nodes to remove', () => {
    const [alert] = buildLicenseAlerts(base({ node_status: { current_nodes: 10, max_nodes: 8, exceeded: true } }), {}, NOW)

    expect(alert).toEqual({ id: 'quota', severity: 'error', values: { used: 10, max: 8, over: 2 }, actions: ['addNodes'] })
  })

  it('reports a license bound to another server, from the status or a refused activation', () => {
    expect(ids(base({ binding_error: 'bound elsewhere' }))).toEqual(['binding'])
    expect(ids(base(), { bindingMismatch: true })).toEqual(['binding'])
  })

  it('reports a refused copy, a revoked instance and a changed identity with their recovery actions', () => {
    expect(buildLicenseAlerts(base({ connection: { ...connected, status: 'cloned' } }), {}, NOW)[0]).toMatchObject({ id: 'cloned', actions: ['resetIdentity', 'reconnect'] })
    expect(ids(base({ connection: { ...connected, status: 'revoked' } }))).toEqual(['revoked'])
    expect(ids(base({ connection: { ...connected, status: 'identity_changed' } }))).toEqual(['identityChanged'])
  })

  it('warns about clock skew from five minutes', () => {
    expect(ids(base({ connection: { ...connected, server_skew_seconds: 299 } }))).toEqual([])
    expect(buildLicenseAlerts(base({ connection: { ...connected, server_skew_seconds: -480 } }), {}, NOW)).toEqual([
      { id: 'clockSkew', severity: 'warning', values: { minutes: 8 }, actions: [] },
    ])
  })

  it('explains a connected instance that holds no license yet', () => {
    expect(ids({ licensed: false, edition: 'community', connection: { ...connected, held: [] } })).toEqual(['noLicense'])
  })

  it('ignores the connection entirely on an air-gapped instance', () => {
    expect(ids(base({ offline: true, connection: { ...connected, status: 'disconnected', server_skew_seconds: 900 } }))).toEqual([])
  })

  it('lists every problem worst first', () => {
    const status = base({
      expired: true, node_status: { current_nodes: 10, max_nodes: 8, exceeded: true },
      connection: { ...connected, status: 'disconnected', server_skew_seconds: 600 },
    })

    expect(ids(status)).toEqual(['quota', 'expired', 'syncFailing', 'clockSkew'])
  })
})
