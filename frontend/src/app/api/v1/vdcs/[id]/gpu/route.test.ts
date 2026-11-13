import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  sessionUser: vi.fn(),
  feature: vi.fn(),
  getVdc: vi.fn(),
  tenant: vi.fn(),
  listEntries: vi.fn(),
  load: vi.fn(),
  view: vi.fn(),
  rbac: vi.fn(),
  filterVms: vi.fn(),
  conn: vi.fn(),
  pve: vi.fn(),
  write: vi.fn(),
  reset: vi.fn(),
  perm: vi.fn(),
  audit: vi.fn(),
  specs: [] as unknown[],
}))

vi.mock('@/lib/gpu/guard', () => ({ sessionUser: () => m.sessionUser() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (...a: unknown[]) => m.feature(...a) }))
vi.mock('@/lib/vdc', () => ({ getVdcById: (...a: unknown[]) => m.getVdc(...a) }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: () => m.tenant() }))
vi.mock('@/lib/gpu/vdcEntries', () => ({ listVdcGpuEntries: (...a: unknown[]) => m.listEntries(...a) }))
vi.mock('@/lib/gpu/vdcContext', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/vdcContext')>('@/lib/gpu/vdcContext')
  return {
    ...actual,
    loadVdcGpuContext: (...a: unknown[]) => m.load(...a),
    loadVdcConnection: (...a: unknown[]) => m.conn(...a),
  }
})
vi.mock('@/lib/gpu/attach', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/attach')>('@/lib/gpu/attach')
  return { ...actual, writeGpu: vi.fn(actual.writeGpu), removeGpu: vi.fn(actual.removeGpu) }
})
vi.mock('@/lib/gpu/collect', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/collect')>('@/lib/gpu/collect')
  return { ...actual, resetGpuSnapshotCache: () => m.reset() }
})
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pve(...a) }))
vi.mock('@/lib/proxmox/guestConfigWrite', () => ({ writeGuestConfig: (...a: unknown[]) => m.write(...a) }))
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (spec: unknown, handler: unknown) => {
    m.specs.push(spec)
    return handler
  },
}))
vi.mock('@/lib/audit', async () => {
  // audit() flips the request's audit scope so withAudit() adds no row of its own.
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return {
    audit: (...a: unknown[]) => {
      markAuditExplicit()
      return m.audit(...a)
    },
  }
})
vi.mock('@/lib/gpu/vdcView', () => ({ buildMyGpuView: (...a: unknown[]) => m.view(...a) }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_VIEW: 'vm.view', VM_CONFIG_HARDWARE: 'vm.config.hardware' },
  getRBACContext: () => m.rbac(),
  filterVmsByPermission: (...a: unknown[]) => m.filterVms(...a),
  checkPermission: (...a: unknown[]) => m.perm(...a),
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
}))

import { removeGpu, writeGpu } from '@/lib/gpu/attach'

import { GET, POST } from './route'

const params = { id: 'vdc-1' }
const vdc = { id: 'vdc-1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'vdc-p', enabled: true, name: 'Acme' }
const view = { entries: [], vms: [], measured: true, generatedAt: '2026-11-02T10:00:00Z' }
const allocation = (vmid: string, pool = 'vdc-p') => ({ connId: 'c1', node: 'pve9-a5000', vmid, pool, tags: ['gpu'], deviceKey: 'c1:pve9-a5000:0000:03:00' })
const gpuCtx = {
  snapshot: { allocations: [allocation('9020'), allocation('9020'), allocation('9030'), allocation('7000', 'vdc-other')] },
  gpus: [{ vmid: '9020' }, { vmid: '9030' }],
}

const body = (r: { json: () => Promise<unknown> }) => r.json() as Promise<any>

/** A VM config as PVE answers it through /pending: one current-value row per key. */
const asPending = (config: Record<string, unknown>) => Object.entries(config).map(([key, value]) => ({ key, value }))

beforeEach(() => {
  vi.clearAllMocks()
  m.sessionUser.mockResolvedValue({ id: 'u1' })
  m.feature.mockResolvedValue(true)
  m.getVdc.mockResolvedValue(vdc)
  m.tenant.mockResolvedValue('t1')
  m.listEntries.mockResolvedValue([{ id: 'e1' }])
  m.load.mockResolvedValue(gpuCtx)
  m.view.mockReturnValue(view)
  m.rbac.mockResolvedValue({ isAdmin: true, tenantId: 't1', userId: 'u1' })
})

describe('GET /api/v1/vdcs/{id}/gpu', () => {
  it('answers 404 to a tenant that does not own the vDC', async () => {
    m.tenant.mockResolvedValue('t2')
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'not_found' })
    expect(m.load).not.toHaveBeenCalled()
  })

  it('answers 404 when the vDC has no contingent', async () => {
    m.listEntries.mockResolvedValue([])
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'not_found' })
    expect(m.load).not.toHaveBeenCalled()
  })

  it('answers 403 without the licence', async () => {
    m.feature.mockResolvedValue(false)
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(403)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('answers the view of the vDC, read from the shared snapshot', async () => {
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual({ data: view })
    expect(m.load).toHaveBeenCalledWith(expect.objectContaining({ id: 'vdc-1', pvePoolName: 'vdc-p' }), { refresh: false })
    expect(m.view).toHaveBeenCalledWith(gpuCtx, null)
    expect(m.filterVms).not.toHaveBeenCalled()
  })

  it('lets the provider preview the view', async () => {
    m.tenant.mockResolvedValue('default')
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(200)
  })

  it('narrows the VMs to those the caller may view', async () => {
    m.rbac.mockResolvedValue({ isAdmin: false, tenantId: 't1', userId: 'u1', principal: { kind: 'user', userId: 'u1' } })
    m.filterVms.mockImplementation(async (_p: unknown, rows: Array<{ vmid: string }>) => rows.filter((r) => r.vmid === '9030'))
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(200)
    const [principal, rows, permission, tenantId] = m.filterVms.mock.calls[0]
    expect(principal).toEqual({ kind: 'user', userId: 'u1' })
    expect(rows).toEqual([
      { connId: 'c1', node: 'pve9-a5000', type: 'qemu', vmid: '9020', tags: ['gpu'], pool: 'vdc-p' },
      { connId: 'c1', node: 'pve9-a5000', type: 'qemu', vmid: '9030', tags: ['gpu'], pool: 'vdc-p' },
    ])
    expect(permission).toBe('vm.view')
    expect(tenantId).toBe('t1')
    expect(m.view).toHaveBeenCalledWith(gpuCtx, new Set(['9030']))
  })

  it('answers pve_refused when the cluster cannot be read, without its text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    m.load.mockRejectedValue(new Error('PVE 10.0.0.1 pve9-a5000 unreachable'))
    const res = await callRoute(GET, { params })
    expect(res.status).toBe(502)
    const out = await body(res)
    expect(out).toEqual({ error: 'pve_refused' })
    expect(JSON.stringify(out)).not.toContain('pve9-a5000')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

// ---- POST -------------------------------------------------------------------

const NODE = 'pve9-a5000'
const A = `c1:${NODE}:0000:03:00`
const B = `c1:${NODE}:0000:05:00`
const W = `c1:${NODE}:0000:04:00`

const card = (key: string, slot: string, sriov: boolean, maps: string[]) => ({
  key, connId: 'c1', node: NODE, id: `${slot}.0`, slot, functions: [`${slot}.0`], displayFunctions: [`${slot}.0`],
  vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA Corporation', deviceName: 'GA102GL [RTX A5000]', subsystemName: null,
  classCode: '0x030200', iommuGroup: 35, iommuIsolated: true, mdev: sriov,
  vgpu: sriov ? { mode: 'sriov', virtualFunctions: [] } : null,
  kind: 'gpu', consoleReason: null, mappings: sriov ? [] : maps, vgpuMappings: sriov ? maps : undefined, connectionName: 'PROD', vms: [],
})

const types = (key: string) => [
  { deviceKey: key, typeId: 666, name: 'RTXA5000-24Q', fbMemory: 24576, maxInstances: 1 },
  { deviceKey: key, typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 },
]

const vgpuLine = { id: 'e-v', kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', count: 2 }
const wholeLine = { id: 'e-w', kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', count: 1 }

const heldVgpu = { vmid: '9020', vmName: 'web', vmStatus: 'running', node: NODE, hostpci: 'hostpci0', deviceKey: A, kind: 'vgpu', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q', mdev: 'nvidia-665', template: false, via: 'mapping', smbiosUuid: null }

type CtxOpts = {
  devices?: unknown[]
  catalog?: unknown[]
  usage?: Record<string, number>
  gpus?: unknown[]
  health?: Record<string, unknown>
  allocations?: unknown[]
  nodes?: Array<{ node: string; online: boolean; error: string | null }>
  unresolved?: string[]
}

function postCtx(o: CtxOpts = {}) {
  return {
    conn: { id: 'c1' },
    snapshot: {
      error: null, mappingsError: null, guestsError: null,
      nodes: o.nodes ?? [{ node: NODE, online: true, error: null }, { node: 'pve9-cpu', online: true, error: null }],
      allocations: [],
      ...o.health,
    },
    report: { scope: 'infrastructure', devices: o.devices ?? [card(A, '0000:03:00', true, ['vgpu-a']), card(B, '0000:05:00', true, ['vgpu-b']), card(W, '0000:04:00', false, ['gpu-w'])], allocations: o.allocations ?? [], nodes: [], connections: [] },
    catalog: o.catalog ?? [...types(A), ...types(B)],
    latest: null,
    entries: [vgpuLine, wholeLine],
    gpus: o.gpus ?? [],
    usage: new Map(Object.entries(o.usage ?? { 'e-v': 0, 'e-w': 0 })),
    unresolvedVgpuModels: new Set(o.unresolved ?? []),
  }
}

const poolMembers = [
  { type: 'qemu', vmid: 9020, name: 'web', status: 'running', node: NODE },
  { type: 'qemu', vmid: 9021, name: 'cpu-only', status: 'stopped', node: 'pve9-cpu' },
  { type: 'lxc', vmid: 9040, name: 'ct', status: 'running', node: NODE },
  { type: 'qemu', vmid: 9050, name: 'tpl', status: 'stopped', node: NODE, template: 1 },
]

type PveOpts = { config?: Record<string, unknown>; rows?: unknown[]; mdev?: Record<string, number>; status?: string; mappingPost?: () => unknown }

function pveAnswers(o: PveOpts = {}) {
  m.pve.mockImplementation(async (_conn: unknown, path: string, init?: RequestInit) => {
    if (path === '/pools/vdc-p') return { members: poolMembers }
    if (path === '/pools/vdc-q') return { members: [{ type: 'qemu', vmid: 9120, name: 'db', status: 'stopped', node: NODE }] }
    if (path.endsWith('/pending')) return o.rows ?? asPending(o.config ?? { machine: 'q35', digest: 'd1', hostpci0: 'mapping=nic' })
    if (path.endsWith('/status/current')) return { status: o.status ?? 'running' }
    const mdev = path.match(/\/hardware\/pci\/([^/]+)\/mdev$/)
    if (mdev) return [{ type: 'nvidia-665', available: o.mdev?.[decodeURIComponent(mdev[1])] ?? 1 }]
    if (path === '/cluster/mapping/pci' && init?.method === 'POST') return o.mappingPost ? o.mappingPost() : null
    throw new Error(`unexpected ${path}`)
  })
}

const attach = (extra: Record<string, unknown> = {}) =>
  callRoute(POST, { params, method: 'POST', body: { action: 'attach', vmid: '9020', entryId: 'e-v', ...extra } })
const release = (extra: Record<string, unknown> = {}) =>
  callRoute(POST, { params, method: 'POST', body: { action: 'release', vmid: '9020', hostpci: 'hostpci0', ...extra } })

/** Names a tenant must never read: nodes, cards, mappings, the connection. */
const LEAKS = [NODE, 'pve9-cpu', 'vgpu-a', 'vgpu-b', 'gpu-w', '0000:0', 'PROD', 'c1:', 'mapping']
const expectNoLeak = (out: unknown) => {
  const text = JSON.stringify(out)
  for (const name of LEAKS) expect(text).not.toContain(name)
}

describe('POST /api/v1/vdcs/{id}/gpu', () => {
  beforeEach(() => {
    m.conn.mockResolvedValue({ conn: { id: 'c1' }, row: { id: 'c1', name: 'PROD' } })
    m.load.mockResolvedValue(postCtx())
    m.perm.mockResolvedValue(null)
    m.write.mockResolvedValue({})
    m.audit.mockResolvedValue('a1')
    pveAnswers()
  })

  it.each([
    ['a non-numeric vmid', { action: 'attach', vmid: 'abc', entryId: 'e-v' }],
    ['an out-of-range hostpci', { action: 'release', vmid: '9020', hostpci: 'hostpci17' }],
    ['an unknown action', { action: 'detach', vmid: '9020', entryId: 'e-v' }],
    ['an attach without entry', { action: 'attach', vmid: '9020' }],
  ])('answers 400 invalid_body on %s', async (_label, payload) => {
    const res = await callRoute(POST, { params, method: 'POST', body: payload })
    expect(res.status).toBe(400)
    expect(await body(res)).toEqual({ error: 'invalid_body' })
    expect(m.load).not.toHaveBeenCalled()
  })

  it('answers 404 to the provider: it never writes through the tenant route', async () => {
    m.tenant.mockResolvedValue('default')
    const res = await attach()
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'not_found' })
    expect(m.pve).not.toHaveBeenCalled()
  })

  it('answers 404 to a tenant that does not own the vDC', async () => {
    m.tenant.mockResolvedValue('t2')
    const res = await attach()
    expect(res.status).toBe(404)
    expect(m.pve).not.toHaveBeenCalled()
  })

  it.each([
    ['outside the pool', '777'],
    ['a container', '9040'],
    ['a template', '9050'],
  ])('answers 404 vm_not_found for a VM %s', async (_label, vmid) => {
    const res = await attach({ vmid })
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'vm_not_found' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('reads the pool with the provider token and the VM node from it', async () => {
    await attach()
    expect(m.pve).toHaveBeenCalledWith({ id: 'c1' }, '/pools/vdc-p')
    expect(m.perm).toHaveBeenCalledWith('vm.config.hardware', 'vm', `c1:${NODE}:qemu:9020`)
  })

  it('answers 403 without vm.config.hardware on the VM', async () => {
    m.perm.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    const res = await attach()
    expect(res.status).toBe(403)
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers 404 entry_not_found for a line of another vDC or one regenerated since', async () => {
    const res = await attach({ entryId: 'e-of-another-vdc' })
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'entry_not_found' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers 409 quota_exhausted with the use of a full line', async () => {
    m.load.mockResolvedValue(postCtx({ usage: { 'e-v': 2, 'e-w': 0 } }))
    const res = await attach()
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'quota_exhausted', used: 2, count: 2 })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('reads the snapshot again inside the lock', async () => {
    await attach()
    expect(m.load).toHaveBeenCalledWith(expect.objectContaining({ id: 'vdc-1' }), { refresh: true })
  })

  it('answers 409 no_free_slot when the sixteen hostpciN are taken', async () => {
    const config: Record<string, unknown> = { digest: 'd1' }
    for (let i = 0; i < 16; i++) config[`hostpci${i}`] = `mapping=x${i}`
    pveAnswers({ config })
    const res = await attach()
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'no_free_slot' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers 409 no_room_here for a VM on a node without any GPU', async () => {
    const res = await attach({ vmid: '9021' })
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'no_room_here' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers 409 no_room_here for a vGPU line when the catalog could not be read', async () => {
    m.load.mockResolvedValue(postCtx({ catalog: [] }))
    const res = await attach()
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'no_room_here' })
  })

  it('answers 503 gpu_check_unavailable for a vGPU line whose model has a pool vGPU of unknown profile', async () => {
    m.load.mockResolvedValue(postCtx({ unresolved: ['0x10de:0x2231'] }))
    const res = await attach()
    expect(res.status).toBe(503)
    expect(await body(res)).toEqual({ error: 'gpu_check_unavailable' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('a whole-card line is judged as usual while a vGPU of its model is unresolved', async () => {
    m.load.mockResolvedValue(postCtx({ unresolved: ['0x10de:0x2231'] }))
    pveAnswers({ status: 'stopped' })
    const res = await attach({ entryId: 'e-w' })
    expect(res.status).toBe(200)
  })

  it.each([
    ['the guests', { guestsError: '2 guest config(s) unreadable' }],
    ['the mappings', { mappingsError: 'PVE 403 pve9-a5000' }],
    ['a node of the cluster', { nodes: [{ node: NODE, online: true, error: null }, { node: 'pve9-b', online: false, error: null }] }],
  ])('fails closed with no_room_here when the snapshot missed %s', async (_label, health) => {
    m.load.mockResolvedValue(postCtx({ health }))
    const res = await attach()
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'no_room_here' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('fails closed when the VM node could not be scanned', async () => {
    m.load.mockResolvedValue(postCtx({ nodes: [{ node: NODE, online: true, error: 'PVE 500' }] }))
    const res = await attach()
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'no_room_here' })
  })

  it('moves to the next card when PVE has no slot left for the profile on the first one', async () => {
    pveAnswers({ mdev: { 'vgpu-a': 0, 'vgpu-b': 1 } })
    const res = await attach()
    expect(res.status).toBe(200)
    expect(m.write).toHaveBeenCalledTimes(1)
    expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ vmid: '9020', body: 'hostpci1=mapping%3Dvgpu-b%2Cmdev%3Dnvidia-665%2Cpcie%3D1&digest=d1' }))
  })

  it('answers no_room_here when no card of the node has room left', async () => {
    pveAnswers({ mdev: { 'vgpu-a': 0, 'vgpu-b': 0 } })
    const res = await attach()
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'no_room_here' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('attaches a vGPU for the provider, without a mapping permission check, and answers no infrastructure name', async () => {
    const res = await attach()
    expect(res.status).toBe(200)
    const out = await body(res)
    expect(out).toEqual({ data: { hostpci: 'hostpci1', pendingStart: true } })
    expectNoLeak(out)
    const [, device, vmid, , opts] = vi.mocked(writeGpu).mock.calls[0]
    expect(device.key).toBe(A)
    expect(vmid).toBe('9020')
    expect(opts).toEqual({ profile: 'nvidia-665' })
    expect(opts).not.toHaveProperty('beforeMappingCreate')
    expect(m.reset).toHaveBeenCalled()
  })

  it('attaches a whole card without a profile', async () => {
    pveAnswers({ status: 'stopped' })
    const res = await attach({ entryId: 'e-w', vmid: 9020 })
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual({ data: { hostpci: 'hostpci1', pendingStart: false } })
    const [, device, , , opts] = vi.mocked(writeGpu).mock.calls[0]
    expect(device.key).toBe(W)
    expect(opts).toEqual({ profile: null })
  })

  it('creates the mapping a card lacks with the provider token', async () => {
    m.load.mockResolvedValue(postCtx({ devices: [card(W, '0000:04:00', false, [])] }))
    const res = await attach({ entryId: 'e-w' })
    expect(res.status).toBe(200)
    expect(m.pve).toHaveBeenCalledWith({ id: 'c1' }, '/cluster/mapping/pci', expect.objectContaining({ method: 'POST' }))
    expect(m.perm).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the mapping creation', () => m.load.mockResolvedValue(postCtx({ devices: [card(W, '0000:04:00', false, [])] })), () => pveAnswers({ mappingPost: () => { throw new Error('PVE 403 Mapping.Modify on pve9-a5000') } })],
    ['the config write', () => undefined, () => m.write.mockRejectedValue(new Error('PVE 500 pve9-a5000: hostpci1 mapping=gpu-w busy'))],
  ])('answers pve_refused, without PVE text, when PVE refuses %s', async (_label, setCtx, setPve) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    setCtx()
    setPve()
    const res = await attach({ entryId: 'e-w' })
    expect(res.status).toBe(502)
    const out = await body(res)
    expect(out).toEqual({ error: 'pve_refused' })
    expectNoLeak(out)
    err.mockRestore()
  })

  it('answers pve_refused, not a mapping code, when the card cannot be mapped', async () => {
    // An SR-IOV card without a vGPU mapping nor virtual functions: device_ids_unknown in the write core.
    m.load.mockResolvedValue(postCtx({ devices: [card(A, '0000:03:00', true, [])], catalog: types(A) }))
    const res = await attach()
    expect(res.status).toBe(502)
    expect(await body(res)).toEqual({ error: 'pve_refused' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers pve_refused when the pool cannot be read', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.pve.mockRejectedValue(new Error('PVE 10.0.0.1 unreachable'))
    const res = await attach()
    expect(res.status).toBe(502)
    expect(await body(res)).toEqual({ error: 'pve_refused' })
    err.mockRestore()
  })

  it('two concurrent attaches on the last slot: one 200, one 409 quota_exhausted', async () => {
    let held = 1
    m.load.mockImplementation(async () => postCtx({ usage: { 'e-v': held, 'e-w': 0 } }))
    m.write.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      held += 1
      return {}
    })
    const [first, second] = await Promise.all([attach(), attach()])
    expect([first.status, second.status].sort((x, y) => x - y)).toEqual([200, 409])
    const refused = first.status === 409 ? first : second
    expect(await body(refused)).toEqual({ error: 'quota_exhausted', used: 2, count: 2 })
    expect(m.write).toHaveBeenCalledTimes(1)
    expect(m.load).toHaveBeenCalledTimes(2)
  })

  it('release: answers 404 vm_not_found for a hostpci that holds no GPU', async () => {
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu] }))
    const res = await release({ hostpci: 'hostpci3' })
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'vm_not_found' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('release: answers 404 vm_not_found for a VM outside the pool', async () => {
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu] }))
    const res = await release({ vmid: '777' })
    expect(res.status).toBe(404)
    expect(await body(res)).toEqual({ error: 'vm_not_found' })
  })

  it('release: a GPU whose removal is already pending answers as released, without a second write', async () => {
    // The VM runs: PVE lists the removal of hostpci0 as pending.
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu] }))
    pveAnswers({ rows: [{ key: 'digest', value: 'd9' }, { key: 'hostpci0', value: 'mapping=vgpu-a,mdev=nvidia-665', delete: 1 }] })
    const res = await release()
    expect(res.status).toBe(200)
    expect(await body(res)).toEqual({ data: { hostpci: 'hostpci0', pendingStart: true } })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('release: answers 409 contact_provider for a GPU given by raw address', async () => {
    m.load.mockResolvedValue(postCtx({ gpus: [{ ...heldVgpu, kind: 'whole', via: 'address', deviceKey: W }] }))
    pveAnswers({ config: { digest: 'd1', hostpci0: '0000:04:00,pcie=1' } })
    const res = await release()
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'contact_provider' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('release: answers 403 without vm.config.hardware', async () => {
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu] }))
    m.perm.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    const res = await release()
    expect(res.status).toBe(403)
    expect(m.write).not.toHaveBeenCalled()
  })

  it.each([
    ['the mappings', { mappingsError: 'PVE 403' }],
    ['the connection', { error: 'PVE 595' }],
    ['the VM node, in error', { nodes: [{ node: NODE, online: true, error: 'PVE 500' }] }],
    ['the VM node, offline', { nodes: [{ node: NODE, online: false, error: null }] }],
  ])('release: answers pve_refused when the snapshot missed %s', async (_label, health) => {
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu], health }))
    const res = await release()
    expect(res.status).toBe(502)
    expect(await body(res)).toEqual({ error: 'pve_refused' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('release: goes through while another node of the cluster is offline', async () => {
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu], health: { nodes: [{ node: NODE, online: true, error: null }, { node: 'pve9-b', online: false, error: null }] } }))
    pveAnswers({ config: { digest: 'd9', hostpci0: 'mapping=vgpu-a,mdev=nvidia-665' } })
    const res = await release()
    expect(res.status).toBe(200)
    expect(m.write).toHaveBeenCalledTimes(1)
  })

  it('release: answers pve_refused, not vm_not_found, for a GPU unseen while guest configs went unread', async () => {
    m.load.mockResolvedValue(postCtx({ gpus: [], health: { guestsError: '1 guest config(s) unreadable' } }))
    const res = await release()
    expect(res.status).toBe(502)
    expect(await body(res)).toEqual({ error: 'pve_refused' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('two attaches from two vDCs of the same connection contest the card one after the other', async () => {
    const other = { ...vdc, id: 'vdc-2', pvePoolName: 'vdc-q' }
    m.getVdc.mockImplementation(async (id: string) => (id === 'vdc-2' ? other : vdc))
    let taken = false
    m.load.mockImplementation(async () =>
      postCtx({ devices: [card(W, '0000:04:00', false, ['gpu-w'])], allocations: taken ? [{ deviceKey: W, vmid: '9020', template: false }] : [] }),
    )
    m.write.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      taken = true
      return {}
    })
    const [first, second] = await Promise.all([
      attach({ entryId: 'e-w' }),
      callRoute(POST, { params: { id: 'vdc-2' }, method: 'POST', body: { action: 'attach', vmid: '9120', entryId: 'e-w' } }),
    ])
    expect(first.status).toBe(200)
    expect(second.status).toBe(409)
    expect(await body(second)).toEqual({ error: 'no_room_here' })
    expect(m.write).toHaveBeenCalledTimes(1)
  })

  it('a tenant attach waits for the connection lock the provider GPU page holds', async () => {
    const { withConnGpuLock } = await import('@/lib/gpu/vdcLock')
    let free!: () => void
    const held = withConnGpuLock('c1', () => new Promise<void>((r) => (free = r)))
    const pending = attach()
    try {
      await new Promise((r) => setTimeout(r, 5))
      expect(m.load).not.toHaveBeenCalled()
    } finally {
      free()
    }
    await held
    expect((await pending).status).toBe(200)
  })

  it('a release does not wait for the connection lock', async () => {
    const { withConnGpuLock } = await import('@/lib/gpu/vdcLock')
    let free!: () => void
    const held = withConnGpuLock('c1', () => new Promise<void>((r) => (free = r)))
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu] }))
    pveAnswers({ config: { digest: 'd9', hostpci0: 'mapping=vgpu-a,mdev=nvidia-665' } })
    try {
      expect((await release()).status).toBe(200)
    } finally {
      free()
    }
    await held
  })

  it('release: removes the mapped GPU with the config digest', async () => {
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu] }))
    pveAnswers({ config: { digest: 'd9', hostpci0: 'mapping=vgpu-a,mdev=nvidia-665' } })
    const res = await release()
    expect(res.status).toBe(200)
    const out = await body(res)
    expect(out).toEqual({ data: { hostpci: 'hostpci0', pendingStart: true } })
    expectNoLeak(out)
    expect(vi.mocked(removeGpu)).toHaveBeenCalledWith({ id: 'c1' }, NODE, '9020', 'hostpci0', expect.objectContaining({ digest: 'd9' }))
    expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ body: 'delete=hostpci0&digest=d9' }))
  })

  it('audits under vms/gpu with the vDC, the VM, the slot and the line kind only', async () => {
    expect(m.specs).toContainEqual({ category: 'vms', resourceType: 'gpu' })
    await attach()
    m.load.mockResolvedValue(postCtx({ gpus: [heldVgpu] }))
    pveAnswers({ config: { digest: 'd9', hostpci0: 'mapping=vgpu-a,mdev=nvidia-665' } })
    await release()
    expect(m.audit).toHaveBeenCalledTimes(2)
    const [attached, released] = m.audit.mock.calls.map((c) => c[0])
    expect(attached).toMatchObject({ category: 'vms', resourceType: 'gpu', resourceId: '9020', status: 'success' })
    expect(attached.details).toEqual({ vdcId: 'vdc-1', vmid: '9020', hostpci: 'hostpci1', kind: 'vgpu', profileName: 'RTXA5000-12Q' })
    expect(released.details).toEqual({ vdcId: 'vdc-1', vmid: '9020', hostpci: 'hostpci0', kind: 'vgpu', profileName: 'RTXA5000-12Q' })
    expectNoLeak([attached, released])
  })
})
