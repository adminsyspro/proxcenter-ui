import { describe, it, expect, vi, beforeEach } from 'vitest'

const { pveFetchMock, getTenantInfrastructureScopeMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getTenantInfrastructureScopeMock: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', async io => ({
  ...await io<typeof import('@/lib/proxmox/client')>(),
  pveFetch: pveFetchMock,
}))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))

import { checkTenantGuestScope } from './guestScope'

const conn = { id: 'conn-1' } as any

function iaasInfra() {
  return {
    kind: 'iaas',
    vdcScope: {
      connectionIds: new Set(['conn-1']),
      nodesByConnection: new Map([['conn-1', new Set(['pve3'])]]),
      poolsByConnection: new Map([['conn-1', new Set(['pool-1'])]]),
    },
  }
}

const RESOURCES = [
  { vmid: 100, type: 'qemu', node: 'pve3', pool: 'pool-1' },
  { vmid: 101, type: 'lxc', node: 'pve3', pool: 'pool-1' },
  { vmid: 200, type: 'qemu', node: 'pve3', pool: 'other-tenant' },
]

beforeEach(() => {
  pveFetchMock.mockReset().mockResolvedValue(RESOURCES)
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue(iaasInfra())
})

describe('checkTenantGuestScope', () => {
  it('admits a guest inside a vDC pool', async () => {
    expect(await checkTenantGuestScope('tenant-1', conn, 'conn-1', 'qemu', 'pve3', '100')).toBeNull()
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('tenant-1', { ignoreVdcContext: true })
  })

  it('refuses a guest outside the vDC pools with 403', async () => {
    const res = await checkTenantGuestScope('tenant-1', conn, 'conn-1', 'qemu', 'pve3', '200')
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'Guest outside your vDC scope' })
  })

  it('a null type accepts both qemu and lxc guests', async () => {
    expect(await checkTenantGuestScope('tenant-1', conn, 'conn-1', null, 'pve3', '100')).toBeNull()
    expect(await checkTenantGuestScope('tenant-1', conn, 'conn-1', null, 'pve3', '101')).toBeNull()
  })

  it('a typed lookup never matches a guest of the other type', async () => {
    const res = await checkTenantGuestScope('tenant-1', conn, 'conn-1', 'qemu', 'pve3', '101')
    expect(res?.status).toBe(403)
  })

  it('a null node accepts any vDC node but still confines the guest to the vDC pools', async () => {
    expect(await checkTenantGuestScope('tenant-1', conn, 'conn-1', null, null, '100')).toBeNull()
    const res = await checkTenantGuestScope('tenant-1', conn, 'conn-1', null, null, '200')
    expect(res?.status).toBe(403)
  })

  it('a null node still refuses a guest running on a node outside the vDC', async () => {
    pveFetchMock.mockResolvedValue([{ vmid: 100, type: 'qemu', node: 'pve9', pool: 'pool-1' }])
    const res = await checkTenantGuestScope('tenant-1', conn, 'conn-1', null, null, '100')
    expect(res?.status).toBe(403)
  })

  it('a named node outside the vDC is refused before any PVE call', async () => {
    const res = await checkTenantGuestScope('tenant-1', conn, 'conn-1', 'qemu', 'pve9', '100')
    expect(res?.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('a non-iaas tenant is not confined', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['conn-1']) })
    expect(await checkTenantGuestScope('tenant-1', conn, 'conn-1', 'qemu', 'pve3', '200')).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('503 when PVE cannot list the guests', async () => {
    pveFetchMock.mockRejectedValue(new Error('down'))
    const res = await checkTenantGuestScope('tenant-1', conn, 'conn-1', 'qemu', 'pve3', '100')
    expect(res?.status).toBe(503)
    expect(await res?.json()).toEqual({ error: 'Unable to verify guest vDC scope' })
  })
})
