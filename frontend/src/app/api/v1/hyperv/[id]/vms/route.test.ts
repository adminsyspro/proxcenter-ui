/**
 * Tests for GET /api/v1/hyperv/[id]/vms: host derivation from baseUrl and
 * the mapping of Hyper-V VMs to the migration UI format.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn() } },
  ctor: vi.fn(),
  listVMs: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { CONNECTION_VIEW: 'connection.view' } }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: vi.fn(() => 'admin:pw') }))
vi.mock('@/lib/hyperv/log', () => ({ withHypervLog: vi.fn((_w: string, _n: string, _h: string, run: () => Promise<any>) => run()) }))
vi.mock('@/lib/hyperv/client', () => ({
  HyperVClient: class {
    constructor(opts: any) { h.ctor(opts) }
    listVMs(opts: any) { return h.listVMs(opts) }
  },
}))

import { GET } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

beforeEach(() => {
  h.ctor.mockReset()
  h.listVMs.mockReset().mockResolvedValue([
    { vmId: 'guid-1', name: 'dc01', state: 'Running', cpuCount: 2, memoryMB: 4096, diskSizeBytes: 1000, diskPaths: ['C:\\VMs\\dc01.vhdx'], diskMountPaths: [], generation: 2 },
    { vmId: 'guid-2', name: 'old', state: 'Off', cpuCount: 0, memoryMB: 0, diskSizeBytes: 0, diskPaths: [], diskMountPaths: [], generation: 1 },
  ])
})

describe('GET /api/v1/hyperv/[id]/vms', () => {
  it.each([
    ['https://hv01.lab.local:5986///', 'hv01.lab.local', true],
    ['http://10.42.0.190/', '10.42.0.190', false],
    ['hv02', 'hv02', false],
  ])('derives host from %s and maps the VM list', async (baseUrl, host, useSSL) => {
    h.prisma.connection.findUnique.mockResolvedValue({ id: 'c1', name: 'hv-lab', baseUrl, apiTokenEnc: 'e', insecureTLS: false, type: 'hyperv', hypervShareName: 'VMs$' })
    const res = await callRoute(GET, { params: { id: 'c1' } })
    expect(res.status).toBe(200)
    expect(h.ctor).toHaveBeenCalledWith({ host, username: 'admin', password: 'pw', useSSL })
    expect(h.listVMs).toHaveBeenCalledWith({ shareName: 'VMs$' })
    const body = await readJson<any>(res)
    expect(body.data.connectionName).toBe('hv-lab')
    expect(body.data.vms).toEqual([
      { vmid: 'guid-1', name: 'dc01', status: 'running', cpu: 2, memory_size_MiB: 4096, power_state: 'Running', committed: 1000, diskPaths: ['C:\\VMs\\dc01.vhdx'], diskMountPaths: [], generation: 2 },
      { vmid: 'guid-2', name: 'old', status: 'stopped', cpu: undefined, memory_size_MiB: undefined, power_state: 'Off', committed: undefined, diskPaths: [], diskMountPaths: [], generation: 1 },
    ])
  })
})
