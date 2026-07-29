import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import {
  createBroadcast,
  deleteBroadcast,
  listActiveForPrincipal,
  listBroadcasts,
  updateBroadcast,
} from './broadcasts'

const NOW = new Date('2026-08-01T12:00:00.000Z')

const input = (over: Record<string, unknown> = {}) => ({
  message: 'Maintenance 22:00 UTC',
  linkUrl: null,
  linkLabel: null,
  bgColor: '#f59e0b',
  fgColor: '#000000',
  dismissible: true,
  enabled: true,
  startsAt: null,
  endsAt: null,
  targetKind: 'all' as const,
  targetIds: [] as string[],
  ...over,
})

const principal = { userId: 'u1', tenantId: 'tenant-a', roleIds: ['role_viewer'], legacyRole: null }

beforeEach(async () => {
  await truncate(['broadcast_messages'])
})

afterAll(async () => {
  await prismaTest.$disconnect()
})

describe('broadcast repository', () => {
  it('creates a row, stamps the author and lists it', async () => {
    const created = await createBroadcast(input(), 'admin-1')
    expect(created.createdBy).toBe('admin-1')
    const all = await listBroadcasts()
    expect(all).toHaveLength(1)
    expect(all[0].message).toBe('Maintenance 22:00 UTC')
  })

  it('orders the list by creation date, oldest first', async () => {
    await createBroadcast(input({ message: 'first' }), 'admin-1')
    await createBroadcast(input({ message: 'second' }), 'admin-1')
    expect((await listBroadcasts()).map(b => b.message)).toEqual(['first', 'second'])
  })

  it('updates a row and returns null for an unknown id', async () => {
    const created = await createBroadcast(input(), 'admin-1')
    const updated = await updateBroadcast(created.id, input({ message: 'changed' }))
    expect(updated?.message).toBe('changed')
    expect(await updateBroadcast('does-not-exist', input())).toBeNull()
  })

  it('deletes a row and reports an unknown id', async () => {
    const created = await createBroadcast(input(), 'admin-1')
    expect(await deleteBroadcast(created.id)).toBe(true)
    expect(await deleteBroadcast(created.id)).toBe(false)
  })

  it('returns only matching banners, stripped of targeting metadata', async () => {
    await createBroadcast(input({ message: 'everyone' }), 'admin-1')
    await createBroadcast(input({ message: 'tenant-b only', targetKind: 'tenants', targetIds: ['tenant-b'] }), 'admin-1')
    await createBroadcast(input({ message: 'off', enabled: false }), 'admin-1')

    const active = await listActiveForPrincipal(principal, NOW)

    expect(active.map(b => b.message)).toEqual(['everyone'])
    expect(Object.keys(active[0]).sort()).toEqual(
      ['bgColor', 'dismissible', 'fgColor', 'id', 'linkLabel', 'linkUrl', 'message', 'updatedAt'].sort(),
    )
  })

  it('excludes a banner whose window is closed', async () => {
    await createBroadcast(input({ message: 'expired', endsAt: new Date('2026-07-31T00:00:00.000Z') }), 'admin-1')
    expect(await listActiveForPrincipal(principal, NOW)).toEqual([])
  })
})
