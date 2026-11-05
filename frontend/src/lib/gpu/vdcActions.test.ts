import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  pve: vi.fn(),
  write: vi.fn(),
  entries: vi.fn(),
  latest: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pve(...a) }))
vi.mock('@/lib/proxmox/guestConfigWrite', () => ({ writeGuestConfig: (...a: unknown[]) => m.write(...a) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findFirst: async () => ({ id: 'c1', tenantId: 'default', name: 'PROD' }) } } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'c1' }) }))
vi.mock('@/lib/gpu/vdcEntries', () => ({ listVdcGpuEntries: (...a: unknown[]) => m.entries(...a) }))
vi.mock('@/lib/gpu/guard', () => ({ sessionUser: async () => ({ id: 'u1' }) }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => true }))
vi.mock('@/lib/vdc', () => ({ getVdcById: async () => null }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getCurrentTenantId: async () => 't1' }))
vi.mock('@/lib/audit', () => ({ audit: async () => 'a1' }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_CONFIG_HARDWARE: 'vm.config.hardware' },
  checkPermission: async () => null,
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
}))
vi.mock('@/lib/gpu/metrics', async () => {
  const actual = await vi.importActual<typeof import('@/lib/gpu/metrics')>('@/lib/gpu/metrics')
  return { ...actual, getGpuMetricsLatest: () => m.latest() }
})

import { resetGpuSnapshotCache } from './collect'
import { parseVdcGpuAction, runVdcGpuAction } from './vdcActions'
import { resetVdcPending } from './vdcPending'

describe('parseVdcGpuAction', () => {
  it('reads an attach and a release, the vmid as a string', () => {
    expect(parseVdcGpuAction({ action: 'attach', vmid: 9020, entryId: 'clx1abc_-9' })).toEqual({ action: 'attach', vmid: '9020', entryId: 'clx1abc_-9' })
    expect(parseVdcGpuAction({ action: 'release', vmid: '9020', hostpci: 'hostpci15' })).toEqual({ action: 'release', vmid: '9020', hostpci: 'hostpci15' })
  })

  it('keeps only the fields of the action', () => {
    expect(parseVdcGpuAction({ action: 'attach', vmid: '1', entryId: 'e', node: 'n1', deviceKey: 'k' })).toEqual({ action: 'attach', vmid: '1', entryId: 'e' })
  })

  it.each([
    null,
    'attach',
    [],
    { action: 'attach', vmid: 'abc', entryId: 'e' },
    { action: 'attach', vmid: '1234567890', entryId: 'e' },
    { action: 'attach', vmid: '9020' },
    { action: 'attach', vmid: '9020', entryId: '../e' },
    { action: 'attach', vmid: '9020', entryId: 'e'.repeat(65) },
    { action: 'release', vmid: '9020', hostpci: 'hostpci16' },
    { action: 'release', vmid: '9020', hostpci: 'hostpci17' },
    { action: 'release', vmid: '9020', hostpci: 'net0' },
    { action: 'release', vmid: '9020' },
    { action: 'detach', vmid: '9020', entryId: 'e' },
  ])('refuses %j', (raw) => {
    expect(parseVdcGpuAction(raw)).toBeNull()
  })
})

describe('runVdcGpuAction on a GPU released from a running VM', () => {
  const vdc = { id: 'vdc-1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'vdc-p', enabled: true }
  const card = (slot: string) => ({ id: `${slot}.0`, class: '0x030200', vendor: '0x10de', device: '0x2231', vendor_name: 'NVIDIA Corporation', device_name: 'GA102GL [RTX A5000]', iommugroup: Number(slot.slice(5, 7)) })
  const line = { id: 'e-w', kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', count: 1 }
  // What PVE holds for VM 9020: its GPU, and whether a delete of it is pending.
  let state: { held: boolean; pendingDelete: boolean }

  beforeEach(() => {
    vi.clearAllMocks()
    resetGpuSnapshotCache()
    resetVdcPending()
    state = { held: true, pendingDelete: false }
    m.entries.mockResolvedValue([line])
    m.latest.mockRejectedValue(new Error('orchestrator down'))
    m.write.mockImplementation(async ({ body }: { body: string }) => {
      if (body.startsWith('delete=hostpci0')) state.pendingDelete = true
      return { state: 'done', upid: null }
    })
    m.pve.mockImplementation(async (_conn: unknown, path: string) => {
      const hostpci0 = 'mapping=gpu-w,pcie=1'
      const table: Record<string, unknown> = {
        '/nodes': [{ node: 'n1', status: 'online' }],
        '/cluster/mapping/pci': [
          { id: 'gpu-w', map: ['node=n1,path=0000:03:00'] },
          { id: 'gpu-x', map: ['node=n1,path=0000:04:00'] },
        ],
        '/nodes/n1/hardware/pci': [card('0000:03:00'), card('0000:04:00')],
        '/cluster/resources?type=vm': [
          { type: 'qemu', vmid: 9020, node: 'n1', name: 'web', status: 'running', pool: 'vdc-p', uptime: 3600 },
          { type: 'qemu', vmid: 9021, node: 'n1', name: 'db', status: 'stopped', pool: 'vdc-p' },
        ],
        '/pools/vdc-p': { members: [
          { type: 'qemu', vmid: 9020, name: 'web', status: 'running', node: 'n1' },
          { type: 'qemu', vmid: 9021, name: 'db', status: 'stopped', node: 'n1' },
        ] },
        '/nodes/n1/qemu/9020/pending': [
          { key: 'digest', value: 'd1' },
          ...(state.held ? [{ key: 'hostpci0', value: hostpci0, ...(state.pendingDelete ? { delete: 1 } : {}) }] : []),
        ],
        // A plain /config read answers the pending values.
        '/nodes/n1/qemu/9020/config': { digest: 'd1', ...(state.held && !state.pendingDelete ? { hostpci0 } : {}) },
        '/nodes/n1/qemu/9020/status/current': { status: 'running' },
        '/nodes/n1/qemu/9021/pending': [{ key: 'digest', value: 'd2' }],
        '/nodes/n1/qemu/9021/config': { digest: 'd2' },
        '/nodes/n1/qemu/9021/status/current': { status: 'stopped' },
      }
      if (!(path in table)) throw new Error(`unexpected ${path}`)
      return table[path]
    })
  })

  it('keeps the line full: an attach on another VM is refused until the first one stops', async () => {
    const released = await runVdcGpuAction(vdc, { action: 'release', vmid: '9020', hostpci: 'hostpci0' })
    expect(released.status).toBe(200)
    expect(await released.json()).toEqual({ data: { hostpci: 'hostpci0', pendingStart: true } })
    expect(state.pendingDelete).toBe(true)

    const refused = await runVdcGpuAction(vdc, { action: 'attach', vmid: '9021', entryId: 'e-w' })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: 'quota_exhausted', used: 1, count: 1 })
    expect(m.write).toHaveBeenCalledTimes(1)

    // The VM stopped: PVE applied the delete, the line frees up.
    state = { held: false, pendingDelete: false }
    const attached = await runVdcGpuAction(vdc, { action: 'attach', vmid: '9021', entryId: 'e-w' })
    expect(attached.status).toBe(200)
    expect(m.write).toHaveBeenCalledTimes(2)
  })

  it('a revert of the pending delete changes nothing to the count', async () => {
    await runVdcGpuAction(vdc, { action: 'release', vmid: '9020', hostpci: 'hostpci0' })
    state.pendingDelete = false
    const refused = await runVdcGpuAction(vdc, { action: 'attach', vmid: '9021', entryId: 'e-w' })
    expect(await refused.json()).toEqual({ error: 'quota_exhausted', used: 1, count: 1 })
  })
})

describe('runVdcGpuAction: release then attach on the same running VM', () => {
  const vdc = { id: 'vdc-1', tenantId: 't1', connectionId: 'c1', pvePoolName: 'vdc-p', enabled: true }
  // Two models, one whole-card line each: an A5000 (line A) and an A10 (line B).
  const pci = [
    { id: '0000:03:00.0', class: '0x030200', vendor: '0x10de', device: '0x2231', vendor_name: 'NVIDIA Corporation', device_name: 'GA102GL [RTX A5000]', iommugroup: 30 },
    { id: '0000:04:00.0', class: '0x030200', vendor: '0x10de', device: '0x2236', vendor_name: 'NVIDIA Corporation', device_name: 'GA102GL [A10]', iommugroup: 40 },
    { id: '0000:05:00.0', class: '0x030200', vendor: '0x10de', device: '0x2231', vendor_name: 'NVIDIA Corporation', device_name: 'GA102GL [RTX A5000]', iommugroup: 50 },
  ]
  const lines = [
    { id: 'e-a', kind: 'whole', modelKey: '0x10de:0x2231', modelName: 'RTX A5000', profileName: '', count: 1 },
    { id: 'e-b', kind: 'whole', modelKey: '0x10de:0x2236', modelName: 'A10', profileName: '', count: 1 },
  ]
  // The /pending rows of each VM, written to as PVE would on a running VM.
  type Row = { key: string; value?: string; pending?: string; delete?: number }
  let rows: Record<string, Row[]>

  beforeEach(() => {
    vi.clearAllMocks()
    resetGpuSnapshotCache()
    resetVdcPending()
    rows = {
      9020: [{ key: 'digest', value: 'd1' }, { key: 'hostpci0', value: 'mapping=gpu-a' }],
      9021: [{ key: 'digest', value: 'd2' }],
    }
    m.entries.mockResolvedValue(lines)
    m.latest.mockRejectedValue(new Error('orchestrator down'))
    m.write.mockImplementation(async ({ vmid, body }: { vmid: string; body: string }) => {
      for (const [k, v] of new URLSearchParams(body)) {
        if (k === 'digest') continue
        const list = rows[vmid]
        if (k === 'delete') {
          for (const key of v.split(',')) {
            const row = list.find((r) => r.key === key)
            if (row) Object.assign(row, { delete: 1, pending: undefined })
          }
          continue
        }
        const row = list.find((r) => r.key === k)
        if (row) Object.assign(row, { pending: v, delete: undefined })
        else list.push({ key: k, pending: v })
      }
      return { state: 'done', upid: null }
    })
    m.pve.mockImplementation(async (_conn: unknown, path: string) => {
      const vm = /\/qemu\/(\d+)\/(pending|status\/current)$/.exec(path)
      if (vm) return vm[2] === 'pending' ? rows[vm[1]] : { status: 'running' }
      const table: Record<string, unknown> = {
        '/nodes': [{ node: 'n1', status: 'online' }],
        '/cluster/mapping/pci': [
          { id: 'gpu-a', map: ['node=n1,path=0000:03:00'] },
          { id: 'gpu-b', map: ['node=n1,path=0000:04:00'] },
          { id: 'gpu-a2', map: ['node=n1,path=0000:05:00'] },
        ],
        '/nodes/n1/hardware/pci': pci,
        '/cluster/resources?type=vm': [
          { type: 'qemu', vmid: 9020, node: 'n1', name: 'web', status: 'running', pool: 'vdc-p', uptime: 3600 },
          { type: 'qemu', vmid: 9021, node: 'n1', name: 'db', status: 'running', pool: 'vdc-p', uptime: 60 },
        ],
        '/pools/vdc-p': { members: [
          { type: 'qemu', vmid: 9020, name: 'web', status: 'running', node: 'n1' },
          { type: 'qemu', vmid: 9021, name: 'db', status: 'running', node: 'n1' },
        ] },
      }
      if (!(path in table)) throw new Error(`unexpected ${path}`)
      return table[path]
    })
  })

  it('never reuses the pending-deleted slot: line A stays counted while the VM runs its card', async () => {
    expect((await runVdcGpuAction(vdc, { action: 'release', vmid: '9020', hostpci: 'hostpci0' })).status).toBe(200)

    const b = await runVdcGpuAction(vdc, { action: 'attach', vmid: '9020', entryId: 'e-b' })
    expect(b.status).toBe(200)
    expect(await b.json()).toEqual({ data: { hostpci: 'hostpci1', pendingStart: true } })
    expect(rows[9020].find((r) => r.key === 'hostpci0')).toMatchObject({ value: 'mapping=gpu-a', delete: 1 })

    const a = await runVdcGpuAction(vdc, { action: 'attach', vmid: '9021', entryId: 'e-a' })
    expect(a.status).toBe(409)
    expect(await a.json()).toEqual({ error: 'quota_exhausted', used: 1, count: 1 })
    expect(m.write).toHaveBeenCalledTimes(2)
  })

  it('a second release of the pending-deleted GPU answers released without a write', async () => {
    await runVdcGpuAction(vdc, { action: 'release', vmid: '9020', hostpci: 'hostpci0' })
    const again = await runVdcGpuAction(vdc, { action: 'release', vmid: '9020', hostpci: 'hostpci0' })
    expect(await again.json()).toEqual({ data: { hostpci: 'hostpci0', pendingStart: true } })
    expect(m.write).toHaveBeenCalledTimes(1)
  })
})
