import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/connections/getConnection', () => ({
  // The not-found vs real-error mapping now lives in getConnectionByIdOrNull
  // (unit-tested in getConnection.test.ts); the route just consumes its result.
  getConnectionByIdOrNull: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { GET } from './route'
import { getConnectionByIdOrNull } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const getConnectionByIdOrNullMock = getConnectionByIdOrNull as any
const pveFetchMock = pveFetch as any

const QEMU_VM_KEY = 'conn-1:qemu:pve-node-01:101'
const LXC_VM_KEY = 'conn-1:lxc:pve-node-01:200'

beforeEach(() => {
  vi.clearAllMocks()
  getConnectionByIdOrNullMock.mockResolvedValue({ id: 'conn-1' })
})

describe('GET /api/v1/guests/[vmid]/features', () => {
  it('400 when feature query param is missing', async () => {
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: QEMU_VM_KEY },
    })
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/feature/i)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns hasFeature: true for qemu without calling pveFetch', async () => {
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: QEMU_VM_KEY },
      searchParams: { feature: 'snapshot' },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.hasFeature).toBe(true)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns hasFeature: true for lxc when PVE confirms the feature', async () => {
    pveFetchMock.mockResolvedValue({ hasFeature: 1 })
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: LXC_VM_KEY },
      searchParams: { feature: 'snapshot' },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.hasFeature).toBe(true)
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: 'conn-1' },
      '/nodes/pve-node-01/lxc/200/feature?feature=snapshot',
    )
  })

  it('returns hasFeature: false for lxc when PVE returns falsy hasFeature', async () => {
    pveFetchMock.mockResolvedValue({ hasFeature: 0 })
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: LXC_VM_KEY },
      searchParams: { feature: 'snapshot' },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.hasFeature).toBe(false)
  })

  it('returns hasFeature: false for lxc when PVE returns null result', async () => {
    pveFetchMock.mockResolvedValue(null)
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: LXC_VM_KEY },
      searchParams: { feature: 'snapshot' },
    })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.hasFeature).toBe(false)
  })

  it('404 when the connection cannot be resolved for lxc', async () => {
    // getConnectionByIdOrNull maps a genuine not-found to null
    getConnectionByIdOrNullMock.mockResolvedValue(null)
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: LXC_VM_KEY },
      searchParams: { feature: 'snapshot' },
    })
    expect(res.status).toBe(404)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/not found/i)
  })

  it('500 when getConnection fails with a non-not-found error (no longer masked)', async () => {
    getConnectionByIdOrNullMock.mockRejectedValue(new Error('DB error'))
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: LXC_VM_KEY },
      searchParams: { feature: 'snapshot' },
    })
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/DB error/i)
  })

  it('500 with the error message when pveFetch throws', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE unreachable'))
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: LXC_VM_KEY },
      searchParams: { feature: 'snapshot' },
    })
    // A real PVE error must surface as a 500, not be masked as hasFeature: false
    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/PVE unreachable/i)
  })

  it('400 on a malformed vmKey', async () => {
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: 'bad-key' },
      searchParams: { feature: 'snapshot' },
    })
    // parseVmKey throws "Invalid vmKey ..." which is a client error
    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/invalid vmkey/i)
  })

  it('url-encodes the feature name in the PVE api path', async () => {
    pveFetchMock.mockResolvedValue({ hasFeature: 1 })
    const res = await callRoute(GET as any, {
      method: 'GET',
      params: { vmid: LXC_VM_KEY },
      searchParams: { feature: 'snap shot' },
    })
    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: 'conn-1' },
      '/nodes/pve-node-01/lxc/200/feature?feature=snap%20shot',
    )
  })
})
