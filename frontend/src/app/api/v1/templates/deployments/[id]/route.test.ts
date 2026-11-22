import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  findUnique: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  principal: { value: undefined as any },
}))

vi.mock('@/lib/tenant', () => ({ getSessionPrisma: async () => ({ deployment: { findUnique: m.findUnique, delete: vi.fn() } }) }))
vi.mock('@/lib/rbac', () => ({ checkPermission: m.checkPermission, PERMISSIONS: { VM_VIEW: 'vm.view', VM_CREATE: 'vm.create' } }))
// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts;
// here it only hands the handler the principal a test sets.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_id: string, handler: any) => (req: Request, ctx: any) => handler(req, { ...(ctx ?? {}), principal: m.principal.value }),
}))

import { GET } from './route'

const row = {
  id: 'dep-1', tenantId: 'tenant-1', connectionId: 'conn-a', node: 'pve1', vmid: 190, vmName: 'web-01',
  imageSlug: 'debian-12', status: 'completed', currentStep: null, error: null, taskUpid: null,
  config: { storage: 'ceph', cloudInit: { ciuser: 'ops', cipassword: 's3cret' } },
  startedAt: new Date('2026-11-21T10:00:00Z'), completedAt: new Date('2026-11-21T10:02:00Z'),
}
const token = (connectionIds: string[] | null) => ({ kind: 'token', tokenId: 't1', tenantId: 'tenant-1', connectionIds })
const get = () => callRoute(GET as any, { method: 'GET', params: { id: 'dep-1' } })

beforeEach(() => {
  m.findUnique.mockReset().mockResolvedValue(row)
  m.checkPermission.mockReset().mockResolvedValue(null)
  m.principal.value = undefined
})

describe('GET /api/v1/templates/deployments/[id] (roadmap#265)', () => {
  it('404 on a deployment the scoped client does not return (another tenant)', async () => {
    m.findUnique.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
  })

  it('404 for a token restricted to connections that do not hold the deployment', async () => {
    m.principal.value = token(['conn-b'])
    const res = await get()
    expect(res.status).toBe(404)
    expect(await readJson<any>(res)).toEqual({ error: 'Deployment not found' })
  })

  it('gives a token the progress of the deployment, never its stored config', async () => {
    m.principal.value = token(['conn-a'])
    const json = await readJson<any>(await get())
    expect(json.data).toMatchObject({ id: 'dep-1', status: 'completed', vmid: 190, node: 'pve1', connectionId: 'conn-a', vmName: 'web-01' })
    expect(json.data.config).toBeUndefined()
    expect(JSON.stringify(json)).not.toContain('s3cret')
  })

  it('gives a session caller the stored config without the cloud-init password', async () => {
    const json = await readJson<any>(await get())
    expect(json.data.config).toEqual({ storage: 'ceph', cloudInit: { ciuser: 'ops' } })
  })
})
