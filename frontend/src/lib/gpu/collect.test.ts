import { beforeEach, describe, expect, it, vi } from 'vitest'

const pveFetch = vi.fn()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))

import { getConnectionGpus, readConnectionGpus, resetGpuSnapshotCache, SNAPSHOT_TTL_MS } from './collect'
import { configFromPending, pendingDeleteOf, readQemuConfig } from './guestConfigSource'
import { buildGpuReport } from './report'
import { entryUsage, poolGpus } from './vdcQuota'

const CONN = { id: 'c1', name: 'PROD' }

const NVIDIA = { id: '0000:01:00.0', class: '0x030000', vendor: '0x10de', device: '0x2204', vendor_name: 'NVIDIA Corporation', iommugroup: 14 }

function routes(table: Record<string, unknown | Error>) {
  pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
    if (!(path in table)) throw new Error(`unexpected ${path}`)
    const value = table[path]
    if (value instanceof Error) throw value
    return value
  })
}

beforeEach(() => {
  pveFetch.mockReset()
  resetGpuSnapshotCache()
})

describe('readConnectionGpus', () => {
  it('reads one PCI list per online node and one config per QEMU guest on a GPU node', async () => {
    routes({
      '/nodes': [{ node: 'n1', status: 'online' }, { node: 'n2', status: 'online' }, { node: 'n3', status: 'offline' }],
      '/cluster/mapping/pci': [{ id: 'gpu', map: ['node=n1,path=0000:01:00'] }],
      '/nodes/n1/hardware/pci': [NVIDIA],
      '/nodes/n2/hardware/pci': [{ id: '0000:00:1f.0', class: '0x060100', vendor: '0x8086' }],
      '/cluster/resources?type=vm': [
        { type: 'qemu', vmid: 100, node: 'n1', name: 'ml', status: 'running', pool: 'p1', tags: 'a;b' },
        { type: 'qemu', vmid: 101, node: 'n1', status: 'stopped', template: 1 },
        { type: 'lxc', vmid: 200, node: 'n1', status: 'running' },
        { type: 'qemu', vmid: 300, node: 'n2', status: 'running' },
      ],
      '/nodes/n1/qemu/100/pending': [{ key: 'hostpci0', value: 'mapping=gpu' }],
      '/nodes/n1/qemu/101/pending': new Error('595'),
      '/nodes/n1/qemu/101/config': new Error('595'),
    })

    const snap = await readConnectionGpus({}, CONN)

    const paths = pveFetch.mock.calls.map((c) => String(c[1])).sort((a, b) => a.localeCompare(b))
    expect(paths).toEqual([
      '/cluster/mapping/pci',
      '/cluster/resources?type=vm',
      '/nodes',
      '/nodes/n1/hardware/pci',
      '/nodes/n1/qemu/100/pending',
      '/nodes/n1/qemu/101/config',
      '/nodes/n1/qemu/101/pending',
      '/nodes/n2/hardware/pci',
    ])
    expect(snap.nodes).toEqual([
      { node: 'n1', online: true, error: null },
      { node: 'n2', online: true, error: null },
      { node: 'n3', online: false, error: null },
    ])
    expect(snap.devices.map((d) => [d.key, d.mappings])).toEqual([['c1:n1:0000:01:00', ['gpu']]])
    expect(snap.configReads).toBe(2)
    expect(snap.mappingsError).toBeNull()
    expect(snap.guestsError).toBe('1 guest config(s) unreadable')
    expect(snap.allocations).toHaveLength(1)
    expect(snap.allocations[0]).toMatchObject({ vmid: '100', vmName: 'ml', pool: 'p1', tags: ['a', 'b'], via: 'mapping' })
  })

  it('skips every guest read when no node holds a display device', async () => {
    routes({
      '/nodes': [{ node: 'n1', status: 'online' }],
      '/cluster/mapping/pci': new Error('501 not implemented'),
      '/nodes/n1/hardware/pci': [],
    })
    const snap = await readConnectionGpus({}, CONN)
    expect(snap.devices).toEqual([])
    expect(snap.mappingsError).toBe('501 not implemented')
    expect(snap.guestsError).toBeNull()
    expect(pveFetch.mock.calls.map((c) => c[1])).not.toContain('/cluster/resources?type=vm')
  })

  it('reports an unreachable connection and an unreadable node instead of throwing', async () => {
    routes({ '/nodes': new Error('connect ECONNREFUSED') })
    expect(await readConnectionGpus({}, CONN)).toMatchObject({ error: 'connect ECONNREFUSED', nodes: [], devices: [] })

    routes({
      '/nodes': [{ node: 'n1', status: 'online' }],
      '/cluster/mapping/pci': [],
      '/nodes/n1/hardware/pci': new Error('403 Permission check failed'),
    })
    const snap = await readConnectionGpus({}, CONN)
    expect(snap.error).toBeNull()
    expect(snap.nodes).toEqual([{ node: 'n1', online: true, error: '403 Permission check failed' }])
  })

  it('keeps an empty map when /cluster/resources fails', async () => {
    routes({
      '/nodes': [{ node: 'n1', status: 'online' }],
      '/cluster/mapping/pci': [],
      '/nodes/n1/hardware/pci': [NVIDIA],
      '/cluster/resources?type=vm': new Error('timeout'),
    })
    const snap = await readConnectionGpus({}, CONN)
    expect(snap.devices).toHaveLength(1)
    expect(snap.allocations).toEqual([])
    expect(snap.guestsError).toBe('timeout')
  })

  it('reads configs through the injectable source', async () => {
    routes({
      '/nodes': [{ node: 'n1', status: 'online' }],
      '/cluster/mapping/pci': [],
      '/nodes/n1/hardware/pci': [NVIDIA],
      '/cluster/resources?type=vm': [{ type: 'qemu', vmid: 7, node: 'n1', status: 'running' }],
    })
    const readConfig = vi.fn(async () => ({ hostpci0: '01:00' }))
    const snap = await readConnectionGpus({}, CONN, readConfig)
    expect(readConfig).toHaveBeenCalledWith({}, 'n1', '7')
    expect(snap.allocations[0]).toMatchObject({ vmid: '7', vmName: 'VM 7', vmStatus: 'running' })
  })
})

describe('readConnectionGpus, pending removal', () => {
  it('flags a hostpciN marked for deletion on a VM that keeps running it', async () => {
    routes({
      '/nodes': [{ node: 'n1', status: 'online' }],
      '/cluster/mapping/pci': [],
      '/nodes/n1/hardware/pci': [NVIDIA],
      '/cluster/resources?type=vm': [
        { type: 'qemu', vmid: 7, node: 'n1', status: 'running' },
        { type: 'qemu', vmid: 8, node: 'n1', status: 'running' },
      ],
      '/nodes/n1/qemu/7/pending': [{ key: 'hostpci0', value: '01:00', delete: 1 }],
      '/nodes/n1/qemu/8/pending': [{ key: 'hostpci0', value: '01:00' }],
    })
    const snap = await readConnectionGpus({}, CONN)
    expect(snap.allocations.map((a) => [a.vmid, a.pendingRemoval])).toEqual([['7', true], ['8', false]])
  })

  it('is false for a config injected without pending information', async () => {
    routes({
      '/nodes': [{ node: 'n1', status: 'online' }],
      '/cluster/mapping/pci': [],
      '/nodes/n1/hardware/pci': [NVIDIA],
      '/cluster/resources?type=vm': [{ type: 'qemu', vmid: 7, node: 'n1', status: 'running' }],
    })
    const snap = await readConnectionGpus({}, CONN, async () => ({ hostpci0: '01:00' }))
    expect(snap.allocations[0].pendingRemoval).toBe(false)
  })
})

describe('getConnectionGpus cache', () => {
  it('serves the cached snapshot within the TTL and re-reads on refresh or expiry', async () => {
    routes({ '/nodes': [], '/cluster/mapping/pci': [] })
    await getConnectionGpus({}, CONN, { now: 1_000 })
    await getConnectionGpus({}, CONN, { now: 1_000 + SNAPSHOT_TTL_MS - 1 })
    expect(pveFetch.mock.calls.filter((c) => c[1] === '/nodes')).toHaveLength(1)

    await getConnectionGpus({}, CONN, { now: 2_000, refresh: true })
    expect(pveFetch.mock.calls.filter((c) => c[1] === '/nodes')).toHaveLength(2)

    await getConnectionGpus({}, CONN, { now: 2_000 + SNAPSHOT_TTL_MS })
    expect(pveFetch.mock.calls.filter((c) => c[1] === '/nodes')).toHaveLength(3)
  })

  it('drops a failed read from the cache', async () => {
    const boom = vi.fn(async () => { throw new Error('boom') })
    routes({ '/nodes': [{ node: 'n1', status: 'online' }], '/cluster/mapping/pci': [], '/nodes/n1/hardware/pci': [NVIDIA], '/cluster/resources?type=vm': [{ type: 'qemu', vmid: 1, node: 'n1' }] })
    await expect(getConnectionGpus({}, CONN, { now: 1, readConfig: boom })).rejects.toThrow('boom')
    const ok = await getConnectionGpus({}, CONN, { now: 2, readConfig: async () => null })
    expect(ok.devices).toHaveLength(1)
  })
})

describe('readQemuConfig', () => {
  it('reads the pending view of the VM, one call', async () => {
    pveFetch.mockResolvedValueOnce([{ key: 'hostpci0', value: '01:00' }, { key: 'name', value: 'ml' }])
    expect(await readQemuConfig({}, 'n 1', '100')).toEqual({ hostpci0: '01:00', name: 'ml' })
    expect(pveFetch).toHaveBeenCalledTimes(1)
    expect(pveFetch).toHaveBeenLastCalledWith({}, '/nodes/n%201/qemu/100/pending')
  })

  it('falls back to /config when /pending fails or answers no list, null when both fail', async () => {
    pveFetch.mockRejectedValueOnce(new Error('501')).mockResolvedValueOnce({ hostpci0: '01:00' })
    expect(await readQemuConfig({}, 'n1', '100')).toEqual({ hostpci0: '01:00' })
    expect(pveFetch).toHaveBeenLastCalledWith({}, '/nodes/n1/qemu/100/config')
    pveFetch.mockResolvedValueOnce(null).mockResolvedValueOnce({ hostpci0: '02:00' })
    expect(await readQemuConfig({}, 'n1', '100')).toEqual({ hostpci0: '02:00' })
    pveFetch.mockRejectedValueOnce(new Error('595')).mockRejectedValueOnce(new Error('595'))
    expect(await readQemuConfig({}, 'n1', '100')).toBeNull()
    pveFetch.mockRejectedValueOnce(new Error('595')).mockResolvedValueOnce(null)
    expect(await readQemuConfig({}, 'n1', '100')).toBeNull()
  })
})

describe('configFromPending', () => {
  // Rows as PVE 8 answers them for a running VM with pending changes.
  const rows = [
    { key: 'boot', value: 'order=scsi0' },
    { key: 'memory', value: 8192, pending: 16384 },
    { key: 'net1', value: 'virtio=BC:24:11:00:00:01,bridge=vmbr0', delete: 1 },
    { key: 'tags', delete: 2 },
    { key: 'hostpci0', value: 'mapping=vgpu-a,mdev=nvidia-665,pcie=1', delete: 1 },
    { key: 'hostpci1', value: 'mapping=gpu-w,pcie=1', pending: 'mapping=gpu-x,pcie=1' },
    { key: 'hostpci2', pending: 'mapping=vgpu-b,mdev=nvidia-665,pcie=1' },
    { key: 'smbios1', value: 'uuid=6f1c2a4e-1b2c-4d5e-8f90-123456789abc' },
  ]

  it('takes the pending value of every key and drops the keys deleted', () => {
    const config = configFromPending(rows)
    expect(config).toMatchObject({ boot: 'order=scsi0', memory: 16384, smbios1: 'uuid=6f1c2a4e-1b2c-4d5e-8f90-123456789abc' })
    expect(config).not.toHaveProperty('net1')
    expect(config).not.toHaveProperty('tags')
  })

  it('keeps a hostpciN marked for deletion at its current value: the VM holds it until it stops', () => {
    expect(configFromPending(rows).hostpci0).toBe('mapping=vgpu-a,mdev=nvidia-665,pcie=1')
  })

  it('takes the pending value of a hostpciN changed or added', () => {
    const config = configFromPending(rows)
    expect(config.hostpci1).toBe('mapping=gpu-x,pcie=1')
    expect(config.hostpci2).toBe('mapping=vgpu-b,mdev=nvidia-665,pcie=1')
  })

  it('tells which hostpciN are kept while their removal is pending', () => {
    expect([...pendingDeleteOf(configFromPending(rows))]).toEqual(['hostpci0'])
    expect(pendingDeleteOf(configFromPending([{ key: 'net1', value: 'x', delete: 1 }])).size).toBe(0)
    expect(pendingDeleteOf({ hostpci0: '01:00' }).size).toBe(0)
    expect(pendingDeleteOf(null).size).toBe(0)
  })

  it('ignores rows without a key', () => {
    expect(configFromPending([{ value: 'x' } as any, null as any, { key: 'name', value: 'ml' }])).toEqual({ name: 'ml' })
  })
})

describe('a GPU released from a running VM', () => {
  const A5000 = { id: '0000:03:00.0', class: '0x030200', vendor: '0x10de', device: '0x2231', vendor_name: 'NVIDIA Corporation', device_name: 'GA102GL [RTX A5000]', iommugroup: 35 }
  const line = { id: 'e-w', kind: 'whole' as const, modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', count: 1 }

  function cluster(pending9020: unknown[]) {
    routes({
      '/nodes': [{ node: 'n1', status: 'online' }],
      '/cluster/mapping/pci': [{ id: 'gpu-w', map: ['node=n1,path=0000:03:00'] }],
      '/nodes/n1/hardware/pci': [A5000],
      '/cluster/resources?type=vm': [
        { type: 'qemu', vmid: 9020, node: 'n1', name: 'web', status: 'running', pool: 'vdc-p', uptime: 3600 },
        { type: 'qemu', vmid: 9021, node: 'n1', name: 'db', status: 'stopped', pool: 'vdc-p' },
      ],
      '/nodes/n1/qemu/9020/pending': pending9020,
      '/nodes/n1/qemu/9021/pending': [{ key: 'name', value: 'db' }],
    })
  }

  async function usage() {
    const snap = await readConnectionGpus({}, CONN)
    const report = buildGpuReport([snap], { tenantPools: null, visibleNodes: null, visibleVms: null })
    const gpus = poolGpus(report, 'vdc-p', [])
    return { gpus, used: entryUsage([line], gpus).get('e-w') }
  }

  it('still counts on its line while the delete is pending', async () => {
    cluster([{ key: 'name', value: 'web' }, { key: 'hostpci0', value: 'mapping=gpu-w,pcie=1', delete: 1 }])
    const { gpus, used } = await usage()
    expect(gpus.map((g) => [g.vmid, g.hostpci, g.kind])).toEqual([['9020', 'hostpci0', 'whole']])
    expect(used).toBe(1)
  })

  it('counts the same once the delete is reverted, and none once the VM stopped', async () => {
    cluster([{ key: 'name', value: 'web' }, { key: 'hostpci0', value: 'mapping=gpu-w,pcie=1' }])
    expect((await usage()).used).toBe(1)
    cluster([{ key: 'name', value: 'web' }])
    expect((await usage()).used).toBe(0)
  })
})
