import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ pve: vi.fn(), write: vi.fn(), reset: vi.fn() }))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pve(...a) }))
vi.mock('@/lib/proxmox/guestConfigWrite', () => ({ writeGuestConfig: (...a: unknown[]) => m.write(...a) }))
vi.mock('@/lib/gpu/collect', () => ({ resetGpuSnapshotCache: () => m.reset() }))

import { readVmConfig, readVmPending, removeGpu, writeGpu } from './attach'

const conn = { baseUrl: 'https://pve', apiToken: 't' }

/** A VM config as PVE answers it through /pending: one current-value row per key. */
const asPending = (config: Record<string, unknown>) => Object.entries(config).map(([key, value]) => ({ key, value }))

const device = (over: Record<string, unknown> = {}) =>
  ({
    key: 'c1:n1:0000:03:00', connId: 'c1', node: 'n1', id: '0000:03:00.0', slot: '0000:03:00', functions: [], displayFunctions: [],
    vendorId: '0x10de', deviceId: '0x2231', vendorName: 'NVIDIA', deviceName: 'GA102GL [RTX A5000]', subsystemName: null, classCode: '0x030000',
    iommuGroup: 35, iommuIsolated: true, mdev: false, kind: 'gpu', consoleReason: null, mappings: [], connectionName: 'LAB', vms: [],
    ...over,
  }) as any

const vgpuDevice = (vgpuMappings: string[]) =>
  device({
    mdev: true,
    vgpu: { mode: 'sriov', virtualFunctions: ['0000:03:00.4', '0000:03:00.5'], iommuGroups: [116, 117], subsystemId: '10de:0000' },
    vgpuMappings,
  })

function pveAnswers(opts: { status?: string; available?: number; config?: Record<string, unknown> | null } = {}) {
  m.pve.mockImplementation(async (_c: unknown, path: string, init?: RequestInit) => {
    if (path.endsWith('/pending')) {
      if (opts.config === null) throw new Error('PVE 500')
      return asPending(opts.config ?? {})
    }
    if (path.endsWith('/status/current')) return { status: opts.status ?? 'stopped' }
    if (path === '/cluster/mapping/pci' && init?.method === 'POST') return null
    if (path.endsWith('/mdev')) return [{ type: 'nvidia-665', available: opts.available ?? 1 }, { type: 'nvidia-666', available: 0 }]
    throw new Error(`unexpected ${path}`)
  })
}

const posts = () => m.pve.mock.calls.filter(([, path, init]) => path === '/cluster/mapping/pci' && init?.method === 'POST')

beforeEach(() => {
  vi.clearAllMocks()
  m.write.mockResolvedValue({})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('readVmConfig', () => {
  it('returns the config read through /pending, null when PVE cannot read it', async () => {
    pveAnswers({ config: { machine: 'q35' } })
    expect(await readVmConfig(conn, 'n1', '9002')).toEqual({ machine: 'q35' })
    expect(m.pve).toHaveBeenCalledWith(conn, '/nodes/n1/qemu/9002/pending')
    pveAnswers({ config: null })
    expect(await readVmConfig(conn, 'n1', '9002')).toBeNull()
    m.pve.mockResolvedValueOnce({ machine: 'q35' })
    expect(await readVmConfig(conn, 'n1', '9002')).toBeNull()
  })
})

describe('readVmPending', () => {
  it('keeps a hostpciN whose removal is pending, names it, and keeps the digest', async () => {
    m.pve.mockResolvedValueOnce([
      { key: 'digest', value: 'd7' },
      { key: 'machine', value: 'q35' },
      { key: 'hostpci0', value: 'mapping=a5000,pcie=1', delete: 1 },
      { key: 'net1', value: 'virtio,bridge=vmbr0', delete: 1 },
    ])
    const view = await readVmPending(conn, 'n1', '9002')
    expect(view?.config).toEqual({ digest: 'd7', machine: 'q35', hostpci0: 'mapping=a5000,pcie=1' })
    expect(view?.pendingDelete).toEqual(new Set(['hostpci0', 'net1']))
  })

  it('never hands out the slot of a GPU whose removal is pending', async () => {
    m.pve.mockImplementation(async (_c: unknown, path: string) => {
      if (path.endsWith('/pending')) return [{ key: 'digest', value: 'd7' }, { key: 'hostpci0', value: 'mapping=a5000,pcie=1', delete: 1 }]
      if (path.endsWith('/status/current')) return { status: 'running' }
      throw new Error(`unexpected ${path}`)
    })
    const config = await readVmConfig(conn, 'n1', '9002')
    const written = await writeGpu(conn, device({ mappings: ['a10'] }), '9002', config!, { profile: null })
    expect(written).toMatchObject({ ok: true, hostpci: 'hostpci1' })
    expect(m.write.mock.calls[0][0].body).toBe('hostpci1=mapping%3Da10&digest=d7')
  })
})

describe('writeGpu whole card', () => {
  it('reuses the mapping that covers the card, no mapping POST', async () => {
    pveAnswers({ status: 'running' })
    const r = await writeGpu(conn, device({ mappings: ['a5000'] }), '9002', { machine: 'q35', digest: 'd1', hostpci0: 'mapping=other' }, { profile: null })
    expect(r).toEqual({ ok: true, hostpci: 'hostpci1', mappingId: 'a5000', mappingCreated: false, pending: true })
    expect(posts()).toHaveLength(0)
    expect(m.write).toHaveBeenCalledWith(expect.objectContaining({ node: 'n1', vmid: '9002', type: 'qemu', body: 'hostpci1=mapping%3Da5000%2Cpcie%3D1&digest=d1' }))
    expect(m.reset).toHaveBeenCalled()
  })

  it('creates the mapping when none covers the card', async () => {
    pveAnswers()
    const r = await writeGpu(conn, device(), '9002', {}, { profile: null })
    expect(r).toEqual({ ok: true, hostpci: 'hostpci0', mappingId: 'gpu-n1-03-00', mappingCreated: true, pending: false })
    expect(posts()).toHaveLength(1)
    expect(String(posts()[0][2].body)).toContain('map=node%3Dn1%2Cpath%3D0000%3A03%3A00%2Cid%3D10de%3A2231%2Ciommugroup%3D35')
    expect(m.write.mock.calls[0][0].body).toBe('hostpci0=mapping%3Dgpu-n1-03-00')
  })

  it('does not call beforeMappingCreate when a mapping exists', async () => {
    pveAnswers()
    const before = vi.fn(async () => null)
    await writeGpu(conn, device({ mappings: ['a5000'] }), '9002', {}, { profile: null, beforeMappingCreate: before })
    expect(before).not.toHaveBeenCalled()
  })

  it('returns the denial of beforeMappingCreate without any POST', async () => {
    pveAnswers()
    const denied = new Response('{}', { status: 403 })
    const r = await writeGpu(conn, device(), '9002', {}, { profile: null, beforeMappingCreate: async () => denied })
    expect(r).toEqual({ ok: false, denied })
    expect(posts()).toHaveLength(0)
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers mapping_failed, device_ids_unknown, no_free_slot and pve_refused', async () => {
    pveAnswers()
    m.pve.mockImplementation(async (_c: unknown, path: string, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('PVE 500')
      return { status: 'stopped' }
    })
    expect(await writeGpu(conn, device(), '9002', {}, { profile: null })).toEqual({ ok: false, code: 'mapping_failed', status: 502 })

    pveAnswers()
    expect(await writeGpu(conn, device({ vendorId: null }), '9002', {}, { profile: null })).toEqual({ ok: false, code: 'device_ids_unknown', status: 409 })

    const full = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`hostpci${i}`, 'x']))
    expect(await writeGpu(conn, device({ mappings: ['a5000'] }), '9002', full, { profile: null })).toEqual({ ok: false, code: 'no_free_slot', status: 409 })
    expect(m.write).not.toHaveBeenCalled()

    m.write.mockRejectedValue(new Error('PVE 500'))
    expect(await writeGpu(conn, device({ mappings: ['a5000'] }), '9002', {}, { profile: null })).toEqual({ ok: false, code: 'pve_refused', status: 502 })
    expect(m.reset).not.toHaveBeenCalled()
  })
})

describe('writeGpu vGPU', () => {
  it('writes the profile through the existing vGPU mapping after the mdev check', async () => {
    pveAnswers()
    const r = await writeGpu(conn, vgpuDevice(['a5000-vgpu']), '9002', { machine: 'q35', digest: 'd1' }, { profile: 'nvidia-665' })
    expect(r).toEqual({ ok: true, hostpci: 'hostpci0', mappingId: 'a5000-vgpu', mappingCreated: false, pending: false })
    expect(posts()).toHaveLength(0)
    expect(m.pve.mock.calls.some(([, path]) => path === '/nodes/n1/hardware/pci/a5000-vgpu/mdev')).toBe(true)
    expect(m.write.mock.calls[0][0].body).toBe('hostpci0=mapping%3Da5000-vgpu%2Cmdev%3Dnvidia-665%2Cpcie%3D1&digest=d1')
  })

  it('creates the mdev mapping with one map per virtual function, subsystem-id and iommugroup', async () => {
    pveAnswers({ available: 2 })
    const r = await writeGpu(conn, vgpuDevice([]), '9002', {}, { profile: 'nvidia-665' })
    expect(r).toEqual(expect.objectContaining({ ok: true, mappingId: 'gpu-n1-03-00-vgpu', mappingCreated: true }))
    const body = String(posts()[0][2].body)
    expect(body).toContain('mdev=1')
    expect(body).toContain('map=node%3Dn1%2Cpath%3D0000%3A03%3A00.4%2Cid%3D10de%3A2231%2Csubsystem-id%3D10de%3A0000%2Ciommugroup%3D116')
    expect(body).toContain('map=node%3Dn1%2Cpath%3D0000%3A03%3A00.5%2Cid%3D10de%3A2231%2Csubsystem-id%3D10de%3A0000%2Ciommugroup%3D117')
  })

  it('refuses a profile that is not offered or has no room left', async () => {
    pveAnswers({ available: 0 })
    expect(await writeGpu(conn, vgpuDevice(['a5000-vgpu']), '9002', {}, { profile: 'nvidia-665' })).toEqual({ ok: false, code: 'profile_unavailable', status: 409 })
    pveAnswers({ available: 3 })
    expect(await writeGpu(conn, vgpuDevice(['a5000-vgpu']), '9002', {}, { profile: 'nvidia-999' })).toEqual({ ok: false, code: 'profile_unavailable', status: 409 })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers pve_refused when the profiles cannot be read, and when the write is refused', async () => {
    m.pve.mockImplementation(async (_c: unknown, path: string) => {
      if (path.endsWith('/mdev')) throw new Error('PVE 500')
      return {}
    })
    expect(await writeGpu(conn, vgpuDevice(['a5000-vgpu']), '9002', {}, { profile: 'nvidia-665' })).toEqual({ ok: false, code: 'pve_refused', status: 502 })
    pveAnswers()
    m.write.mockRejectedValue(new Error('PVE 500'))
    expect(await writeGpu(conn, vgpuDevice(['a5000-vgpu']), '9002', {}, { profile: 'nvidia-665' })).toEqual({ ok: false, code: 'pve_refused', status: 502 })
  })

  it('stops before creating a mapping when beforeMappingCreate refuses', async () => {
    pveAnswers()
    const denied = new Response('{}', { status: 403 })
    const r = await writeGpu(conn, vgpuDevice([]), '9002', {}, { profile: 'nvidia-665', beforeMappingCreate: async () => denied })
    expect(r).toEqual({ ok: false, denied })
    expect(posts()).toHaveLength(0)
  })
})

describe('removeGpu', () => {
  it('deletes a mapped hostpciN with the digest and reports the pending state', async () => {
    pveAnswers({ status: 'running' })
    const r = await removeGpu(conn, 'n1', '9002', 'hostpci0', { hostpci0: 'mapping=a5000,pcie=1', digest: 'd2' })
    expect(r).toEqual({ ok: true, pending: true })
    expect(m.write.mock.calls[0][0].body).toBe('delete=hostpci0&digest=d2')
    expect(m.reset).toHaveBeenCalled()
  })

  it('answers contact_provider for a raw value and writes nothing', async () => {
    const r = await removeGpu(conn, 'n1', '9002', 'hostpci0', { hostpci0: '0000:03:00,pcie=1' })
    expect(r).toEqual({ ok: false, code: 'contact_provider', status: 409 })
    expect(m.write).not.toHaveBeenCalled()
  })

  it('answers pve_refused when the delete is refused', async () => {
    m.write.mockRejectedValue(new Error('PVE 500'))
    expect(await removeGpu(conn, 'n1', '9002', 'hostpci0', { hostpci0: 'mapping=a5000' })).toEqual({ ok: false, code: 'pve_refused', status: 502 })
    expect(m.reset).not.toHaveBeenCalled()
  })
})
