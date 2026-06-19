import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

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

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: vi.fn<() => Promise<Response | null>>(),
}))

import { GET, POST, DELETE } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { requireProviderTenant } from '@/lib/tenant'

const checkPermissionMock = checkPermission as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any
const requireProviderTenantMock = requireProviderTenant as any

const CONN = { id: 'conn-1' }
const HA_PARAMS = { id: 'conn-1', sid: 'vm:100' }

const HA_RESOURCE = {
  sid: 'vm:100',
  state: 'started',
  group: 'ha-group-1',
  max_restart: 1,
  max_relocate: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
  pveFetchMock.mockResolvedValue(HA_RESOURCE)
  requireProviderTenantMock.mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/connections/[id]/ha/[sid]', () => {
  it('returns 200 with the HA resource data', async () => {
    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(HA_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toMatchObject({ sid: 'vm:100', state: 'started' })
    expect(pveFetchMock).toHaveBeenCalledWith(
      CONN,
      '/cluster/ha/resources/vm%3A100',
    )
  })

  it('403 when NODE_VIEW is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(HA_PARAMS),
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns { data: null } when pveFetch throws a 404-like error', async () => {
    pveFetchMock.mockRejectedValue(new Error('404 not found'))

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(HA_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toBeNull()
  })

  it('returns { data: null } when error contains "does not exist"', async () => {
    pveFetchMock.mockRejectedValue(new Error('resource does not exist'))

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(HA_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toBeNull()
  })

  it('returns { data: null } when error contains "no such resource"', async () => {
    pveFetchMock.mockRejectedValue(new Error('no such resource vm:100'))

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(HA_PARAMS),
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toBeNull()
  })

  it('500 on unexpected pveFetch error', async () => {
    pveFetchMock.mockRejectedValue(new Error('network timeout'))

    const res = await GET(new Request('http://test.local/_'), {
      params: Promise.resolve(HA_PARAMS),
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('network timeout')
  })
})

// ---------------------------------------------------------------------------
// POST (create or update)
// ---------------------------------------------------------------------------

describe('POST /api/v1/connections/[id]/ha/[sid]', () => {
  it('creates a new HA resource (POST to /cluster/ha/resources) when resource does not exist', async () => {
    // First pveFetch (existence check) throws, second pveFetch (create) succeeds
    pveFetchMock
      .mockRejectedValueOnce(new Error('does not exist'))
      .mockResolvedValueOnce(null)

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: HA_PARAMS,
      body: { group: 'ha-group-1', state: 'started', max_restart: 2 },
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.message).toBe('HA configuration created')

    // Second call is the CREATE POST — must include sid in body
    const [, path, opts] = pveFetchMock.mock.calls[1]
    expect(path).toBe('/cluster/ha/resources')
    expect(opts.method).toBe('POST')
    expect(opts.body).toContain('sid=vm%3A100')
    expect(opts.body).toContain('group=ha-group-1')
    expect(opts.body).toContain('state=started')
    expect(opts.body).toContain('max_restart=2')
  })

  it('updates an existing HA resource (PUT to /cluster/ha/resources/{sid}) when resource exists', async () => {
    // First pveFetch (existence check) resolves — resource exists
    pveFetchMock
      .mockResolvedValueOnce(HA_RESOURCE)
      .mockResolvedValueOnce(null)

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: HA_PARAMS,
      body: { state: 'stopped', max_relocate: 3 },
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.message).toBe('HA configuration updated')

    const [, path, opts] = pveFetchMock.mock.calls[1]
    expect(path).toBe('/cluster/ha/resources/vm%3A100')
    expect(opts.method).toBe('PUT')
    // sid must NOT be in body for updates
    expect(opts.body).not.toContain('sid=')
    expect(opts.body).toContain('state=stopped')
    expect(opts.body).toContain('max_relocate=3')
  })

  it('includes failback param in POST body when provided', async () => {
    pveFetchMock
      .mockRejectedValueOnce(new Error('does not exist'))
      .mockResolvedValueOnce(null)

    await callRoute(POST as any, {
      method: 'POST',
      params: HA_PARAMS,
      body: { failback: true },
    })

    const [, , opts] = pveFetchMock.mock.calls[1]
    expect(opts.body).toContain('failback=1')
  })

  it('includes failback=0 when failback is false', async () => {
    pveFetchMock
      .mockRejectedValueOnce(new Error('does not exist'))
      .mockResolvedValueOnce(null)

    await callRoute(POST as any, {
      method: 'POST',
      params: HA_PARAMS,
      body: { failback: false },
    })

    const [, , opts] = pveFetchMock.mock.calls[1]
    expect(opts.body).toContain('failback=0')
  })

  it('403 when NODE_MANAGE is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: HA_PARAMS,
      body: {},
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns requireProviderTenant response when caller is not provider', async () => {
    const tenantBlocked = new Response(JSON.stringify({ error: 'provider only' }), { status: 403 })
    requireProviderTenantMock.mockResolvedValue(tenantBlocked)

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: HA_PARAMS,
      body: { state: 'started' },
    })

    expect(res.status).toBe(403)
    // No pveFetch calls at all (getConnectionById not even reached)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500 on pveFetch throw during create/update', async () => {
    pveFetchMock
      .mockRejectedValueOnce(new Error('no such resource'))
      .mockRejectedValueOnce(new Error('PVE cluster unreachable'))

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: HA_PARAMS,
      body: { state: 'started' },
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('PVE cluster unreachable')
  })
})

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/connections/[id]/ha/[sid]', () => {
  it('returns 200 and calls pveFetch DELETE on the HA resource', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: HA_PARAMS,
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.message).toBe('HA configuration removed')
    expect(body.data).toBeNull()

    expect(pveFetchMock).toHaveBeenCalledWith(
      CONN,
      '/cluster/ha/resources/vm%3A100',
      { method: 'DELETE' },
    )
  })

  it('403 when NODE_MANAGE is denied', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: HA_PARAMS,
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns requireProviderTenant response when caller is not provider', async () => {
    const tenantBlocked = new Response(JSON.stringify({ error: 'provider only' }), { status: 403 })
    requireProviderTenantMock.mockResolvedValue(tenantBlocked)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: HA_PARAMS,
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('encodes special characters in sid for the DELETE path', async () => {
    pveFetchMock.mockResolvedValue(null)

    await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'conn-1', sid: 'ct:200' },
    })

    expect(pveFetchMock).toHaveBeenCalledWith(
      CONN,
      '/cluster/ha/resources/ct%3A200',
      { method: 'DELETE' },
    )
  })

  it('500 on pveFetch throw', async () => {
    pveFetchMock.mockRejectedValue(new Error('HA manager offline'))

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: HA_PARAMS,
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('HA manager offline')
  })
})
