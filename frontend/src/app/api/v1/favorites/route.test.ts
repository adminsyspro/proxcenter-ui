import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  tenantId: 'default',
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { email: 'admin@example.com' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => m.tenantId }))

import { DELETE, GET, POST } from './route'

const favorite = { connectionId: 'conn-1', node: 'pve1', vmType: 'qemu', vmid: 100, vmName: 'web' }
const vmKey = 'conn-1:pve1:qemu:100'

beforeEach(async () => {
  await truncate(['favorites'])
  m.tenantId = 'default'
})

describe('favorites across tenants', () => {
  it('stars the same VM key in two tenants, each list keeping its own row', async () => {
    expect((await callRoute(POST, { body: favorite })).status).toBe(200)

    m.tenantId = 'tenant-b'
    const res = await callRoute(POST, { body: favorite })
    expect(res.status).toBe(200)

    const listed = await readJson<any>(await callRoute(GET, {}))
    expect(listed.data.map((f: any) => [f.vm_key, f.tenant_id])).toEqual([[vmKey, 'tenant-b']])
    expect(await prismaTest.favorite.count({ where: { vmKey } })).toBe(2)
  })

  it('removing the favorite in one tenant leaves the other tenant untouched', async () => {
    await callRoute(POST, { body: favorite })
    m.tenantId = 'tenant-b'
    await callRoute(POST, { body: favorite })

    const del = await callRoute(DELETE, { method: 'DELETE', searchParams: { vmKey } })
    expect(del.status).toBe(200)

    const rows = await prismaTest.favorite.findMany({ where: { vmKey } })
    expect(rows.map(r => r.tenantId)).toEqual(['default'])
  })

  it('answers 409 when the key is already starred in the current tenant', async () => {
    await callRoute(POST, { body: favorite })
    const res = await callRoute(POST, { body: favorite })
    expect(res.status).toBe(409)
  })

  it('answers 409 rather than 500 when a concurrent insert wins the unique key', async () => {
    const results = await Promise.all([callRoute(POST, { body: favorite }), callRoute(POST, { body: favorite })])
    expect(results.map(r => r.status).sort()).toEqual([200, 409])
    expect(await prismaTest.favorite.count({ where: { vmKey } })).toBe(1)
  })

  it('rejects a body without the VM identity', async () => {
    const res = await callRoute(POST, { body: { connectionId: 'conn-1' } })
    expect(res.status).toBe(400)
  })
})
