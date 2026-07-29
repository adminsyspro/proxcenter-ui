import { describe, it, expect } from 'vitest'

import { matchesPrincipal, normaliseRoleId, normaliseTargetIds } from './targeting'
import type { BroadcastPrincipal, TargetableBroadcast } from './targeting'

const NOW = new Date('2026-08-01T12:00:00.000Z')

const principal = (over: Partial<BroadcastPrincipal> = {}): BroadcastPrincipal => ({
  userId: 'u1',
  tenantId: 'tenant-a',
  roleIds: ['role_tenant_admin'],
  legacyRole: null,
  ...over,
})

const banner = (over: Partial<TargetableBroadcast> = {}): TargetableBroadcast => ({
  enabled: true,
  startsAt: null,
  endsAt: null,
  targetKind: 'all',
  targetIds: [],
  ...over,
})

describe('normaliseTargetIds', () => {
  it('accepts a JSON array of strings and drops anything else', () => {
    expect(normaliseTargetIds(['a', 'b'])).toEqual(['a', 'b'])
    expect(normaliseTargetIds(['a', 1, null, '', 'b'])).toEqual(['a', 'b'])
  })

  it('returns an empty array for a non-array value', () => {
    expect(normaliseTargetIds(null)).toEqual([])
    expect(normaliseTargetIds('a')).toEqual([])
    expect(normaliseTargetIds({ a: 1 })).toEqual([])
  })
})

describe('normaliseRoleId', () => {
  it('prefixes a legacy role and leaves a prefixed one alone', () => {
    expect(normaliseRoleId('viewer')).toBe('role_viewer')
    expect(normaliseRoleId('role_viewer')).toBe('role_viewer')
  })

  it('falls back to role_viewer for an empty value', () => {
    expect(normaliseRoleId(null)).toBe('role_viewer')
    expect(normaliseRoleId('  ')).toBe('role_viewer')
  })
})

describe('matchesPrincipal', () => {
  it('matches an all-users banner', () => {
    expect(matchesPrincipal(banner(), principal(), NOW)).toBe(true)
  })

  it('skips a disabled banner', () => {
    expect(matchesPrincipal(banner({ enabled: false }), principal(), NOW)).toBe(false)
  })

  it('skips a banner that has not started', () => {
    const startsAt = new Date('2026-08-01T13:00:00.000Z')
    expect(matchesPrincipal(banner({ startsAt }), principal(), NOW)).toBe(false)
  })

  it('matches a banner whose window has started', () => {
    const startsAt = new Date('2026-08-01T11:00:00.000Z')
    expect(matchesPrincipal(banner({ startsAt }), principal(), NOW)).toBe(true)
  })

  it('skips an expired banner', () => {
    const endsAt = new Date('2026-08-01T11:59:59.000Z')
    expect(matchesPrincipal(banner({ endsAt }), principal(), NOW)).toBe(false)
  })

  it('matches a banner whose window has not closed yet', () => {
    const endsAt = new Date('2026-08-01T13:00:00.000Z')
    expect(matchesPrincipal(banner({ endsAt }), principal(), NOW)).toBe(true)
  })

  it('matches a tenant target only for the current tenant', () => {
    const b = banner({ targetKind: 'tenants', targetIds: ['tenant-a', 'tenant-c'] })
    expect(matchesPrincipal(b, principal({ tenantId: 'tenant-a' }), NOW)).toBe(true)
    expect(matchesPrincipal(b, principal({ tenantId: 'tenant-b' }), NOW)).toBe(false)
  })

  it('matches a role target when the role sets intersect', () => {
    const b = banner({ targetKind: 'roles', targetIds: ['role_tenant_admin'] })
    expect(matchesPrincipal(b, principal(), NOW)).toBe(true)
    expect(matchesPrincipal(b, principal({ roleIds: ['role_viewer'] }), NOW)).toBe(false)
  })

  it('falls back to the legacy role when the user has no RBAC grant', () => {
    // targetIds carry prefixed RBAC ids while User.role stores "viewer",
    // so the comparison only works after normalisation.
    const b = banner({ targetKind: 'roles', targetIds: ['role_viewer'] })
    expect(matchesPrincipal(b, principal({ roleIds: [], legacyRole: 'viewer' }), NOW)).toBe(true)
    expect(matchesPrincipal(b, principal({ roleIds: [], legacyRole: 'operator' }), NOW)).toBe(false)
  })

  it('ignores the legacy role when RBAC grants exist', () => {
    const b = banner({ targetKind: 'roles', targetIds: ['role_viewer'] })
    expect(matchesPrincipal(b, principal({ roleIds: ['role_tenant_admin'], legacyRole: 'viewer' }), NOW)).toBe(false)
  })

  it('never matches an unknown target kind', () => {
    expect(matchesPrincipal(banner({ targetKind: 'planets', targetIds: ['mars'] }), principal(), NOW)).toBe(false)
  })
})
