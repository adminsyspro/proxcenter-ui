import { describe, it, expect } from 'vitest'

import { ROLES } from '../../../prisma/roleCatalogue'

/**
 * Regression guard for issue #378 — "RBAC Scoping issue".
 *
 * After RBAC enforcement was tightened, a VM User (or any low-privilege role)
 * opening the Inventory window got "API error: 403". Root cause: the Inventory
 * page fetches /api/v1/connections (gated on connection.view) and VM detail
 * panels fetch /api/v1/connections/[id]/nodes (gated on node.view), but
 * role_vm_user held neither permission — only vm.* — so the whole inventory
 * tree was blanked by the 403.
 *
 * A VM User must be able to SEE the connection/node context of the VMs it is
 * allowed to use; the SSE stream + filterVmsByPermission still restrict the
 * actual VM list to its assigned scope.
 */
describe('role_vm_user — Inventory read permissions (issue #378)', () => {
  const vmUser = ROLES.find(r => r.id === 'role_vm_user')

  it('exists in the system-role catalogue', () => {
    expect(vmUser).toBeDefined()
  })

  it('grants connection.view so /api/v1/connections does not 403 (inventory tree renders)', () => {
    expect(vmUser?.permissions).toContain('connection.view')
  })

  it('grants node.view so /api/v1/connections/[id]/nodes does not 403 (VM detail panel loads)', () => {
    expect(vmUser?.permissions).toContain('node.view')
  })

  it('keeps vm.view so the inventory SSE stream still authorizes the user', () => {
    expect(vmUser?.permissions).toContain('vm.view')
  })
})

describe('role_tenant_admin — task center + events (issue #430)', () => {
  const tenantAdmin = ROLES.find(r => r.id === 'role_tenant_admin')

  it('exists in the system-role catalogue', () => {
    expect(tenantAdmin).toBeDefined()
  })

  it('can view the task center and events (shared tasks footer)', () => {
    expect(tenantAdmin?.permissions).toContain('tasks.view')
    expect(tenantAdmin?.permissions).toContain('events.view')
  })
})

/**
 * Issue #920: browsing storage content is gated on storage.content, and that
 * route also feeds the ISO and disk pickers of the guest wizards. Every
 * system role able to see guests must therefore carry it.
 */
describe('system roles with vm.view also browse storage content (issue #920)', () => {
  const explicit = ROLES.filter(r => !r.permissions.includes('*') && r.permissions.includes('vm.view'))

  it('covers the non-wildcard roles that see guests', () => {
    expect(explicit.map(r => r.id)).toEqual(expect.arrayContaining([
      'role_operator', 'role_vm_admin', 'role_viewer', 'role_vm_user',
      'role_tenant_admin', 'role_tenant_operator', 'role_tenant_viewer',
    ]))
  })

  it.each(explicit.map(r => [r.id, r] as const))('%s carries storage.content', (_id, role) => {
    expect(role.permissions).toContain('storage.content')
  })
})
