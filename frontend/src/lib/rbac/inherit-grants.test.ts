import { describe, it, expect, vi, beforeEach } from 'vitest'

// loadUserGrants is internal; we exercise it end-to-end through
// filterVmsByPermission, mocking the Prisma client the way the route tests do.
// vi.hoisted keeps the mock fns available inside the hoisted vi.mock factory.
const { findFirstMock, roleFindManyMock, permFindManyMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn<(...a: any[]) => Promise<any>>(),
  roleFindManyMock: vi.fn<(...a: any[]) => Promise<any>>(),
  permFindManyMock: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacUserRole: { findFirst: findFirstMock, findMany: roleFindManyMock },
    rbacUserPermission: { findMany: permFindManyMock },
  },
}))

import { filterVmsByPermission, PERMISSIONS } from './index'

const dbVm = { id: 'c1:qemu:n1:100', tags: ['db'] }
const webVm = { id: 'c1:qemu:n1:101', tags: ['web'] }

describe('loadUserGrants inherit expansion (issue #383)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findFirstMock.mockResolvedValue(null) // not a super admin
    permFindManyMock.mockResolvedValue([])
  })

  it('an inherit assignment applies the role default tag scope', async () => {
    roleFindManyMock.mockResolvedValue([
      {
        scopeType: 'inherit',
        scopeTarget: null,
        role: {
          defaultScopes: [{ scopeType: 'tag', scopeTarget: 'db' }],
          permissions: [{ permission: { name: PERMISSIONS.VM_VIEW } }],
        },
      },
    ])

    const result = await filterVmsByPermission('u1', [dbVm, webVm], PERMISSIONS.VM_VIEW)

    expect(result).toEqual([dbVm]) // only the db-tagged VM survives
  })

  it('an inherit assignment on a role with no default scope is global', async () => {
    roleFindManyMock.mockResolvedValue([
      {
        scopeType: 'inherit',
        scopeTarget: null,
        role: {
          defaultScopes: null,
          permissions: [{ permission: { name: PERMISSIONS.VM_VIEW } }],
        },
      },
    ])

    const result = await filterVmsByPermission('u1', [dbVm, webVm], PERMISSIONS.VM_VIEW)

    expect(result).toEqual([dbVm, webVm]) // global -> everything visible
  })

  it('an explicit scope on the assignment overrides the role default', async () => {
    roleFindManyMock.mockResolvedValue([
      {
        scopeType: 'tag',
        scopeTarget: 'web',
        role: {
          defaultScopes: [{ scopeType: 'tag', scopeTarget: 'db' }],
          permissions: [{ permission: { name: PERMISSIONS.VM_VIEW } }],
        },
      },
    ])

    const result = await filterVmsByPermission('u1', [dbVm, webVm], PERMISSIONS.VM_VIEW)

    expect(result).toEqual([webVm]) // explicit web scope wins over the db default
  })
})
