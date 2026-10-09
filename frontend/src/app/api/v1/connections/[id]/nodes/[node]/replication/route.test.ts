/**
 * PUT of a replication job: a cleared rate or comment must be removed on the
 * Proxmox side, which only happens through the `delete` parameter.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { PUT, POST } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const pveFetchMock = pveFetch as any
const params = { id: 'conn-1', node: 'pve1' }

function sentParams(callIndex = 0): Record<string, string> {
  const init = pveFetchMock.mock.calls[callIndex][2]

  return Object.fromEntries(new URLSearchParams(init.body as URLSearchParams))
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(checkPermission as any).mockResolvedValue(null)
  ;(getConnectionById as any).mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockResolvedValue(null)
})

describe('PUT /connections/[id]/nodes/[node]/replication', () => {
  it('deletes the rate and the comment when they are cleared', async () => {
    const res = await callRoute(PUT, { method: 'PUT', params, body: { jobId: '100-0', schedule: '*/3', rate: '', comment: '', enabled: true } })

    expect(res.status).toBe(200)
    expect(pveFetchMock.mock.calls[0][1]).toBe('/cluster/replication/100-0')
    expect(sentParams()).toEqual({ schedule: '*/3', disable: '0', delete: 'rate,comment' })
  })

  it('sends the rate and the comment when they are set', async () => {
    await callRoute(PUT, { method: 'PUT', params, body: { jobId: '100-0', rate: 50, comment: 'nightly', enabled: false } })

    expect(sentParams()).toEqual({ rate: '50', comment: 'nightly', disable: '1' })
  })

  it('leaves untouched options out of the request', async () => {
    await callRoute(PUT, { method: 'PUT', params, body: { jobId: '100-0', schedule: 'hourly' } })

    expect(sentParams()).toEqual({ schedule: 'hourly' })
  })
})

describe('POST /connections/[id]/nodes/[node]/replication', () => {
  it('returns the Proxmox refusal to the caller', async () => {
    pveFetchMock.mockResolvedValueOnce([])
    pveFetchMock.mockRejectedValueOnce(new Error("value does not match the regex pattern: schedule: unable to parse calendar event"))

    const res = await callRoute(POST, { params, body: { guest: '100', target: 'pve2', schedule: '0 0' } })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: expect.stringContaining('unable to parse calendar event') })
  })
})
