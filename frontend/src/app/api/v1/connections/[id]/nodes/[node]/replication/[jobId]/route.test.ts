import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// The vDC guest guard (lib/vdc/guestGuard.ts) has its own tests: pass-through
// here, as for a provider session. The job id grammar check stays the real one.
vi.mock('@/lib/vdc/guestGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/vdc/guestGuard')>()),
  guardSessionGuest: async () => null,
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    NODE_VIEW: 'node.view',
    NODE_MANAGE: 'node.manage',
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { GET, POST, DELETE } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const checkPermissionMock = checkPermission as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

const CONN = { id: 'conn-1' }
// A Proxmox replication job id is <vmid>-<n>.
const BASE_PARAMS = { id: 'conn-1', node: 'pve-node-01', jobId: '100-0' }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
  pveFetchMock.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/connections/[id]/nodes/[node]/replication/[jobId]', () => {
  it('returns 200 with formatted log entries (string entries)', async () => {
    pveFetchMock.mockResolvedValue(['line one', 'line two'])

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toEqual(['line one', 'line two'])
  })

  it('returns 200 with formatted log entries (object entries with .t field)', async () => {
    pveFetchMock.mockResolvedValue([{ t: 'replicated 1024 bytes', n: 1 }, { t: 'done', n: 2 }])

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toEqual(['replicated 1024 bytes', 'done'])
  })

  it('returns 200 with JSON-stringified entries when entry has no .t field', async () => {
    pveFetchMock.mockResolvedValue([{ level: 'info', msg: 'ok' }])

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data[0]).toBe('{"level":"info","msg":"ok"}')
  })

  it('returns empty data array when pveFetch returns a non-array', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toEqual([])
  })

  it('uses the limit query param when provided', async () => {
    pveFetchMock.mockResolvedValue([])

    await GET(new Request('http://test.local/_?limit=100'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/pve-node-01/replication/100-0/log?limit=100')
  })

  it('defaults to limit=50 when no query param', async () => {
    pveFetchMock.mockResolvedValue([])

    await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/pve-node-01/replication/100-0/log?limit=50')
  })

  it('encodes the node in the pveFetch path', async () => {
    pveFetchMock.mockResolvedValue([])

    await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ id: 'conn-1', node: 'node/with/slash', jobId: '100-1' }),
    })

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/node%2Fwith%2Fslash/replication/100-1/log?limit=50')
  })

  it('400 on a job id that is not <vmid>-<n>, before any lookup', async () => {
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve({ ...BASE_PARAMS, jobId: 'job:id' }),
    })

    expect(res.status).toBe(400)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('404 when connection not found', async () => {
    getConnectionByIdMock.mockResolvedValue(null)

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(404)
    const body = await readJson<any>(res)
    expect(body.error).toBe('Connection not found')
  })

  it('403 when NODE_VIEW is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500 on pveFetch throw', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE unreachable'))

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(BASE_PARAMS),
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('PVE unreachable')
    // data should still be present as empty array in error response
    expect(body.data).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// POST (schedule now)
// ---------------------------------------------------------------------------

describe('POST /api/v1/connections/[id]/nodes/[node]/replication/[jobId]', () => {
  it('200 happy path: calls schedule_now and returns result', async () => {
    pveFetchMock.mockResolvedValue('upid-abc123')

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)
    expect(body.data).toBe('upid-abc123')

    expect(pveFetchMock).toHaveBeenCalledWith(
      CONN,
      '/nodes/pve-node-01/replication/100-0/schedule_now',
      { method: 'POST' },
    )
  })

  it('encodes the node in the schedule_now path', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(POST as any, {
      method: 'POST',
      params: { id: 'conn-1', node: 'node/x', jobId: '100-1' },
    })

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/node%2Fx/replication/100-1/schedule_now')
  })

  it('400 on a job id that is not <vmid>-<n>', async () => {
    const res = await callRoute(POST as any, { method: 'POST', params: { ...BASE_PARAMS, jobId: 'job:1' } })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('404 when connection not found', async () => {
    getConnectionByIdMock.mockResolvedValue(null)

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(404)
    const body = await readJson<any>(res)
    expect(body.error).toBe('Connection not found')
  })

  it('403 when NODE_MANAGE is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500 on pveFetch throw', async () => {
    pveFetchMock.mockRejectedValue(new Error('scheduler unavailable'))

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('scheduler unavailable')
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/connections/[id]/nodes/[node]/replication/[jobId]', () => {
  it('200 happy path: calls cluster/replication DELETE and returns success', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)

    expect(pveFetchMock).toHaveBeenCalledWith(
      CONN,
      '/cluster/replication/100-0',
      { method: 'DELETE' },
    )
  })

  it('addresses the job on the cluster DELETE path', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'conn-1', node: 'pve-node-01', jobId: '100-7' },
    })

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/cluster/replication/100-7')
  })

  it('400 on a job id that is not <vmid>-<n>', async () => {
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { ...BASE_PARAMS, jobId: 'job:special' } })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('404 when connection not found', async () => {
    getConnectionByIdMock.mockResolvedValue(null)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(404)
    const body = await readJson<any>(res)
    expect(body.error).toBe('Connection not found')
  })

  it('403 when NODE_MANAGE is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500 on pveFetch throw', async () => {
    pveFetchMock.mockRejectedValue(new Error('replication job not found'))

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: BASE_PARAMS,
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('replication job not found')
  })
})
