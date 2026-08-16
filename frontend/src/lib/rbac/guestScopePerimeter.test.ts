import { describe, expect, it, vi, beforeEach } from 'vitest'

const { headersMock, getServerSessionMock } = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getServerSessionMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { setCachedInventory, invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import {
  getAccessiblePools,
  getGuestScopePerimeter,
  getGuestVisibleConnectionIds,
  PERMISSIONS,
} from './index'

// Issue #262: a caller holding only flat scopes (vm/tag/pool) can never match a
// connection-scoped permission check, which used to 403 them out of the routes
// the Create VM wizard needs. The perimeter below is the fallback those routes
// use, so it must be exact in both directions: wide enough to unblock the
// wizard, narrow enough never to hand over a cluster the caller cannot see.

const USER = 'user-perimeter'

/** Two clusters: the caller's guest sits on conn-1/node1, conn-2 is foreign. */
const primeInventory = () =>
  setCachedInventory(
    {
      storages: [],
      clusters: [
        {
          id: 'conn-1',
          nodes: [
            { node: 'node1', guests: [{ type: 'qemu', vmid: 100, pool: 'district-a', tags: 'prod' }] },
            { node: 'node2', guests: [{ type: 'qemu', vmid: 101, pool: 'district-b' }] },
          ],
        },
        {
          id: 'conn-2',
          nodes: [{ node: 'other1', guests: [{ type: 'qemu', vmid: 200, pool: 'district-b' }] }],
        },
      ],
    } as any,
    'default',
  )

async function seedGrants(
  scopes: Array<{ scopeType: string; scopeTarget: string | null; permissions: string[] }>,
) {
  const now = new Date()
  await prismaTest.user.create({
    data: { id: USER, email: 'perimeter@test.local', createdAt: now, updatedAt: now },
  })

  const permissionIds = new Map<string, string>()
  let seq = 0

  for (const scope of scopes) {
    for (const permission of scope.permissions) {
      if (!permissionIds.has(permission)) {
        const id = `perm_${permissionIds.size}`
        permissionIds.set(permission, id)
        await prismaTest.rbacPermission.create({
          data: { id, name: permission, category: permission.split('.')[0] },
        })
      }
      await prismaTest.rbacUserPermission.create({
        data: {
          id: `grant-${seq++}`,
          userId: USER,
          permissionId: permissionIds.get(permission) as string,
          scopeType: scope.scopeType,
          scopeTarget: scope.scopeTarget,
          tenantId: 'default',
          grantedAt: now,
        },
      })
    }
  }
}

const poolScoped = () =>
  seedGrants([
    {
      scopeType: 'pool',
      scopeTarget: 'district-a',
      permissions: [PERMISSIONS.VM_VIEW, PERMISSIONS.VM_CREATE, PERMISSIONS.CONNECTION_VIEW],
    },
  ])

beforeEach(async () => {
  vi.clearAllMocks()
  headersMock.mockResolvedValue(new Headers())
  getServerSessionMock.mockResolvedValue(null)
  invalidateInventoryCache()
  await truncate(['api_tokens', 'tenants', 'users', 'rbac_permissions'])
  await seedDefaultTenant()
})

describe('getGuestScopePerimeter, flat-scoped caller', () => {
  it('opens the connection hosting their guest and reports its pool and node', async () => {
    await poolScoped()
    primeInventory()

    const perimeter = await getGuestScopePerimeter(USER, 'conn-1', PERMISSIONS.CONNECTION_VIEW, 'default')

    expect(perimeter.restricted).toBe(true)
    expect(perimeter.holdsPermission).toBe(true)
    expect(perimeter.hasVisibleGuests).toBe(true)
    expect([...perimeter.pools]).toEqual(['district-a'])
    expect([...perimeter.nodes]).toEqual(['node1'])
  })

  it('stays shut on a connection where they own nothing', async () => {
    await poolScoped()
    primeInventory()

    const perimeter = await getGuestScopePerimeter(USER, 'conn-2', PERMISSIONS.CONNECTION_VIEW, 'default')

    expect(perimeter.restricted).toBe(true)
    expect(perimeter.hasVisibleGuests).toBe(false)
    expect([...perimeter.nodes]).toEqual([])
  })

  it('fails closed on an inventory cache miss', async () => {
    await poolScoped()
    // no primeInventory() on purpose

    const perimeter = await getGuestScopePerimeter(USER, 'conn-1', PERMISSIONS.CONNECTION_VIEW, 'default')

    expect(perimeter.restricted).toBe(true)
    expect(perimeter.hasVisibleGuests).toBe(false)
    // The pool grant is still reported: the gate is what refuses, not the list.
    expect([...perimeter.pools]).toEqual(['district-a'])
  })

  it('reports holdsPermission false when no grant carries the permission', async () => {
    await seedGrants([
      { scopeType: 'pool', scopeTarget: 'district-a', permissions: [PERMISSIONS.VM_VIEW] },
    ])
    primeInventory()

    const perimeter = await getGuestScopePerimeter(USER, 'conn-1', PERMISSIONS.CONNECTION_VIEW, 'default')

    expect(perimeter.holdsPermission).toBe(false)
    // Guests are still visible; the route is what turns this into a 403.
    expect(perimeter.hasVisibleGuests).toBe(true)
  })

  it('derives the pools from the guests for a tag scope, which has no pool grant', async () => {
    await seedGrants([
      {
        scopeType: 'tag',
        scopeTarget: 'prod',
        permissions: [PERMISSIONS.VM_VIEW, PERMISSIONS.CONNECTION_VIEW],
      },
    ])
    primeInventory()

    const perimeter = await getGuestScopePerimeter(USER, 'conn-1', PERMISSIONS.CONNECTION_VIEW, 'default')

    expect(perimeter.hasVisibleGuests).toBe(true)
    // Only the tagged guest counts, so district-b never shows up.
    expect([...perimeter.pools]).toEqual(['district-a'])
    expect([...perimeter.nodes]).toEqual(['node1'])
  })
})

describe('getGuestScopePerimeter, callers that must not be narrowed', () => {
  it('an infra grant outranks a pool grant held at the same time', async () => {
    await seedGrants([
      { scopeType: 'connection', scopeTarget: 'conn-1', permissions: [PERMISSIONS.CONNECTION_VIEW] },
      { scopeType: 'pool', scopeTarget: 'district-a', permissions: [PERMISSIONS.CONNECTION_VIEW] },
    ])
    primeInventory()

    const perimeter = await getGuestScopePerimeter(USER, 'conn-1', PERMISSIONS.CONNECTION_VIEW, 'default')

    expect(perimeter.restricted).toBe(false)
    expect(perimeter.holdsPermission).toBe(true)
  })

  it('a global grant is never narrowed', async () => {
    await seedGrants([
      { scopeType: 'global', scopeTarget: null, permissions: [PERMISSIONS.CONNECTION_VIEW] },
    ])
    primeInventory()

    const perimeter = await getGuestScopePerimeter(USER, 'conn-1', PERMISSIONS.CONNECTION_VIEW, 'default')

    expect(perimeter.restricted).toBe(false)
  })
})

describe('getAccessiblePools', () => {
  it('returns the caller own pools on that connection', async () => {
    await poolScoped()
    primeInventory()

    const accessible = await getAccessiblePools(USER, 'conn-1', 'default')

    expect(accessible.restricted).toBe(true)
    expect([...accessible.pools]).toEqual(['district-a'])
  })

  it('reports no narrowing for a connection-scoped caller', async () => {
    await seedGrants([
      { scopeType: 'connection', scopeTarget: 'conn-1', permissions: [PERMISSIONS.CONNECTION_VIEW] },
    ])
    primeInventory()

    const accessible = await getAccessiblePools(USER, 'conn-1', 'default')

    expect(accessible.restricted).toBe(false)
    expect([...accessible.pools]).toEqual([])
  })
})

describe('getGuestVisibleConnectionIds', () => {
  it('keeps only the connections hosting a visible guest', async () => {
    await poolScoped()
    primeInventory()

    expect([...(await getGuestVisibleConnectionIds(USER, 'default'))]).toEqual(['conn-1'])
  })

  it('returns nothing on a cache miss', async () => {
    await poolScoped()

    expect([...(await getGuestVisibleConnectionIds(USER, 'default'))]).toEqual([])
  })
})
