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

import { checkTenantGuestScope, checkTenantGuestsScope, tenantGuestVisibility } from './guestScope'

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

describe('checkTenantGuestsScope (a vmid list)', () => {
  it('lists the guests and resolves the vDC scope once for the whole list', async () => {
    expect(await checkTenantGuestsScope('tenant-1', conn, 'conn-1', null, null, ['100', '101'])).toBeNull()
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledTimes(1)
  })

  it('refuses the list when one guest is outside the vDC pools', async () => {
    const res = await checkTenantGuestsScope('tenant-1', conn, 'conn-1', null, null, ['100', '200', '101'])
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'Guest outside your vDC scope' })
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('an empty list confines nothing, so an iaas tenant is refused', async () => {
    const res = await checkTenantGuestsScope('tenant-1', conn, 'conn-1', null, null, [])
    expect(res?.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('a non-iaas tenant is not confined, whatever the list', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    expect(await checkTenantGuestsScope('tenant-1', conn, 'conn-1', null, null, ['200'])).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('reuses a pre-resolved infrastructure scope instead of looking it up', async () => {
    expect(await checkTenantGuestsScope('tenant-1', conn, 'conn-1', 'qemu', 'pve3', ['100'], false, iaasInfra() as any)).toBeNull()
    expect(getTenantInfrastructureScopeMock).not.toHaveBeenCalled()
  })
})

describe('tenantGuestVisibility (masking of cluster-wide lists)', () => {
  const visibilityOf = async (opts?: Parameters<typeof tenantGuestVisibility>[3]) => {
    const result = await tenantGuestVisibility('tenant-1', conn, 'conn-1', opts)
    if (result instanceof Response) throw new Error(`unexpected response ${result.status}`)
    return result
  }

  it('a provider or MSP tenant sees every guest, without any PVE call', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    const visible = await visibilityOf()
    expect(visible.all).toBe(true)
    expect(visible.has('qemu', '200')).toBe(true)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('an iaas tenant sees the guests of its pools on its nodes, from one cluster listing', async () => {
    const visible = await visibilityOf()
    expect(visible.all).toBe(false)
    expect(visible.has('qemu', '100')).toBe(true)
    expect(visible.has('lxc', 101)).toBe(true)
    expect(visible.has('qemu', '200')).toBe(false)
    expect(visible.has('lxc', '100')).toBe(false)
    expect(visible.has(null, '101')).toBe(true)
    expect(visible.has(null, '200')).toBe(false)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(pveFetchMock).toHaveBeenCalledWith(conn, '/cluster/resources?type=vm')
  })

  it('a guest of a vDC pool running on a node outside the vDC is hidden', async () => {
    pveFetchMock.mockResolvedValue([{ vmid: 100, type: 'qemu', node: 'pve9', pool: 'pool-1' }])
    expect((await visibilityOf()).has('qemu', '100')).toBe(false)
  })

  it('reads nothing when the caller hands over its own cluster listing', async () => {
    const resources = [...RESOURCES, { type: 'node', node: 'pve3' }, { type: 'storage', storage: 'local' }]
    const visible = await visibilityOf({ resources })
    expect(visible.has('qemu', '100')).toBe(true)
    expect(visible.has('qemu', '200')).toBe(false)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('a connection outside the vDC shows no guest at all, before any PVE call', async () => {
    const result = await tenantGuestVisibility('tenant-1', conn, 'conn-9')
    if (result instanceof Response) throw new Error('unexpected response')
    expect(result.all).toBe(false)
    expect(result.has('qemu', '100')).toBe(false)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('503 when PVE cannot list the guests, never an unmasked view', async () => {
    pveFetchMock.mockRejectedValue(new Error('down'))
    const result = await tenantGuestVisibility('tenant-1', conn, 'conn-1')
    expect(result instanceof Response && result.status).toBe(503)
  })

  it('503 when the listing is not a list', async () => {
    const result = await tenantGuestVisibility('tenant-1', conn, 'conn-1', { resources: { data: 'nope' } })
    expect(result instanceof Response && result.status).toBe(503)
  })
})
