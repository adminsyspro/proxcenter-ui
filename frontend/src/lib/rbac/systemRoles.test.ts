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

/**
 * Spec 6.4 of the API tokens write mode: deleting a PBS snapshot now needs
 * backup.delete, verifying one vm.backup, and a restore backup.restore.
 * The system roles that already administer the matching objects must carry
 * those keys, so no default role loses an action it is meant to have.
 */
describe('system roles keep the backup actions the routes now check (API tokens write, spec 6.4)', () => {
  const holds = (role: { permissions: string[] }, perm: string) =>
    role.permissions.includes('*') || role.permissions.includes(perm)
  const rows = (pred: (r: (typeof ROLES)[number]) => boolean) =>
    ROLES.filter(pred).map(r => [r.id, r] as const)

  it.each(rows(r => holds(r, 'backup.job.delete')))('%s holds backup.job.delete, so backup.delete', (_id, role) => {
    expect(holds(role, 'backup.delete')).toBe(true)
  })

  it.each(rows(r => holds(r, 'vm.backup') && holds(r, 'vm.create')))('%s holds vm.backup and vm.create, so backup.restore', (_id, role) => {
    expect(holds(role, 'backup.restore')).toBe(true)
  })

  it.each(rows(r => holds(r, 'backup.job.edit')))('%s holds backup.job.edit, so backup.job.run', (_id, role) => {
    expect(holds(role, 'backup.job.run')).toBe(true)
  })

  const role = (id: string) => ROLES.find(r => r.id === id)!

  // The roles that delete and verify PBS snapshots and restore today keep doing it.
  it.each(['role_vm_admin', 'role_operator'])('%s keeps PBS snapshot delete and verify', (id) => {
    expect(role(id).permissions).toEqual(expect.arrayContaining(['backup.delete', 'vm.backup']))
  })

  // Neither held backup.job.run before: keeping those actions must not widen
  // them to running backup jobs.
  it.each(['role_vm_admin', 'role_operator'])('%s does not run backup jobs', (id) => {
    expect(role(id).permissions).not.toContain('backup.job.run')
  })

  it.each(['role_vm_admin', 'role_operator'])('%s keeps restore', (id) => {
    expect(role(id).permissions).toContain('backup.restore')
  })

  // Read-only roles losing PBS snapshot delete and verify is the fix itself.
  it.each(['role_viewer', 'role_tenant_viewer', 'role_tenant_operator'])('%s can neither delete nor verify PBS snapshots', (id) => {
    expect(role(id).permissions).not.toContain('backup.delete')
    expect(role(id).permissions).not.toContain('vm.backup')
    expect(role(id).permissions).not.toContain('backup.job.run')
  })
})
