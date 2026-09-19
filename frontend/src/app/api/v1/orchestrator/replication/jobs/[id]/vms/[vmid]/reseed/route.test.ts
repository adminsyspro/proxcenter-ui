import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ permission: vi.fn(), job: vi.fn(), reseed: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: mocks.permission, PERMISSIONS: { AUTOMATION_MANAGE: 'automation.manage' } }))
vi.mock('@/lib/tenant', () => ({ getTenantConnectionIds: async () => new Set(['src', 'dst']) }))
vi.mock('@/lib/orchestrator/client', async importActual => ({
  ...await importActual<typeof import('@/lib/orchestrator/client')>(),
  getOrchestratorClient: () => ({ getReplicationJob: mocks.job, reseedReplicationJobVM: mocks.reseed }),
}))
import { POST } from './route'
const request = (body: unknown = { confirm: true }, vmid = '100') => POST(new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'job-1', vmid }) })
beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(null)
  mocks.job.mockResolvedValue({ data: { source_cluster: 'src', target_cluster: 'dst' } })
  mocks.reseed.mockResolvedValue({ data: { status: 'queued' } })
})
it('queues the confirmed guest reseed', async () => {
  const response = await request()
  expect(response.status).toBe(202)
  expect(await response.json()).toEqual({ status: 'queued' })
  expect(mocks.reseed).toHaveBeenCalledWith('job-1', 100)
})
it.each([{}, { confirm: false }, { confirm: 'true' }, null])('requires explicit boolean confirmation: %j', async body => {
  expect((await request(body)).status).toBe(400)
  expect(mocks.reseed).not.toHaveBeenCalled()
})
it.each(['0', '-1', '100abc', '1.5'])('rejects invalid guest identity %s', async vmid => {
  expect((await request({ confirm: true }, vmid)).status).toBe(400)
  expect(mocks.reseed).not.toHaveBeenCalled()
})
it('enforces manage permission before touching the job', async () => {
  mocks.permission.mockResolvedValue(new Response(null, { status: 403 }))
  expect((await request()).status).toBe(403)
  expect(mocks.job).not.toHaveBeenCalled()
  expect(mocks.reseed).not.toHaveBeenCalled()
})
it.each(['source_cluster', 'target_cluster'])('rejects a foreign %s', async field => {
  mocks.job.mockResolvedValue({ data: { source_cluster: 'src', target_cluster: 'dst', [field]: 'foreign' } })
  expect((await request()).status).toBe(404)
  expect(mocks.reseed).not.toHaveBeenCalled()
})
it('preserves upstream safety conflicts', async () => {
  mocks.reseed.mockRejectedValue(new Error('Orchestrator 409: {"error":"Recovery is active"}'))
  const response = await request()
  expect(response.status).toBe(409)
  expect(await response.json()).toEqual({ error: 'Recovery is active' })
})
