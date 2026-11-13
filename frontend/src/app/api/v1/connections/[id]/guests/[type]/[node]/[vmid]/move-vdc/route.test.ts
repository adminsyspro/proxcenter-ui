import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  tenant: { id: 'acme' },
  getMoveOptions: vi.fn(),
  planMove: vi.fn(),
  startMove: vi.fn(),
  follow: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}:${node}:${type}:${vmid}`,
  PERMISSIONS: { VM_MOVE_VDC: 'vm.move_vdc' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => h.tenant.id }))
vi.mock('@/lib/auth/principal', () => ({ getPrincipal: async () => ({ principal: { userEmail: 'ops@acme.test' } }) }))
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_spec: any, handler: any) => handler }))
vi.mock('@/lib/vdc/move/runner', () => ({ followMoveInBackground: h.follow }))
vi.mock('@/lib/vdc/move/service', async (orig) => ({
  ...(await orig<any>()),
  getMoveOptions: h.getMoveOptions,
  planMove: h.planMove,
  startMove: h.startMove,
}))

import { GET, POST } from './route'
import { MoveRequestError } from '@/lib/vdc/move/service'

const ctx = (over: Partial<Record<'id' | 'type' | 'node' | 'vmid', string>> = {}) => ({
  params: Promise.resolve({ id: 'conn-a', type: 'qemu', node: 'pve1', vmid: '105', ...over }),
})
const post = (body: unknown) => new Request('http://x/move-vdc', { method: 'POST', body: JSON.stringify(body) })
const BODY = { targetVdcId: 'vdc-dst', storageMap: { 'ceph-gold': 'nvme-gold' }, bridgeMap: { tnet01: 'tnet01' }, online: true }

beforeEach(() => {
  vi.clearAllMocks()
  h.tenant.id = 'acme'
  h.checkPermission.mockResolvedValue(null)
})

describe('GET move-vdc', () => {
  it('answers the options for the tenant, as a tenant actor', async () => {
    h.getMoveOptions.mockResolvedValue({ targets: [] })
    const res = await GET(new Request('http://x/move-vdc?targetVdcId=vdc-dst'), ctx())
    expect(res.status).toBe(200)
    expect(h.checkPermission).toHaveBeenCalledWith('vm.move_vdc', 'vm', 'conn-a:pve1:qemu:105')
    expect(h.getMoveOptions).toHaveBeenCalledWith({ tenantId: 'acme', isProvider: false, userEmail: 'ops@acme.test' }, 'conn-a', 'pve1', 105, 'vdc-dst')
  })

  it('acts as the provider in the default tenant', async () => {
    h.tenant.id = 'default'
    h.getMoveOptions.mockResolvedValue({})
    await GET(new Request('http://x/move-vdc'), ctx())
    expect(h.getMoveOptions.mock.calls[0][0]).toMatchObject({ isProvider: true })
  })

  it('refuses a container, a bad identifier and a missing permission before any lookup', async () => {
    expect((await GET(new Request('http://x'), ctx({ type: 'lxc' }))).status).toBe(400)
    expect((await GET(new Request('http://x'), ctx({ vmid: '1;rm' }))).status).toBe(400)
    expect((await GET(new Request('http://x?targetVdcId=../../x'), ctx())).status).toBe(400)
    h.checkPermission.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await GET(new Request('http://x'), ctx())).status).toBe(403)
    expect(h.getMoveOptions).not.toHaveBeenCalled()
  })

  it('maps a service refusal to its status, and hides an unexpected error', async () => {
    h.getMoveOptions.mockRejectedValue(new MoveRequestError(404, 'GUEST_NOT_FOUND', 'Guest not found'))
    const res = await GET(new Request('http://x'), ctx())
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Guest not found', code: 'GUEST_NOT_FOUND' })

    vi.spyOn(console, 'error').mockImplementation(() => {})
    h.getMoveOptions.mockRejectedValue(new Error('connect ECONNREFUSED 10.42.0.111:8006'))
    const hidden = await GET(new Request('http://x'), ctx())
    expect(hidden.status).toBe(500)
    expect(JSON.stringify(await hidden.json())).not.toContain('10.42')
  })
})

describe('POST move-vdc', () => {
  it('answers 409 with the blockers and starts nothing', async () => {
    h.planMove.mockResolvedValue({ blockers: [{ code: 'SNAPSHOTS_PRESENT', context: { count: 2 } }], plan: null })
    const res = await POST(post(BODY), ctx())
    expect(res.status).toBe(409)
    expect((await res.json()).blockers).toEqual([{ code: 'SNAPSHOTS_PRESENT', context: { count: 2 } }])
    expect(h.startMove).not.toHaveBeenCalled()
  })

  it('starts the move and follows it in the background', async () => {
    const plan = { source: { vdc: { tenantId: 'acme' } }, target: { id: 'vdc-dst', name: 'Lyon' }, online: true }
    h.planMove.mockResolvedValue({ blockers: [], plan })
    h.startMove.mockImplementation(async (_p: any, _a: any, _o: any, onCopying: (id: string) => void) => {
      onCopying('m1')
      return { moveId: 'm1', upid: 'UPID:x', stopping: false }
    })
    const res = await POST(post(BODY), ctx())
    expect(res.status).toBe(202)
    expect((await res.json()).data).toEqual({ moveId: 'm1', status: 'copying', targetVdc: { id: 'vdc-dst', name: 'Lyon' }, online: true })
    expect(h.planMove).toHaveBeenCalledWith(expect.objectContaining({ isProvider: false }), 'conn-a', 'pve1', 105, BODY)
    expect(h.startMove).toHaveBeenCalledWith(plan, expect.anything(), 'tenant', expect.any(Function))
    expect(h.follow).toHaveBeenCalledWith('m1', 'acme')
  })

  it('answers stopping when the guest is shut down first', async () => {
    const plan = { source: { vdc: { tenantId: 'acme' } }, target: { id: 'vdc-dst', name: 'Lyon' }, online: false }
    h.planMove.mockResolvedValue({ blockers: [], plan })
    h.startMove.mockResolvedValue({ moveId: 'm2', upid: null, stopping: true })
    const res = await POST(post({ ...BODY, online: false }), ctx())
    expect((await res.json()).data.status).toBe('stopping')
    expect(h.planMove.mock.calls[0][4].online).toBe(false)
  })

  it('refuses a malformed body or mapping', async () => {
    expect((await POST(post({ ...BODY, targetVdcId: 5 }), ctx())).status).toBe(400)
    expect((await POST(post({ ...BODY, storageMap: { 'a,b': 'x' } }), ctx())).status).toBe(400)
    expect((await POST(post({ ...BODY, bridgeMap: { a: 'x:y' } }), ctx())).status).toBe(400)
    expect((await POST(new Request('http://x', { method: 'POST', body: 'nope' }), ctx())).status).toBe(400)
    expect(h.planMove).not.toHaveBeenCalled()
  })
})
