import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const verifyConnectionOwnershipMock = vi.fn<(id: string) => Promise<Response | null>>()
const getCurrentTenantIdMock = vi.fn<() => Promise<string>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
const relayMock = vi.fn<(...args: any[]) => Promise<Response>>()

vi.mock('@/lib/tenant', () => ({
  verifyConnectionOwnership: verifyConnectionOwnershipMock,
  getCurrentTenantId: getCurrentTenantIdMock,
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))
vi.mock('@/lib/orchestrator/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/orchestrator/client')>()),
  orchestratorRelay: relayMock,
}))

function upstream(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// callRoute types params as strings; a catch-all gets an array.
const ctx = (path: string[]) => ({ params: { connectionId: 'c1', path } as any })

beforeEach(() => {
  vi.clearAllMocks()
  verifyConnectionOwnershipMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('default')
  checkPermissionMock.mockResolvedValue(null)
  getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
  relayMock.mockResolvedValue(upstream(200, { ok: true }))
})

describe('microseg proxy route', () => {
  it('forwards a read to /microseg/{connectionId}/... and keeps the query string', async () => {
    relayMock.mockResolvedValue(upstream(200, { runs: [], limit: 10, offset: 20 }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, { ...ctx(['runs']), searchParams: { limit: '10', offset: '20' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ runs: [], limit: 10, offset: 20 })
    expect(relayMock).toHaveBeenCalledTimes(1)
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/runs?limit=10&offset=20')
    expect(relayMock.mock.calls[0][1]).toMatchObject({ method: 'GET' })
    expect(relayMock.mock.calls[0][1].body).toBeUndefined()
  })

  it('requires NODE_MANAGE for a write and NODE_VIEW for a read', async () => {
    const { GET, POST } = await import('./route')

    await callRoute(GET as any, ctx(['policy']))
    expect(checkPermissionMock).toHaveBeenLastCalledWith('node.view', 'connection', 'c1')

    await callRoute(POST as any, { ...ctx(['apply']), body: { version: 3 } })
    expect(checkPermissionMock).toHaveBeenLastCalledWith('node.manage', 'connection', 'c1')
  })

  it('checks the ownership of the connection first and stops there', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(new Response('{"error":"nope"}', { status: 404 }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['policy']))

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC refusal without calling the orchestrator', async () => {
    checkPermissionMock.mockResolvedValue(new Response('{"error":"Forbidden"}', { status: 403 }))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['apply']), body: { version: 1 } })

    expect(res.status).toBe(403)
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('refuses a vDC tenant principal with 403 on a read and on a write', async () => {
    getCurrentTenantIdMock.mockResolvedValue('tenant-vdc')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
    const { GET, POST } = await import('./route')

    const read = await callRoute(GET as any, ctx(['policy']))
    const write = await callRoute(POST as any, { ...ctx(['apply']), body: { version: 1 } })

    expect(read.status).toBe(403)
    expect(write.status).toBe(403)
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('tenant-vdc', { ignoreVdcContext: true })
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('lets a provider and an MSP tenant through', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['c1']) })
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['policy']))

    expect(res.status).toBe(200)
    expect(relayMock).toHaveBeenCalledTimes(1)
  })

  it('answers 404 for an unknown route without calling the orchestrator', async () => {
    const { GET, POST } = await import('./route')
    const unknown = await callRoute(GET as any, ctx(['analyze']))
    const wrongVerb = await callRoute(POST as any, { ...ctx(['status']), body: {} })
    const traversal = await callRoute(GET as any, ctx(['..', 'drs']))

    expect(unknown.status).toBe(404)
    expect(wrongVerb.status).toBe(404)
    expect(traversal.status).toBe(404)
    expect(relayMock).not.toHaveBeenCalled()
    expect(verifyConnectionOwnershipMock).not.toHaveBeenCalled()
  })

  it('refuses a connection id that is not a plain identifier with 400', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, { params: { connectionId: '../drs', path: ['policy'] } as any })

    expect(res.status).toBe(400)
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('forwards a JSON body unchanged on POST and PUT', async () => {
    const { POST, PUT } = await import('./route')
    const body = { version: 4, name: 'web', enforcement: 'strict', label: 'Web', color: '#fff' }

    await callRoute(POST as any, { ...ctx(['zones']), body })
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/zones')
    expect(relayMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(relayMock.mock.calls[0][1].body)).toEqual(body)

    await callRoute(PUT as any, { ...ctx(['zones', 'z1']), method: 'PUT', body })
    expect(relayMock.mock.calls[1][0]).toBe('/microseg/c1/zones/z1')
    expect(relayMock.mock.calls[1][1]).toMatchObject({ method: 'PUT' })
  })

  it('forwards the body of a DELETE', async () => {
    const { DELETE } = await import('./route')

    await callRoute(DELETE as any, { ...ctx(['flows', 'f1']), method: 'DELETE', body: { version: 9 } })

    expect(relayMock).toHaveBeenCalledTimes(1)
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/flows/f1')
    expect(relayMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
    expect(JSON.parse(relayMock.mock.calls[0][1].body)).toEqual({ version: 9 })
  })

  it('sends no body for the routes that take none', async () => {
    const { POST } = await import('./route')

    await callRoute(POST as any, { ...ctx(['confirm-writes']), method: 'POST' })
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/confirm-writes')
    expect(relayMock.mock.calls[0][1].body).toBeUndefined()
  })

  it('passes a 409 from the orchestrator through, status and body intact', async () => {
    relayMock.mockResolvedValue(upstream(409, { code: 'VERSION_CONFLICT', error: 'version conflict' }))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['apply']), body: { version: 1 } })

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ code: 'VERSION_CONFLICT', error: 'version conflict' })
  })

  it('passes a 202 through', async () => {
    relayMock.mockResolvedValue(upstream(202, { run_id: 'r-9' }))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['apply']), body: { version: 1 } })

    expect(res.status).toBe(202)
    expect(await readJson(res)).toEqual({ run_id: 'r-9' })
  })

  it.each([
    [400, { code: 'INVALID', error: 'bad name' }],
    [403, { code: 'FEATURE_REQUIRED', error: 'feature required' }],
    [404, { code: 'NOT_FOUND', error: 'not found' }],
    [502, { code: 'PVE_ERROR', error: 'pve down' }],
    [503, { code: 'NOT_LEADER', error: 'not the leader' }],
    [503, { code: 'MICROSEG_UNAVAILABLE', error: 'no engine' }],
  ])('passes a %i from the orchestrator through', async (status, payload) => {
    relayMock.mockResolvedValue(upstream(status, payload))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['preflight']))

    expect(res.status).toBe(status)
    expect(await readJson(res)).toEqual(payload)
    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('answers 503 MICROSEG_UNAVAILABLE when the orchestrator cannot be reached', async () => {
    const err: any = new Error('Orchestrator unavailable')

    err.code = 'ORCHESTRATOR_UNAVAILABLE'
    relayMock.mockRejectedValue(err)
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['status']))

    expect(res.status).toBe(503)
    expect(await readJson<any>(res)).toMatchObject({ code: 'MICROSEG_UNAVAILABLE' })
  })

  it('answers 504 when the orchestrator times out', async () => {
    relayMock.mockRejectedValue(new Error('Orchestrator request timeout'))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['status']))

    expect(res.status).toBe(504)
  })

  it('maps an orchestrator 401 to 502 ORCHESTRATOR_ERROR so the UI does not loop on login', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    relayMock.mockResolvedValue(upstream(401, { error: 'invalid api key' }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['status']))

    expect(res.status).toBe(502)
    expect(await readJson<any>(res)).toMatchObject({ code: 'ORCHESTRATOR_ERROR' })
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('401'))
    errorSpy.mockRestore()
  })

  it('maps a non-JSON body on an error status to 502 ORCHESTRATOR_ERROR (empty included)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET } = await import('./route')

    relayMock.mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }))
    const res = await callRoute(GET as any, ctx(['status']))

    expect(res.status).toBe(502)
    expect(await readJson<any>(res)).toMatchObject({ code: 'ORCHESTRATOR_ERROR' })

    relayMock.mockResolvedValue(new Response('', { status: 503 }))
    expect((await callRoute(GET as any, ctx(['status']))).status).toBe(502)
    errorSpy.mockRestore()
  })

  it('refuses a body above 1 MiB with 413, declared or streamed, without calling the orchestrator', async () => {
    const { POST } = await import('./route')
    const big = 'x'.repeat(1024 * 1024 + 1)

    const declared = await callRoute(POST as any, { ...ctx(['members']), body: big, headers: { 'content-length': String(big.length) } })

    expect(declared.status).toBe(413)
    expect(await readJson<any>(declared)).toMatchObject({ code: 'INVALID' })

    const streamed = await callRoute(POST as any, { ...ctx(['members']), body: big, headers: { 'content-length': '10' } })

    expect(streamed.status).toBe(413)
    expect(relayMock).not.toHaveBeenCalled()

    const ok = await callRoute(POST as any, { ...ctx(['members']), body: 'x'.repeat(1024 * 1024) })

    expect(ok.status).toBe(200)
    expect(relayMock.mock.calls[0][1].body).toHaveLength(1024 * 1024)
  })

  it('hands the request abort signal to the relay', async () => {
    const { GET } = await import('./route')
    const controller = new AbortController()
    const req = new Request('http://test.local/_', { signal: controller.signal })

    await GET(req as any, { params: Promise.resolve({ connectionId: 'c1', path: ['status'] }) })

    const signal = relayMock.mock.calls[0][1].signal as AbortSignal

    expect(signal.aborted).toBe(false)
    controller.abort()
    expect(signal.aborted).toBe(true)
  })

  it('answers 401 UNAUTHORIZED for a dead or invalid API token', async () => {
    getCurrentTenantIdMock.mockRejectedValue(new Error('Invalid or expired API token'))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['status']))

    expect(res.status).toBe(401)
    expect(await readJson<any>(res)).toMatchObject({ code: 'UNAUTHORIZED' })
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('answers 403 when the session tenant is not available', async () => {
    const err = new Error('Tenant not available for this session')

    err.name = 'TenantAccessError'
    getCurrentTenantIdMock.mockRejectedValue(err)
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['status']))

    expect(res.status).toBe(403)
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('does not audit from Next (the orchestrator does)', async () => {
    const mod = await import('./route')

    expect(Object.keys(mod).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT', 'dynamic'])
  })
})
