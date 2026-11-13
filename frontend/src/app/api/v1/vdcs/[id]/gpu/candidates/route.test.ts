import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  sessionUser: vi.fn(),
  feature: vi.fn(),
  getVdc: vi.fn(),
  tenant: vi.fn(),
  listEntries: vi.fn(),
  findFirst: vi.fn(),
  getConnection: vi.fn(),
  pve: vi.fn(),
  snapshot: vi.fn(),
  rbac: vi.fn(),
  filterVms: vi.fn(),
}))

vi.mock('@/lib/gpu/guard', () => ({ sessionUser: () => m.sessionUser() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (...a: unknown[]) => m.feature(...a) }))
vi.mock('@/lib/vdc', () => ({ getVdcById: (...a: unknown[]) => m.getVdc(...a) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/gpu/vdcEntries', () => ({ listVdcGpuEntries: (...a: unknown[]) => m.listEntries(...a) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findFirst: (...a: unknown[]) => m.findFirst(...a) } } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => m.getConnection(...a) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pve(...a) }))
vi.mock('@/lib/gpu/collect', () => ({ getConnectionGpus: (...a: unknown[]) => m.snapshot(...a) }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_VIEW: 'vm.view', VM_CONFIG_HARDWARE: 'vm.config.hardware' },
  getRBACContext: () => m.rbac(),
  filterVmsByPermission: (...a: unknown[]) => m.filterVms(...a),
}))

import { GET } from './route'

const params = { id: 'vdc-1' }
const vdc = { id: 'vdc-1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'vdc-p', enabled: true }
const conn = { baseUrl: 'https://pve', apiToken: 'provider-token' }
const members = [
  { id: 'qemu/9021', type: 'qemu', vmid: 9021, node: 'pve9-a5000', name: 'train-2', status: 'stopped', template: 0, tags: 'gpu' },
  { id: 'qemu/9020', type: 'qemu', vmid: 9020, node: 'pve9-a5000', name: 'train-1', status: 'running', template: 0 },
  { id: 'qemu/9900', type: 'qemu', vmid: 9900, node: 'pve9-a5000', name: 'golden', status: 'stopped', template: 1 },
  { id: 'lxc/9100', type: 'lxc', vmid: 9100, node: 'pve9-a5000', name: 'web', status: 'running', template: 0 },
  { id: 'storage/pve9-a5000/local', type: 'storage', node: 'pve9-a5000', storage: 'local' },
]

const body = (r: { json: () => Promise<unknown> }) => r.json() as Promise<any>

beforeEach(() => {
  vi.clearAllMocks()
  m.sessionUser.mockResolvedValue({ id: 'u1' })
  m.feature.mockResolvedValue(true)
  m.getVdc.mockResolvedValue(vdc)
  m.tenant.mockResolvedValue('t1')
  m.listEntries.mockResolvedValue([{ id: 'e1' }])
  m.findFirst.mockResolvedValue({ id: 'c1', tenantId: 'default', name: 'PVE9-A5000' })
  m.getConnection.mockResolvedValue(conn)
  m.pve.mockResolvedValue({ members })
  m.rbac.mockResolvedValue({ isAdmin: true, tenantId: 't1', userId: 'u1' })
})

describe('GET /api/v1/vdcs/{id}/gpu/candidates', () => {
  it('answers 404 to a tenant that does not own the vDC, without reading PVE', async () => {
    m.tenant.mockResolvedValue('t2')
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'not_found' })
    expect(m.pve).not.toHaveBeenCalled()
  })

  it('answers 404 when the vDC has no contingent', async () => {
    m.listEntries.mockResolvedValue([])
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(404)
    expect(m.pve).not.toHaveBeenCalled()
  })

  it('reads the pool once with the provider token and lists its qemu VMs, no template, no LXC, no node', async () => {
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(200)
    expect(m.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', type: 'pve' }, select: { id: true, tenantId: true, name: true } })
    expect(m.getConnection).toHaveBeenCalledWith('c1', 'default')
    expect(m.pve).toHaveBeenCalledTimes(1)
    expect(m.pve).toHaveBeenCalledWith(conn, '/pools/vdc-p')
    expect(m.snapshot).not.toHaveBeenCalled()
    const out = await body(res)
    expect(out).toEqual({
      data: [
        { vmid: '9020', name: 'train-1', status: 'running' },
        { vmid: '9021', name: 'train-2', status: 'stopped' },
      ],
    })
    expect(JSON.stringify(out)).not.toContain('pve9-a5000')
  })

  it('encodes the pool name in the path', async () => {
    m.getVdc.mockResolvedValue({ ...vdc, pvePoolName: 'vdc a/b' })
    await callRoute(GET, { params })
    expect(m.pve).toHaveBeenCalledWith(conn, '/pools/vdc%20a%2Fb')
  })

  it('keeps the VMs the caller may change the hardware of', async () => {
    m.rbac.mockResolvedValue({ isAdmin: false, tenantId: 't1', userId: 'u1' })
    m.filterVms.mockImplementation(async (_p: unknown, rows: Array<{ vmid: string }>) => rows.filter((r) => r.vmid === '9021'))
    const res = await callRoute(GET, { params })
    const [principal, rows, permission, tenantId] = m.filterVms.mock.calls[0]
    expect(principal).toBe('u1')
    expect(rows).toEqual([
      { connId: 'c1', node: 'pve9-a5000', type: 'qemu', vmid: '9021', name: 'train-2', status: 'stopped', tags: 'gpu', pool: 'vdc-p' },
      { connId: 'c1', node: 'pve9-a5000', type: 'qemu', vmid: '9020', name: 'train-1', status: 'running', tags: undefined, pool: 'vdc-p' },
    ])
    expect(permission).toBe('vm.config.hardware')
    expect(tenantId).toBe('t1')
    expect((await body(res)).data).toEqual([{ vmid: '9021', name: 'train-2', status: 'stopped' }])
  })

  it('answers pve_refused when the pool cannot be read, without its text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.pve.mockRejectedValue(new Error('PVE 403 pool vdc-p on pve9-a5000'))
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(502)
    expect(await body(res)).toEqual({ error: 'pve_refused' })
    warn.mockRestore()
  })

  it('answers pve_refused when the connection of the vDC is gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.findFirst.mockResolvedValue(null)
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(502)
    expect(m.pve).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
