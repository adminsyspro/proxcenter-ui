/**
 * Which /settings tabs a user sees. The tenant's own identity provider tab
 * (issue #1289) lives in a customer tenant only, for whoever holds
 * admin.identity there; the existing gates keep their meaning.
 */
import { describe, expect, it } from 'vitest'

import { isSettingsTabVisible } from './tabGating'

const ctx = (over: Record<string, unknown> = {}) => ({
  isSuperAdmin: false,
  isProviderTenant: false,
  licenseLoading: false,
  hasFeature: () => true,
  hasPermission: (p: string) => p === 'admin.identity',
  ...over,
})

const identityTab = { requiredFeature: 'oidc', customerTenantPermission: 'admin.identity' }

describe('the tenant identity provider tab', () => {
  it('shows in a customer tenant for a holder of admin.identity', () => {
    expect(isSettingsTabVisible(identityTab, ctx())).toBe(true)
  })

  it('never shows in the provider tenant, super admin included', () => {
    expect(isSettingsTabVisible(identityTab, ctx({ isProviderTenant: true, isSuperAdmin: true, hasPermission: () => true }))).toBe(false)
  })

  it('stays hidden without admin.identity', () => {
    expect(isSettingsTabVisible(identityTab, ctx({ hasPermission: () => false }))).toBe(false)
  })

  it('stays hidden without the licence feature', () => {
    expect(isSettingsTabVisible(identityTab, ctx({ hasFeature: () => false }))).toBe(false)
  })
})

describe('existing gates', () => {
  it('keeps providerOnly to a super admin in the provider tenant', () => {
    expect(isSettingsTabVisible({ providerOnly: true }, ctx({ isSuperAdmin: true, isProviderTenant: true }))).toBe(true)
    expect(isSettingsTabVisible({ providerOnly: true }, ctx({ isSuperAdmin: true }))).toBe(false)
    expect(isSettingsTabVisible({ providerOnly: true }, ctx({ isProviderTenant: true }))).toBe(false)
  })

  it('keeps superAdminOnly to a super admin, whatever the tenant', () => {
    expect(isSettingsTabVisible({ superAdminOnly: true }, ctx({ isSuperAdmin: true }))).toBe(true)
    expect(isSettingsTabVisible({ superAdminOnly: true }, ctx())).toBe(false)
  })

  it('keeps licence-gated tabs visible while the licence loads', () => {
    expect(isSettingsTabVisible({ requiredFeature: 'x' }, ctx({ licenseLoading: true, hasFeature: () => false }))).toBe(true)
  })
})
