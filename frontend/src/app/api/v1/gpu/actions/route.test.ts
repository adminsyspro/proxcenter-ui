import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  access: vi.fn(),
  report: vi.fn(),
  pve: vi.fn(),
  write: vi.fn(),
  perm: vi.fn(),
  reset: vi.fn(),
  contingent: vi.fn(),
}))

vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/gpu/guard', () => ({ requireGpuActions: () => m.access() }))
vi.mock('@/lib/gpu/visibleReport', () => ({ loadVisibleGpuReport: (...a: unknown[]) => m.report(...a) }))
vi.mock('@/lib/gpu/collect', () => ({ resetGpuSnapshotCache: () => m.reset() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: { findFirst: async () => ({ id: 'c1', tenantId: 'default' }) },
  },
}))
vi.mock('@/lib/gpu/vdcGuard', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/vdcGuard')>('@/lib/gpu/vdcGuard')
  return { demandUncheckable: actual.demandUncheckable, vdcContingentForVm: (...a: unknown[]) => m.contingent(...a) }
})
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ baseUrl: 'https://pve', apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pve(...a) }))
vi.mock('@/lib/proxmox/guestConfigWrite', () => ({ writeGuestConfig: (...a: unknown[]) => m.write(...a) }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_CONFIG_HARDWARE: 'vm.config.hardware', NODE_MANAGE: 'node.manage' },
  checkPermission: (...a: unknown[]) => m.perm(...a),
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
}))

import { POST } from './route'

const device = (mappings: string[]) => ({
  key: 'c1:n1:0000:03:00', connId: 'c1', node: 'n1', id: '0000:03:00.0', slot: '0000:03:00', functions: [], displayFunctions: [],
  vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA', deviceName: 'GA102GL [RTX A5000]', subsystemName: null, classCode: '0x030000',
  iommuGroup: 35, iommuIsolated: true, mdev: false, kind: 'gpu', consoleReason: null, mappings, connectionName: 'LAB', vms: [],
})

const allocation = { connId: 'c1', node: 'n1', vmid: '9002', hostpci: 'hostpci0', kind: 'gpu', deviceKey: 'c1:n1:0000:03:00' }

function pveAnswers(config: Record<string, unknown> | null, status = 'stopped') {
  m.pve.mockImplementation(async (_conn: unknown, path: string, init?: RequestInit) => {
    if (path.endsWith('/pending')) {
      if (!config) throw new Error('PVE 500 does not exist')
      return asPending(config)
    }
    if (path.endsWith('/status/current')) return { status }
    if (path === '/cluster/resources?type=vm') return [{ vmid: 9002, pool: 'vdc-acme' }]
    if (path === '/cluster/mapping/pci' && init?.method === 'POST') return null
    throw new Error(`unexpected ${path}`)
  })
}

const body = (r: { status: number; json: () => Promise<unknown> }) => r.json() as Promise<any>

/** A VM config as PVE answers it through /pending: one current-value row per key. */
const asPending = (config: Record<string, unknown>) => Object.entries(config).map(([key, value]) => ({ key, value }))

beforeEach(() => {
  vi.clearAllMocks()
  m.access.mockResolvedValue({ denied: null, userId: 'u1' })
  m.perm.mockResolvedValue(null)
  m.write.mockResolvedValue({})
  m.contingent.mockResolvedValue(null)
  m.report.mockResolvedValue({ devices: [device(['a5000'])], allocations: [] })
})

describe('POST /api/v1/gpu/actions attach', () => {
  it('attaches through the mapping that already covers the GPU, as PCIe on q35', async () => {
    pveAnswers({ machine: 'q35', digest: 'd1', hostpci0: 'mapping=other' }, 'running')
    const res = await callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002' } })
    expect(res.status).toBe(200)
    expect((await body(res)).data).toEqual({ hostpci: 'hostpci1', mapping: 'a5000', mappingCreated: false, pending: true })
    expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ node: 'n1', vmid: '9002', body: 'hostpci1=mapping%3Da5000%2Cpcie%3D1&digest=d1' }))
    expect(m.perm).toHaveBeenCalledWith('vm.config.hardware', 'vm', 'c1:n1:qemu:9002')
    expect(m.reset).toHaveBeenCalled()
  })

  it('creates a mapping for a GPU no mapping covers, with node.manage', async () => {
    m.report.mockResolvedValue({ devices: [device([])], allocations: [] })
    pveAnswers({})
    const res = await callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002' } })
    expect((await body(res)).data).toEqual(expect.objectContaining({ mapping: 'gpu-n1-03-00', mappingCreated: true, pending: false }))
    const create = m.pve.mock.calls.find(([, path]) => path === '/cluster/mapping/pci')
    expect(String(create?.[2]?.body)).toContain('map=node%3Dn1%2Cpath%3D0000%3A03%3A00%2Cid%3D10de%3A2231%2Ciommugroup%3D35')
    expect(m.perm).toHaveBeenCalledWith('node.manage', 'node', 'c1:n1')
    expect(m.write.mock.calls[0][0].body).toBe('hostpci0=mapping%3Dgpu-n1-03-00')
  })

  it('refuses without vm.config.hardware on the VM', async () => {
    m.perm.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    const res = await callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002' } })
    expect(res.status).toBe(403)
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers short codes for an unknown GPU, a VM elsewhere, a template, a full VM and a duplicate', async () => {
    const call = () => callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002' } })
    m.report.mockResolvedValueOnce({ devices: [], allocations: [] })
    expect((await body(await call())).error).toBe('device_not_found')
    pveAnswers(null)
    expect((await body(await call())).error).toBe('vm_not_on_node')
    pveAnswers({ template: 1 })
    expect((await body(await call())).error).toBe('vm_is_template')
    pveAnswers(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`hostpci${i}`, 'x'])))
    expect((await body(await call())).error).toBe('no_free_slot')
    m.report.mockResolvedValueOnce({ devices: [device(['a5000'])], allocations: [allocation] })
    expect((await body(await call())).error).toBe('already_attached')
    expect(m.write).not.toHaveBeenCalled()
  })

  it('reports a write Proxmox refused', async () => {
    pveAnswers({})
    m.write.mockRejectedValue(new Error('PVE 500'))
    const res = await callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002' } })
    expect(res.status).toBe(502)
    expect((await body(res)).error).toBe('pve_refused')
  })
})

describe('POST /api/v1/gpu/actions vDC GPU contingent', () => {
  const call = (extra: Record<string, unknown> = {}) =>
    callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002', ...extra } })
  const line = (kind: 'vgpu' | 'whole', profileName: string, count: number) => ({
    id: 'e1', kind, modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName, count,
  })
  const contingent = (entry: ReturnType<typeof line>, used: number) => ({
    vdcId: 'v1',
    entries: [entry],
    usage: new Map([['e1', used]]),
    catalog: [{ deviceKey: 'c1:n1:0000:03:00', typeId: 665, name: 'RTXA5000-12Q', fbMemory: 12288, maxInstances: 2 }],
    unresolvedVgpuModels: new Set<string>(),
  })
  const vgpuCard = () => ({
    ...device(['a5000']),
    mdev: true,
    vgpu: { mode: 'sriov', virtualFunctions: ['0000:03:00.4'], iommuGroups: [116], subsystemId: '10de:0000' },
    vgpuMappings: ['a5000-vgpu'],
  })
  function pveVgpu() {
    m.pve.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.endsWith('/pending')) return asPending({ machine: 'q35', digest: 'd1' })
      if (path.endsWith('/status/current')) return { status: 'stopped' }
      if (path === '/cluster/resources?type=vm') return [{ vmid: 9002, pool: 'vdc-acme' }]
      if (path.endsWith('/mdev')) return [{ type: 'nvidia-665', available: 1 }]
      throw new Error(`unexpected ${path}`)
    })
  }

  it('refuses a whole card past the line of its model, for a VM of a vDC pool', async () => {
    pveAnswers({})
    m.contingent.mockResolvedValue(contingent(line('whole', '', 1), 1))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'quota_exceeded', used: 1, count: 1, line: { kind: 'whole', modelName: 'RTX A5000', profileName: '' } })
    expect(m.contingent).toHaveBeenCalledWith('c1', 'vdc-acme', { refresh: false })
    // The report was read again just before, inside the connection lock.
    expect(m.report).toHaveBeenCalledWith({ connId: 'c1', refresh: true })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('refuses a vGPU past the line of its profile, read by its catalog name', async () => {
    m.report.mockResolvedValue({ devices: [vgpuCard()], allocations: [] })
    pveVgpu()
    m.contingent.mockResolvedValue(contingent(line('vgpu', 'RTXA5000-12Q', 2), 2))
    const res = await call({ profile: 'nvidia-665' })
    expect(await body(res)).toEqual({ error: 'quota_exceeded', used: 2, count: 2, line: { kind: 'vgpu', modelName: 'RTX A5000', profileName: 'RTXA5000-12Q' } })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('a vGPU with room on its line, or a GPU off the contingent of a vDC, as the line says', async () => {
    m.report.mockResolvedValue({ devices: [vgpuCard()], allocations: [] })
    pveVgpu()
    m.contingent.mockResolvedValue(contingent(line('vgpu', 'RTXA5000-12Q', 2), 1))
    expect((await call({ profile: 'nvidia-665' })).status).toBe(200)

    m.report.mockResolvedValue({ devices: [device(['a5000'])], allocations: [] })
    pveAnswers({})
    m.contingent.mockResolvedValue(contingent(line('vgpu', 'RTXA5000-12Q', 2), 0))
    expect(await body(await call())).toEqual({ error: 'quota_exceeded', used: 0, count: 0, line: { kind: 'whole', modelName: 'GA102GL [RTX A5000]', profileName: '' } })
  })

  it('answers 503 gpu_check_unavailable for a vGPU of a model with an unresolved pool vGPU, or of an unknown profile', async () => {
    m.report.mockResolvedValue({ devices: [vgpuCard()], allocations: [] })
    pveVgpu()
    m.contingent.mockResolvedValue({ ...contingent(line('vgpu', 'RTXA5000-12Q', 2), 0), unresolvedVgpuModels: new Set(['0x10de:0x2231']) })
    const res = await call({ profile: 'nvidia-665' })
    expect(res.status).toBe(503)
    expect(await body(res)).toEqual({ error: 'gpu_check_unavailable' })
    m.contingent.mockResolvedValue({ ...contingent(line('vgpu', 'RTXA5000-12Q', 2), 0), catalog: [] })
    expect(await body(await call({ profile: 'nvidia-665' }))).toEqual({ error: 'gpu_check_unavailable' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('a whole card is judged as usual while a vGPU of its model is unresolved', async () => {
    pveAnswers({})
    m.contingent.mockResolvedValue({ ...contingent(line('whole', '', 1), 0), unresolvedVgpuModels: new Set(['0x10de:0x2231']) })
    expect((await call()).status).toBe(200)
  })

  it('attaches without a ceiling when the pool has no contingent, or the VM no pool', async () => {
    pveAnswers({})
    expect((await call()).status).toBe(200)
    m.pve.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === '/cluster/resources?type=vm') return [{ vmid: 9002 }]
      if (path.endsWith('/status/current')) return { status: 'stopped' }
      if (path.endsWith('/pending')) return []
      return {}
    })
    expect((await call()).status).toBe(200)
    expect(m.contingent).toHaveBeenLastCalledWith('c1', null, { refresh: false })
  })
})

describe('POST /api/v1/gpu/actions release', () => {
  const release = { action: 'release', connId: 'c1', node: 'n1', vmid: '9002', hostpci: 'hostpci0' }

  it('removes a mapped allocation', async () => {
    m.report.mockResolvedValue({ devices: [], allocations: [allocation] })
    pveAnswers({ hostpci0: 'mapping=a5000,pcie=1', digest: 'd2' })
    const res = await callRoute(POST, { method: 'POST', body: release })
    expect((await body(res)).data).toEqual({ hostpci: 'hostpci0', pending: false })
    expect(m.write.mock.calls[0][0].body).toBe('delete=hostpci0&digest=d2')
  })

  it('a GPU whose removal is already pending answers released, without a second write', async () => {
    m.report.mockResolvedValue({ devices: [], allocations: [allocation] })
    m.pve.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.endsWith('/pending')) return [{ key: 'digest', value: 'd2' }, { key: 'hostpci0', value: 'mapping=a5000,pcie=1', delete: 1 }]
      throw new Error(`unexpected ${path}`)
    })
    const res = await callRoute(POST, { method: 'POST', body: release })
    expect(res.status).toBe(200)
    expect((await body(res)).data).toEqual({ hostpci: 'hostpci0', pending: true })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('gives the root command for a raw allocation and writes nothing', async () => {
    m.report.mockResolvedValue({ devices: [], allocations: [allocation] })
    pveAnswers({ hostpci0: '0000:03:00,pcie=1' })
    const res = await callRoute(POST, { method: 'POST', body: release })
    expect(res.status).toBe(409)
    expect(await body(res)).toEqual({ error: 'raw_passthrough', command: 'qm set 9002 --delete hostpci0' })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('refuses an allocation the caller does not see', async () => {
    m.report.mockResolvedValue({ devices: [], allocations: [] })
    const res = await callRoute(POST, { method: 'POST', body: release })
    expect((await body(res)).error).toBe('allocation_not_found')
  })
})

describe('POST /api/v1/gpu/actions guards', () => {
  it('relays the access refusal and refuses a malformed body', async () => {
    m.access.mockResolvedValueOnce({ denied: new Response(JSON.stringify({ error: 'not_found' }), { status: 404 }) })
    expect((await callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'x', vmid: '1' } })).status).toBe(404)
    for (const bad of [{ action: 'attach', deviceKey: 'k', vmid: 'abc' }, { action: 'release', connId: 'c1', node: 'n1', vmid: '1', hostpci: 'hostpci99' }, { action: 'nuke', vmid: '1' }]) {
      expect((await callRoute(POST, { method: 'POST', body: bad })).status).toBe(400)
    }
  })
})

// The mapping entries carry the subsystem ID and the IOMMU group: without either
// PVE 9.2 refuses to start the VM ("missing expected property"), found on the
// RTX A5000 bench.
describe('POST /api/v1/gpu/actions vGPU', () => {
  const vfs = ['0000:03:00.4', '0000:03:00.5']
  const vgpuCard = (vgpuMappings: string[]) => ({
    ...device(vgpuMappings),
    mdev: true,
    vgpu: { mode: 'sriov', virtualFunctions: vfs, iommuGroups: [116, 117], subsystemId: '10de:0000' },
    vgpuMappings,
  })
  const attach = (extra: Record<string, unknown> = {}) =>
    callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002', profile: 'nvidia-665', ...extra } })
  function pveVgpu(available: number) {
    m.pve.mockImplementation(async (_conn: unknown, path: string, init?: RequestInit) => {
      if (path.endsWith('/pending')) return asPending({ machine: 'q35', digest: 'd1' })
      if (path.endsWith('/status/current')) return { status: 'stopped' }
      if (path === '/cluster/resources?type=vm') return [{ vmid: 9002 }]
      if (path === '/cluster/mapping/pci' && init?.method === 'POST') return null
      if (path.endsWith('/mdev')) return [{ type: 'nvidia-665', name: 'NVIDIA RTXA5000-12Q', available }, { type: 'nvidia-666', available: 0 }]
      throw new Error(`unexpected ${path}`)
    })
  }

  it('gives a vGPU of the profile through the card mapping used with mediated devices', async () => {
    m.report.mockResolvedValue({ devices: [vgpuCard(['a5000-vgpu'])], allocations: [] })
    pveVgpu(1)
    const res = await attach()
    expect(res.status).toBe(200)
    expect((await body(res)).data).toEqual({ hostpci: 'hostpci0', mapping: 'a5000-vgpu', mappingCreated: false, profile: 'nvidia-665', pending: false })
    expect(m.pve.mock.calls.some(([, path]) => path === '/nodes/n1/hardware/pci/a5000-vgpu/mdev')).toBe(true)
    expect(m.write.mock.calls[0][0].body).toBe('hostpci0=mapping%3Da5000-vgpu%2Cmdev%3Dnvidia-665%2Cpcie%3D1&digest=d1')
  })

  it('creates the vGPU mapping of every virtual function with its IOMMU group', async () => {
    m.report.mockResolvedValue({ devices: [vgpuCard([])], allocations: [] })
    pveVgpu(2)
    const res = await attach()
    expect((await body(res)).data).toEqual(expect.objectContaining({ mapping: 'gpu-n1-03-00-vgpu', mappingCreated: true }))
    const create = String(m.pve.mock.calls.find(([, path]) => path === '/cluster/mapping/pci')?.[2]?.body)
    expect(create).toContain('mdev=1')
    expect(create).toContain('map=node%3Dn1%2Cpath%3D0000%3A03%3A00.4%2Cid%3D10de%3A2231%2Csubsystem-id%3D10de%3A0000%2Ciommugroup%3D116')
    expect(create).toContain('map=node%3Dn1%2Cpath%3D0000%3A03%3A00.5%2Cid%3D10de%3A2231%2Csubsystem-id%3D10de%3A0000%2Ciommugroup%3D117')
    expect(m.perm).toHaveBeenCalledWith('node.manage', 'node', 'c1:n1')
  })

  it('refuses a profile that no longer fits, a missing profile, a profile on a whole card, and a malformed one', async () => {
    m.report.mockResolvedValue({ devices: [vgpuCard(['a5000-vgpu'])], allocations: [] })
    pveVgpu(0)
    expect((await body(await attach())).error).toBe('profile_unavailable')
    expect((await body(await attach({ profile: undefined }))).error).toBe('profile_required')
    expect((await attach({ profile: 'nvidia-665;rm' })).status).toBe(400)
    m.report.mockResolvedValue({ devices: [device(['a5000'])], allocations: [] })
    pveAnswers({})
    expect((await body(await attach())).error).toBe('not_vgpu_capable')
    expect(m.write).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/gpu/actions card lock', () => {
  it('waits for the connection lock a vDC tenant attach holds', async () => {
    const { withConnGpuLock } = await import('@/lib/gpu/vdcLock')
    pveAnswers({ machine: 'q35', digest: 'd1' })
    let release!: () => void
    const held = withConnGpuLock('c1', () => new Promise<void>((r) => (release = r)))
    const pending = callRoute(POST, { method: 'POST', body: { action: 'attach', deviceKey: 'c1:n1:0000:03:00', vmid: '9002' } })
    try {
      await new Promise((r) => setTimeout(r, 5))
      expect(m.report).not.toHaveBeenCalled()
    } finally {
      release()
    }
    await held
    expect((await pending).status).toBe(200)
    expect(m.report).toHaveBeenCalledTimes(1)
  })
})
