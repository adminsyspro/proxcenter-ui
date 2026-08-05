import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const customImageFindUniqueMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    customImage: { findUnique: customImageFindUniqueMock },
    deployment: { create: vi.fn(async () => ({ id: 'dep-1' })) },
    blueprint: { create: vi.fn(async () => ({})) },
  }),
  getCurrentTenantId: async () => 'tenant-1',
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { VM_CREATE: 'vm.create' } }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/schemas', () => ({ deploySchema: { safeParse: (b: any) => ({ success: true, data: b }) } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/templates/cloudImages', () => ({ getImageBySlug: () => undefined, customImageToCloudImage: vi.fn() }))
vi.mock('@/lib/proxmox/storage', () => ({ isFileBasedStorage: () => true, supportsVmDisks: () => true }))
vi.mock('@/lib/vdc/quota', () => ({ resolveVdcForTenant: vi.fn(async () => null), checkVdcQuota: vi.fn() }))
vi.mock('@/lib/vdc/vnets', () => ({
  getAllowedBridgesForTenant: vi.fn(async () => null),
  resolveSubnetForBridge: vi.fn(async () => null),
}))
vi.mock('@/lib/vdc/sdn', () => ({ generatePveMacAddress: () => 'BC:24:11:00:00:01' }))
vi.mock('@/lib/vdc/ipam', () => ({ allocateIp: vi.fn(), releaseIp: vi.fn(), IpamExhaustedError: class extends Error {} }))
vi.mock('@/lib/vdc/ipamScan', () => ({ scanUsedIpsForSubnet: vi.fn(), scannedToIntSet: vi.fn(() => new Set()) }))
vi.mock('@/lib/vdc/network', () => ({ parseCidr: () => null }))
vi.mock('@/lib/proxmox/tasks', () => ({ waitForTask: vi.fn() }))
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: vi.fn(async () => null) }))

const { checkVmidAgainstTenantRangeMock } = vi.hoisted(() => ({ checkVmidAgainstTenantRangeMock: vi.fn() }))
vi.mock('@/lib/tenant/vmidRange', () => ({ checkVmidAgainstTenantRange: (...a: any[]) => checkVmidAgainstTenantRangeMock(...a) }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const baseBody = {
  connectionId: 'conn-1',
  node: 'pve1',
  vmid: 190,
  imageSlug: 'ubuntu-22.04',
  storage: 'local-lvm',
  hardware: { cores: 1, sockets: 1, memory: 512, ostype: 'l26', cpu: 'host', scsihw: 'virtio-scsi-pci', diskSize: '10G', networkModel: 'virtio', networkBridge: 'vmbr0' },
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockReset()
  customImageFindUniqueMock.mockReset().mockResolvedValue(null)
  checkVmidAgainstTenantRangeMock.mockReset().mockResolvedValue({ ok: true })
})

describe('POST templates/deploy — MSP VMID range enforcement', () => {
  it('400: rejected by range check before PVE is ever touched', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'range' })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('range')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('409: already in use', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 409, error: 'in use' })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    expect(res.status).toBe(409)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('ok: passes the gate and reaches the next early-exit (unknown image slug)', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: true })
    const POST = await loadPost()
    const res = await callRoute(POST, { body: baseBody })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toBe('Unknown image slug')
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 190)
  })
})
