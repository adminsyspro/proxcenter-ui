/**
 * Tests for GET /api/v1/hyperv/[id]/vms/[vmid]: host derivation from baseUrl
 * and the single-VM detail mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: { connection: { findUnique: vi.fn() } },
  ctor: vi.fn(),
  getVM: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { CONNECTION_VIEW: 'connection.view' } }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: vi.fn(() => 'nopassword-only') }))
vi.mock('@/lib/hyperv/log', () => ({ withHypervLog: vi.fn((_w: string, _n: string, _h: string, run: () => Promise<any>) => run()) }))
vi.mock('@/lib/hyperv/client', () => ({
  HyperVClient: class {
    constructor(opts: any) { h.ctor(opts) }
    getVM(id: string, opts: any) { return h.getVM(id, opts) }
  },
}))

import { GET } from './route'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

beforeEach(() => {
  h.ctor.mockReset()
  h.getVM.mockReset().mockResolvedValue({
    vmId: 'guid-1', name: 'sql01', state: 'Paused', cpuCount: 4, memoryMB: 8192, diskSizeBytes: 5000,
    generation: 2, diskPaths: ['D:\\sql01.vhdx'], diskMountPaths: ['\\\\hv\\VMs$\\sql01.vhdx'],
  })
})

describe('GET /api/v1/hyperv/[id]/vms/[vmid]', () => {
  it.each([
    ['https://hv01.lab.local:5986//', 'hv01.lab.local', true, false],
    ['https://hv01.lab.local/', 'hv01.lab.local', false, true],
    ['10.42.0.190', '10.42.0.190', false, false],
  ])('derives host from %s and maps the VM', async (baseUrl, host, useSSL, insecureTLS) => {
    h.prisma.connection.findUnique.mockResolvedValue({ id: 'c1', name: 'hv-lab', baseUrl, apiTokenEnc: 'e', insecureTLS, type: 'hyperv', hypervShareName: null })
    const res = await callRoute(GET, { params: { id: 'c1', vmid: 'guid-1' } })
    expect(res.status).toBe(200)
    expect(h.ctor).toHaveBeenCalledWith({ host, username: 'Administrator', password: 'nopassword-only', useSSL })
    expect(h.getVM).toHaveBeenCalledWith('guid-1', { shareName: null })
    expect((await readJson<any>(res)).data).toEqual({
      vmid: 'guid-1', name: 'sql01', status: 'suspended', powerState: 'Paused', numCPU: 4, memoryMB: 8192, committed: 5000,
      guestOS: 'Hyper-V Gen 2', firmware: 'efi', diskPaths: ['D:\\sql01.vhdx'], diskMountPaths: ['\\\\hv\\VMs$\\sql01.vhdx'],
      connectionId: 'c1', connectionName: 'hv-lab',
    })
  })
})
