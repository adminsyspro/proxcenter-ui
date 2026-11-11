import { describe, expect, it } from 'vitest'

import {
  buildTenantCeiling,
  ceilingViolations,
  isRoleAssignableInTenant,
  isRoleAudience,
  isRoleAvailableInTenant,
  parsePublicationInput,
  publicationFields,
  tenantCatalogueFilter,
  type PublishableRole,
} from './rolePublication'

const custom = (over: Partial<PublishableRole> = {}): PublishableRole => ({
  isSystem: false,
  tenantId: 'default',
  audience: null,
  publishAll: false,
  publications: [],
  ...over,
})

describe('isRoleAvailableInTenant (ui#1336)', () => {
  it('lets a system role, or any role without an owner tenant, through everywhere', () => {
    expect(isRoleAvailableInTenant({ isSystem: true, tenantId: null }, 't1')).toBe(true)
    expect(isRoleAvailableInTenant({ isSystem: false, tenantId: null }, 't1')).toBe(true)
    expect(isRoleAvailableInTenant({ isSystem: false, tenantId: undefined as unknown as string }, 't1')).toBe(true)
  })

  it('keeps a legacy role to its own tenant, plus the publications grandfathered by the migration', () => {
    expect(isRoleAvailableInTenant(custom({ tenantId: 't1' }), 't1')).toBe(true)
    expect(isRoleAvailableInTenant(custom({ tenantId: 't1' }), 't2')).toBe(false)
    expect(isRoleAvailableInTenant(custom(), 'default')).toBe(true)
    expect(isRoleAvailableInTenant(custom(), 't1')).toBe(false)
    expect(isRoleAvailableInTenant(custom({ publications: [{ tenantId: 't1' }] }), 't1')).toBe(true)
    // A customer-owned legacy role never reaches another customer, publication or not.
    expect(isRoleAvailableInTenant(custom({ tenantId: 't2', publications: [{ tenantId: 't1' }] }), 't1')).toBe(false)
  })

  it('holds a provider role in the provider tenant only', () => {
    const role = custom({ audience: 'provider' })
    expect(isRoleAvailableInTenant(role, 'default')).toBe(true)
    expect(isRoleAvailableInTenant(role, 't1')).toBe(false)
  })

  it('holds a published role in its customer tenants, never in the provider tenant', () => {
    for (const audience of ['service_desk', 'tenant']) {
      const listed = custom({ audience, publications: [{ tenantId: 't1' }] })
      expect(isRoleAvailableInTenant(listed, 't1')).toBe(true)
      expect(isRoleAvailableInTenant(listed, 't2')).toBe(false)
      expect(isRoleAvailableInTenant(listed, 'default')).toBe(false)
      const all = custom({ audience, publishAll: true })
      expect(isRoleAvailableInTenant(all, 't9')).toBe(true)
      expect(isRoleAvailableInTenant(all, 'default')).toBe(false)
    }
  })
})

describe('isRoleAssignableInTenant', () => {
  it('never offers a service desk role through the per-tenant routes', () => {
    expect(isRoleAssignableInTenant(custom({ audience: 'service_desk', publishAll: true }), 't1')).toBe(false)
  })

  it('offers a tenant role where it is published', () => {
    const role = custom({ audience: 'tenant', publications: [{ tenantId: 't1' }] })
    expect(isRoleAssignableInTenant(role, 't1')).toBe(true)
    expect(isRoleAssignableInTenant(role, 't2')).toBe(false)
  })

  it('does not extend a grandfathered SSO publication to the assignment routes', () => {
    const role = custom({ publications: [{ tenantId: 't1' }] })
    expect(isRoleAssignableInTenant(role, 't1')).toBe(false)
    expect(isRoleAssignableInTenant(role, 'default')).toBe(true)
  })

  it('keeps system roles assignable', () => {
    expect(isRoleAssignableInTenant({ isSystem: true, tenantId: null }, 't1')).toBe(true)
  })
})

describe('permission ceiling', () => {
  const ceiling = buildTenantCeiling(['vm.view', 'vm.config', 'backup.view', 'admin.users'])

  it('accepts what the Tenant Admin role carries, children of its parents and the NIC identity rights', () => {
    expect(ceilingViolations(['vm.view', 'vm.config.media', 'vm.config.nic.mac', 'vm.config.nic.vlan', 'admin.users'], ceiling)).toEqual([])
  })

  it('names, sorted and once, the provider-only permissions', () => {
    expect(ceilingViolations(['connection.manage', 'admin.tenants', 'vm.view', 'admin.tenants'], ceiling)).toEqual([
      'admin.tenants',
      'connection.manage',
    ])
  })
})

describe('parsePublicationInput', () => {
  it('reads a legacy payload as no audience', () => {
    expect(parsePublicationInput({})).toEqual({ ok: true, value: { audience: null, publishAll: false, tenantIds: [] } })
  })

  it('refuses an unknown audience', () => {
    expect(parsePublicationInput({ audience: 'god' })).toMatchObject({ ok: false, error: 'Unknown role audience: god' })
  })

  it('refuses a publication on a role that is not published', () => {
    expect(parsePublicationInput({ audience: 'provider', publish_all: true }).ok).toBe(false)
    expect(parsePublicationInput({ audience: null, published_tenants: ['t1'] }).ok).toBe(false)
  })

  it('refuses a malformed tenant list and the provider tenant', () => {
    expect(parsePublicationInput({ audience: 'tenant', published_tenants: 't1' }).ok).toBe(false)
    expect(parsePublicationInput({ audience: 'tenant', published_tenants: ['default'] })).toMatchObject({ ok: false })
  })

  it('dedupes and trims the list, and drops it when published to all', () => {
    expect(parsePublicationInput({ audience: 'tenant', published_tenants: [' t1 ', 't1', 't2', 3, ''] }).value).toEqual({
      audience: 'tenant',
      publishAll: false,
      tenantIds: ['t1', 't2'],
    })
    expect(parsePublicationInput({ audience: 'service_desk', publish_all: true, published_tenants: ['t1'] }).value).toEqual({
      audience: 'service_desk',
      publishAll: true,
      tenantIds: [],
    })
  })

  it('accepts a provider role', () => {
    expect(parsePublicationInput({ audience: 'provider' }).value).toEqual({ audience: 'provider', publishAll: false, tenantIds: [] })
  })
})

describe('wire helpers', () => {
  it('shows the publication to the provider only', () => {
    const role = { audience: 'tenant', publishAll: false, publications: [{ tenantId: 't2' }, { tenantId: 't1' }] }
    expect(publicationFields(role, true)).toEqual({ audience: 'tenant', publish_all: false, published_tenants: ['t1', 't2'] })
    expect(publicationFields(role, false)).toEqual({ audience: 'tenant', publish_all: null, published_tenants: null })
    expect(publicationFields({}, true)).toEqual({ audience: null, publish_all: false, published_tenants: [] })
  })

  it('filters the tenant catalogue on the audience and the publication', () => {
    expect(tenantCatalogueFilter('t1')).toEqual({
      audience: 'tenant',
      OR: [{ publishAll: true }, { publications: { some: { tenantId: 't1' } } }],
    })
  })

  it('recognises the audiences', () => {
    expect(isRoleAudience('service_desk')).toBe(true)
    expect(isRoleAudience('admin')).toBe(false)
    expect(isRoleAudience(null)).toBe(false)
  })
})
