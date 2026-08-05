import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { VM_CREATE: 'vm.create' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))
vi.mock('@/lib/vdc/quota', () => ({ resolveVdcForTenant: vi.fn(async () => null), checkVdcQuota: vi.fn() }))
vi.mock('@/lib/vdc/vnets', () => ({
  getAllowedBridgesForTenant: vi.fn(async () => null),
  resolveSubnetForBridge: vi.fn(async () => null),
  parseBridgeFromNet: () => null,
}))
vi.mock('@/lib/vdc/sdn', () => ({ generatePveMacAddress: () => 'BC:24:11:00:00:01' }))
vi.mock('@/lib/vdc/ipam', () => ({ allocateIp: vi.fn(), releaseIp: vi.fn(), IpamExhaustedError: class extends Error {} }))
vi.mock('@/lib/vdc/network', () => ({ parseCidr: () => null }))
const { checkVmidAgainstTenantRangeMock } = vi.hoisted(() => ({ checkVmidAgainstTenantRangeMock: vi.fn() }))
vi.mock('@/lib/tenant/vmidRange', () => ({ checkVmidAgainstTenantRange: (...a: any[]) => checkVmidAgainstTenantRangeMock(...a) }))

async function loadPost() {
  const mod = await import('./route')
  return mod.POST as Parameters<typeof callRoute>[0]
}

const baseParams = { id: 'conn-1', type: 'qemu', node: 'pve1' }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockReset().mockResolvedValue('UPID:x')
  checkVmidAgainstTenantRangeMock.mockReset().mockResolvedValue({ ok: true })
})

describe('POST guests create — MSP VMID range enforcement', () => {
  it('ok: creates the guest and checks the range with the parsed vmid', async () => {
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(200)
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 190)
    const createCall = pveFetchMock.mock.calls.find(
      (c) => c[1] === '/nodes/pve1/qemu' && c[2]?.method === 'POST',
    )
    expect(createCall).toBeTruthy()
  })

  it('400: rejected by range check, PVE create never called', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'VMID must be within your tenant range 200-300' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(400)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('tenant range')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('409: already in use, PVE create never called', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 409, error: 'VMID 190 is already in use in your infrastructure' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: baseParams, body: { vmid: 190 } })
    expect(res.status).toBe(409)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('enforces the same range check for lxc containers', async () => {
    checkVmidAgainstTenantRangeMock.mockResolvedValue({ ok: false, status: 400, error: 'VMID must be within your tenant range 200-300' })
    const POST = await loadPost()
    const res = await callRoute(POST, { params: { ...baseParams, type: 'lxc' }, body: { vmid: 190 } })
    expect(res.status).toBe(400)
    expect(checkVmidAgainstTenantRangeMock).toHaveBeenCalledWith('tenant-1', 190)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
