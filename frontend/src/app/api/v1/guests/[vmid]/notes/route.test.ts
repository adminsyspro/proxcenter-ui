import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { GET, PUT } from './route'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

const VM_KEY = 'conn-1:qemu:pve-node-01:101'

beforeEach(() => {
  vi.clearAllMocks()
  getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
})

describe('GET /api/v1/guests/[vmid]/notes', () => {
  it('returns the VM description as content', async () => {
    pveFetchMock.mockResolvedValue({ description: 'hello notes' })
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.content).toBe('hello notes')
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: 'conn-1' },
      '/nodes/pve-node-01/qemu/101/config',
    )
  })

  it('returns empty string when no description', async () => {
    pveFetchMock.mockResolvedValue({})
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data.content).toBe('')
  })

  it('404 when the connection cannot be resolved', async () => {
    getConnectionByIdMock.mockRejectedValue(new Error('nope'))
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: VM_KEY }) })
    expect(res.status).toBe(404)
  })

  it('500 on a malformed vmKey', async () => {
    const res = await GET(new Request('http://test.local/_'), { params: Promise.resolve({ vmid: 'bad-key' }) })
    expect(res.status).toBe(500)
  })
})

describe('PUT /api/v1/guests/[vmid]/notes', () => {
  it('writes the description via a PUT to the config endpoint', async () => {
    pveFetchMock.mockResolvedValue({})
    const res = await callRoute(PUT as any, { method: 'PUT', params: { vmid: VM_KEY }, body: { content: 'new note' } })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data.success).toBe(true)
    expect(pveFetchMock).toHaveBeenCalledWith(
      { id: 'conn-1' },
      '/nodes/pve-node-01/qemu/101/config',
      expect.objectContaining({
        method: 'PUT',
        body: 'description=new+note',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )
  })

  it('400 when content is not a string', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', params: { vmid: VM_KEY }, body: { content: 42 } })
    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('404 when the connection cannot be resolved', async () => {
    getConnectionByIdMock.mockRejectedValue(new Error('nope'))
    const res = await callRoute(PUT as any, { method: 'PUT', params: { vmid: VM_KEY }, body: { content: 'x' } })
    expect(res.status).toBe(404)
  })
})
