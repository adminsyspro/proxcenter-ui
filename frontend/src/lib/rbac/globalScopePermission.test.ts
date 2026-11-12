import { describe, expect, it } from 'vitest'
import { checkGrants, grantsPermission, isGlobalScopePermission } from './index'
import { emptyDenyInfraScope, isFlatRecordVisible } from './infraScope'

/**
 * Multi-tenant isolation hardening:
 *  - A tenant-wide admin permission checked without a resource must be
 *    satisfied ONLY by a global grant, never by a narrow node/vm/pool scope
 *    (the shape an SSO group mapping can produce).
 *  - The deny-everything infra scope must hide every record, so a failed
 *    principal resolution can fail closed instead of returning `null`
 *    ("unrestricted").
 */

const grant = (scopeType: string, scopeTarget: string | null, ...perms: string[]) => ({
  scopeType,
  scopeTarget,
  permissions: new Set(perms),
})

describe('S4 — resource-less admin permission demands a global grant', () => {
  it('denies admin.users held only on a node scope', () => {
    const grants = {
      superAdmin: false,
      byScope: [grant('node', 'conn-1:pve1', 'admin.users')],
    }
    expect(checkGrants(grants, 'admin.users')).toBe(false)
  })

  it('denies admin.rbac / admin.settings held only on a vDC pool scope', () => {
    const grants = {
      superAdmin: false,
      byScope: [grant('pool', 'conn-1:vdc-pool', 'admin.rbac', 'admin.settings')],
    }
    expect(checkGrants(grants, 'admin.rbac')).toBe(false)
    expect(checkGrants(grants, 'admin.settings')).toBe(false)
  })

  it('allows the same admin permission on a global grant', () => {
    const grants = {
      superAdmin: false,
      byScope: [grant('global', null, 'admin.users')],
    }
    expect(checkGrants(grants, 'admin.users')).toBe(true)
  })

  it('still scopes a non-admin permission narrowly (no regression)', () => {
    const grants = {
      superAdmin: false,
      byScope: [grant('vm', 'conn-1:pve1:qemu:110', 'vm.view')],
    }
    // resource-less vm.view keeps the legacy "any scope passes, list filtered
    // downstream" behaviour: a narrow viewer still reaches the list route.
    expect(checkGrants(grants, 'vm.view')).toBe(true)
    // but only its own VM matches when a resource is named.
    expect(checkGrants(grants, 'vm.view', 'vm', 'conn-1:pve1:qemu:110')).toBe(true)
    expect(checkGrants(grants, 'vm.view', 'vm', 'conn-1:pve1:qemu:999')).toBe(false)
  })

  it('a super admin bypasses the gate', () => {
    expect(checkGrants({ superAdmin: true, byScope: [] }, 'admin.users')).toBe(true)
  })
})

describe('S7 — empty deny scope hides every record', () => {
  it('returns false for any flat record', () => {
    const scope = emptyDenyInfraScope()
    expect(isFlatRecordVisible(scope, { connId: 'conn-1', node: 'pve1', vmid: '110' })).toBe(false)
    expect(isFlatRecordVisible(scope, { connId: 'conn-1' })).toBe(false)
  })
})

// Issue #1360: the read-only children of the admin rights stay tenant-wide.
describe('admin view permissions (admin.*.view)', () => {
  it('are global-scope permissions, like their parent; other children are not', () => {
    for (const p of ['admin.users.view', 'admin.rbac.view', 'admin.settings.view', 'admin.tenants.view']) {
      expect(isGlobalScopePermission(p), p).toBe(true)
    }
    expect(isGlobalScopePermission('admin.users')).toBe(true)
    expect(isGlobalScopePermission('vm.view')).toBe(false)
    expect(isGlobalScopePermission('sdn.vnet.view')).toBe(false)
    expect(isGlobalScopePermission('admin')).toBe(false)
  })

  it('are implied by their parent right', () => {
    expect(grantsPermission(new Set(['admin.users']), 'admin.users.view')).toBe(true)
    expect(grantsPermission(new Set(['admin.settings']), 'admin.settings.view')).toBe(true)
    expect(grantsPermission(new Set(['admin.users.view']), 'admin.users')).toBe(false)
  })

  it('need a global grant when checked without a resource, even through the parent', () => {
    const narrow = { superAdmin: false, byScope: [grant('node', 'conn-1:pve1', 'admin.users', 'admin.rbac.view')] }
    expect(checkGrants(narrow, 'admin.users.view')).toBe(false)
    expect(checkGrants(narrow, 'admin.rbac.view')).toBe(false)
    const global = { superAdmin: false, byScope: [grant('global', null, 'admin.users')] }
    expect(checkGrants(global, 'admin.users.view')).toBe(true)
  })
})
