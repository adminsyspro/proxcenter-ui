import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  denied: null as Response | null,
  prisma: { migrationJob: { findUnique: vi.fn() } },
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: 'vm.migrate' } }))
vi.mock('@/lib/tenant', () => ({ getSessionPrisma: vi.fn(async () => h.prisma), getCurrentTenantId: vi.fn() }))
vi.mock('@/lib/tenant/infraScope', () => ({ canMigrateConnections: vi.fn(), getTenantInfrastructureScope: vi.fn() }))

import { GET } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const row = { id: 'j1', status: 'transferring', bytesTransferred: BigInt(10), totalBytes: BigInt(20), logs: [{ msg: 'a' }, { msg: 'b' }, { msg: 'c' }] }

beforeEach(() => {
  h.denied = null
  h.prisma.migrationJob.findUnique.mockReset().mockResolvedValue(row)
})

describe('GET /api/v1/migrations/[id]', () => {
  it('sends the whole log on a first read', async () => {
    const body: any = await readJson(await callRoute(GET, { params: { id: 'j1' } }))

    expect(body.data).toMatchObject({ id: 'j1', bytesTransferred: 10, totalBytes: 20, logOffset: 0, logCount: 3 })
    expect(body.data.logs).toHaveLength(3)
  })

  it('sends only the lines past ?after=', async () => {
    const body: any = await readJson(await callRoute(GET, { params: { id: 'j1' }, searchParams: { after: '2' } }))

    expect(body.data.logs).toEqual([{ msg: 'c' }])
    expect(body.data).toMatchObject({ logOffset: 2, logCount: 3 })
  })

  it('answers 404 for an unknown job and passes a refusal through', async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(null)
    expect((await callRoute(GET, { params: { id: 'nope' } })).status).toBe(404)

    h.denied = new Response('no', { status: 403 })
    expect((await callRoute(GET, { params: { id: 'j1' } })).status).toBe(403)
  })
})
