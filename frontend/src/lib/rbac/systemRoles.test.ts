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
