import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const denyIaasTenantMock = vi.fn<() => Promise<Response | null>>()
const relayMock = vi.fn<(...args: any[]) => Promise<Response>>()
const findUniqueMock = vi.fn<(...args: any[]) => Promise<{ type: string } | null>>()
const auditSpecs: any[] = []

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findUnique: findUniqueMock } }),
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/tenant/iaasGuard', () => ({ denyIaasTenant: denyIaasTenantMock }))
// The wrapper is tested on its own: here it only has to be there, with its spec.
vi.mock('@/lib/audit/withAudit', () => ({
  withAudit: (spec: unknown, handler: unknown) => {
    auditSpecs.push(spec)

    return handler
  },
}))
vi.mock('@/lib/orchestrator/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/orchestrator/client')>()),
  orchestratorRelay: relayMock,
}))

function upstream(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ctx = (extra: Record<string, string> = {}) => ({ params: { id: 'c1', ...extra } })

const settings = { mode: 'forwarder', receiver_host: '10.42.0.40', receiver_port: 6344, queue_mb: 256, budget_lines_per_min: 30000 }

const routes = {
  state: () => import('./route'),
  preflight: () => import('./preflight/route'),
  check: () => import('./check/route'),
  retry: () => import('./nodes/[node]/retry/route'),
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  denyIaasTenantMock.mockResolvedValue(null)
  findUniqueMock.mockResolvedValue({ type: 'pve' })
  // A Response is read once: each call gets its own.
  relayMock.mockImplementation(async () => upstream(200, { mode: 'api' }))
})

describe('log collection routes', () => {
  it('reads the state of a cluster with connection.view', async () => {
    relayMock.mockResolvedValue(upstream(200, { mode: 'forwarder', nodes: [] }))
    const { GET } = await routes.state()
    const res = await callRoute(GET as any, ctx())

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ mode: 'forwarder', nodes: [] })
    expect(relayMock.mock.calls[0][0]).toBe('/logfwd/c1')
    expect(relayMock.mock.calls[0][1]).toMatchObject({ method: 'GET' })
    expect(relayMock.mock.calls[0][1].body).toBeUndefined()
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.view', 'connection', 'c1')
  })

  it('sends a mode change as it came and hands back the run with connection.manage', async () => {
    relayMock.mockResolvedValue(upstream(202, { run_id: 'run-1' }))
    const { PUT } = await routes.state()
    const res = await callRoute(PUT as any, { ...ctx(), method: 'PUT', body: settings })

    expect(res.status).toBe(202)
    expect(await readJson(res)).toEqual({ run_id: 'run-1' })
    expect(relayMock.mock.calls[0][0]).toBe('/logfwd/c1')
    expect(relayMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
    expect(JSON.parse(relayMock.mock.calls[0][1].body)).toEqual(settings)
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.manage', 'connection', 'c1')
  })

  it('relays the preflight, the check and the retry of a node with connection.manage', async () => {
    const preflight = await routes.preflight()
    const check = await routes.check()
    const retry = await routes.retry()

    await callRoute(preflight.POST as any, { ...ctx(), method: 'POST', body: settings })
    await callRoute(check.POST as any, { ...ctx(), method: 'POST' })
    await callRoute(retry.POST as any, { ...ctx({ node: 'pve2' }), method: 'POST' })

    expect(relayMock.mock.calls.map(c => [c[1].method, c[0]])).toEqual([
      ['POST', '/logfwd/c1/preflight'],
      ['POST', '/logfwd/c1/check'],
      ['POST', '/logfwd/c1/nodes/pve2/retry'],
    ])
    expect(JSON.parse(relayMock.mock.calls[0][1].body)).toEqual(settings)
    expect(checkPermissionMock).toHaveBeenCalledTimes(3)
    for (const call of checkPermissionMock.mock.calls) expect(call[0]).toBe('connection.manage')
  })

  it('audits the two calls that change the nodes: the mode change and the retry of a node', async () => {
    await routes.state()
    await routes.retry()

    expect(auditSpecs).toEqual([
      { category: 'connections', action: 'update', resourceType: 'connection', resourceParam: 'id' },
      { category: 'connections', action: 'update', resourceType: 'connection', resourceParam: 'id' },
    ])
  })

  it('hands back a refusal of the orchestrator with its code and its checks', async () => {
    const refusal = { code: 'PREFLIGHT_FAILED', error: 'the preflight failed on pve2', checks: [{ node: 'pve2', ok: false, problems: [{ code: 'host_key_unconfirmed' }] }] }

    relayMock.mockResolvedValue(upstream(409, refusal))
    const { PUT } = await routes.state()
    const res = await callRoute(PUT as any, { ...ctx(), method: 'PUT', body: settings })

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual(refusal)
  })

  it('refuses a node name that is not a plain identifier', async () => {
    const { POST } = await routes.retry()

    for (const node of ['../c2', 'pve1?x=1', 'a b', '']) {
      const res = await callRoute(POST as any, { ...ctx({ node }), method: 'POST' })

      expect(res.status).toBe(400)
    }
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('refuses a vDC tenant on every route before anything else', async () => {
    const state = await routes.state()
    const cases: Array<[unknown, 'GET' | 'PUT' | 'POST', Record<string, string>]> = [
      [state.GET, 'GET', {}],
      [state.PUT, 'PUT', {}],
      [(await routes.preflight()).POST, 'POST', {}],
      [(await routes.check()).POST, 'POST', {}],
      [(await routes.retry()).POST, 'POST', { node: 'pve1' }],
    ]

    for (const [handler, method, extra] of cases) {
      denyIaasTenantMock.mockResolvedValueOnce(new Response(null, { status: 404 }))
      const res = await callRoute(handler as any, { ...ctx(extra), method, body: method === 'GET' ? undefined : settings })

      expect(res.status).toBe(404)
    }
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('refuses a caller without the permission before it reads the connection', async () => {
    const { PUT } = await routes.state()

    checkPermissionMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect((await callRoute(PUT as any, { ...ctx(), method: 'PUT', body: settings })).status).toBe(403)
    expect(findUniqueMock).not.toHaveBeenCalled()
    expect(relayMock).not.toHaveBeenCalled()
  })

  // The connection is read through the session's tenant: one of another
  // tenant comes back as not found.
  it('only serves a Proxmox VE connection of the tenant', async () => {
    const { GET } = await routes.state()

    findUniqueMock.mockResolvedValueOnce({ type: 'pbs' })
    const wrongType = await callRoute(GET as any, ctx())

    expect(wrongType.status).toBe(400)
    expect((await readJson(wrongType) as any).code).toBe('NOT_PVE')

    findUniqueMock.mockResolvedValueOnce(null)
    expect((await callRoute(GET as any, ctx())).status).toBe(404)
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('refuses a body that is not a JSON object or is too large', async () => {
    const { PUT } = await routes.state()
    const big = { ...settings, receiver_host: 'h'.repeat(20000) }

    for (const body of ['not json', '[1,2]', '"text"', JSON.stringify(big)]) {
      const res = await PUT(new Request('http://localhost/api/v1/connections/c1/log-collection', { method: 'PUT', body, headers: { 'Content-Type': 'application/json' } }) as any, { params: Promise.resolve({ id: 'c1' }) } as any)

      expect(res.status).toBe(400)
    }
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('answers 503 when the orchestrator cannot be reached', async () => {
    relayMock.mockRejectedValue(new Error('fetch failed'))
    const { GET } = await routes.state()
    const res = await callRoute(GET as any, ctx())

    expect(res.status).toBe(503)
    expect((await readJson(res) as any).code).toBe('ORCHESTRATOR_UNAVAILABLE')
  })
})
