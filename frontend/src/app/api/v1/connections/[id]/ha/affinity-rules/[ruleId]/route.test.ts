import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
    CONNECTION_MANAGE: 'connection.manage',
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

import { PUT } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const checkPermissionMock = checkPermission as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

const CONN = { id: 'conn-1' }
const BASE_PARAMS = { id: 'conn-1', ruleId: 'keep-on-pve1' }

const NODE_RULE = {
  rule: 'keep-on-pve1',
  type: 'node-affinity',
  resources: 'vm:100',
  nodes: 'pve1',
  digest: 'abc',
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
})

describe('PUT /api/v1/connections/[id]/ha/affinity-rules/[ruleId]', () => {
  it('reads the rule type from PVE when the body omits it, and sends it (PVE 9 requires type on update)', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, _path: string, opts?: any) =>
      opts?.method === 'PUT' ? null : NODE_RULE
    )

    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { comment: 'updated', nodes: 'pve1,pve2' },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenNthCalledWith(1, CONN, '/cluster/ha/rules/keep-on-pve1')

    const [, path, opts] = pveFetchMock.mock.calls[1]
    expect(path).toBe('/cluster/ha/rules/keep-on-pve1')
    expect(opts.method).toBe('PUT')
    expect(opts.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
    const sent = new URLSearchParams(opts.body)
    expect(sent.get('type')).toBe('node-affinity')
    expect(sent.get('nodes')).toBe('pve1,pve2')
    expect(sent.get('comment')).toBe('updated')
  })

  it('uses the type given in the body without reading the rule first', async () => {
    pveFetchMock.mockResolvedValue(null)

    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { type: 'resource-affinity', affinity: 'negative' },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    const [, , opts] = pveFetchMock.mock.calls[0]
    expect(opts.method).toBe('PUT')
    const sent = new URLSearchParams(opts.body)
    expect(sent.get('type')).toBe('resource-affinity')
    expect(sent.get('affinity')).toBe('negative')
  })

  it('400 on an unknown type, without calling PVE', async () => {
    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { type: 'anti-affinity', comment: 'x' },
    })

    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('404 when the rule to update does not exist', async () => {
    pveFetchMock.mockRejectedValue(new Error("PVE 500 /cluster/ha/rules/keep-on-pve1: no such ha rule 'keep-on-pve1' does not exist"))

    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { comment: 'x' },
    })

    expect(res.status).toBe(404)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('403 when CONNECTION_MANAGE is denied, without calling PVE', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))

    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { comment: 'x' },
    })

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('500 with the PVE message when the update fails', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, _path: string, opts?: any) => {
      if (opts?.method === 'PUT') throw new Error('PVE 400 /cluster/ha/rules/keep-on-pve1: bad nodes')

      return NODE_RULE
    })

    const res = await callRoute(PUT as any, {
      method: 'PUT',
      params: BASE_PARAMS,
      body: { nodes: '!!' },
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('bad nodes')
  })
})
