import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const verifyConnectionOwnershipMock = vi.fn<(id: string) => Promise<Response | null>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const denyIaasTenantMock = vi.fn<() => Promise<Response | null>>()
const relayMock = vi.fn<(...args: any[]) => Promise<Response>>()
const fetchMock = vi.fn<(...args: any[]) => Promise<unknown>>()
const auditMock = vi.fn<(...args: any[]) => Promise<string>>()

vi.mock('@/lib/tenant', () => ({
  verifyConnectionOwnership: verifyConnectionOwnershipMock,
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))
vi.mock('@/lib/tenant/iaasGuard', () => ({ denyIaasTenant: denyIaasTenantMock }))
vi.mock('@/lib/audit', () => ({ audit: auditMock }))
vi.mock('@/lib/orchestrator/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/orchestrator/client')>()),
  orchestratorRelay: relayMock,
  orchestratorFetch: fetchMock,
}))

function upstream(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** The answer of GET /microseg/{id}/clusters for a policy linking these connections. */
function clusters(...ids: string[]) {
  return { clusters: ids.map(id => ({ policy_id: 'p1', connection_id: id, active: true, stop_cluster_disabled: false })), max: 8 }
}

// callRoute types params as strings; a catch-all gets an array.
const ctx = (path: string[]) => ({ params: { connectionId: 'c1', path } as any })

beforeEach(() => {
  vi.clearAllMocks()
  verifyConnectionOwnershipMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  denyIaasTenantMock.mockResolvedValue(null)
  relayMock.mockResolvedValue(upstream(200, { ok: true }))
  fetchMock.mockResolvedValue(clusters('c1'))
  auditMock.mockResolvedValue('row-1')
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

  it('hands back the vDC tenant refusal before the route lookup, any check or audit', async () => {
    denyIaasTenantMock.mockImplementation(async () => new Response('{"error":"Not found"}', { status: 404 }))
    const { GET, POST } = await import('./route')

    const read = await callRoute(GET as any, ctx(['policy']))
    const write = await callRoute(POST as any, { ...ctx(['apply']), body: { version: 1 } })
    const unknown = await callRoute(GET as any, ctx(['no-such-route']))

    for (const res of [read, write, unknown]) {
      expect(res.status).toBe(404)
      expect(await readJson(res)).toEqual({ error: 'Not found' })
    }
    expect(verifyConnectionOwnershipMock).not.toHaveBeenCalled()
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('lets a caller the vDC guard passes through', async () => {
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

  it('answers 401 UNAUTHORIZED when the token dies on the way to the orchestrator', async () => {
    relayMock.mockRejectedValue(new Error('Invalid or expired API token'))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['status']))

    expect(res.status).toBe(401)
    expect(await readJson<any>(res)).toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('answers 403 when the session tenant is not available', async () => {
    const err = new Error('Tenant not available for this session')

    err.name = 'TenantAccessError'
    relayMock.mockRejectedValue(err)
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['status']))

    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toMatchObject({ code: 'FORBIDDEN' })
  })

  it('keeps the plain method exports, audited inline rather than through withAudit', async () => {
    const mod = await import('./route')

    expect(Object.keys(mod).sort()).toEqual(['DELETE', 'GET', 'POST', 'PUT', 'dynamic'])
  })
})

describe('microseg proxy route audit', () => {
  it('records a draft write the relay owns, with its action and the version of the body', async () => {
    relayMock.mockResolvedValue(upstream(200, { version: 5, zone: { id: 'z1' } }))
    const { PUT } = await import('./route')
    const res = await callRoute(PUT as any, { ...ctx(['zones', 'z1']), method: 'PUT', body: { version: 4, name: 'web' } })

    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toEqual({
      category: 'firewall',
      action: 'microseg.zone.update',
      resourceType: 'microseg_policy',
      resourceId: 'c1',
      status: 'success',
      errorMessage: undefined,
      details: { path: 'zones/z1', method: 'PUT', status: 200, version: 4 },
    })
  })

  it('relays the three exception writes under node.manage, each audited by the relay under its own action', async () => {
    const { POST, PUT, DELETE } = await import('./route')
    const exception = { zone_id: 'zd', sources: [{ type: 'qemu', vmid: 100, name: 'web-1' }], destinations: [{ type: 'qemu', vmid: 200, name: 'db-1' }], services: [{ proto: 'tcp', dport: '5432' }] }

    // One answer per call: the body of a Response is read once.
    relayMock.mockImplementation(async () => upstream(200, { version: 5, exception: { id: 'e1', ...exception } }))
    await callRoute(POST as any, { ...ctx(['exceptions']), body: { version: 4, ...exception } })
    await callRoute(PUT as any, { ...ctx(['exceptions', 'e1']), method: 'PUT', body: { version: 5, ...exception } })
    relayMock.mockResolvedValue(upstream(200, { version: 7 }))
    await callRoute(DELETE as any, { ...ctx(['exceptions', 'e1']), method: 'DELETE', body: { version: 6 } })

    expect(checkPermissionMock.mock.calls).toEqual(Array(3).fill(['node.manage', 'connection', 'c1']))
    expect(relayMock.mock.calls.map(c => [c[1].method, c[0], JSON.parse(c[1].body)])).toEqual([
      ['POST', '/microseg/c1/exceptions', { version: 4, ...exception }],
      ['PUT', '/microseg/c1/exceptions/e1', { version: 5, ...exception }],
      ['DELETE', '/microseg/c1/exceptions/e1', { version: 6 }],
    ])
    expect(auditMock.mock.calls.map(c => c[0])).toEqual([
      { category: 'firewall', action: 'microseg.exception.create', resourceType: 'microseg_policy', resourceId: 'c1', status: 'success', errorMessage: undefined, details: { path: 'exceptions', method: 'POST', status: 200, version: 4 } },
      { category: 'firewall', action: 'microseg.exception.update', resourceType: 'microseg_policy', resourceId: 'c1', status: 'success', errorMessage: undefined, details: { path: 'exceptions/e1', method: 'PUT', status: 200, version: 5 } },
      { category: 'firewall', action: 'microseg.exception.delete', resourceType: 'microseg_policy', resourceId: 'c1', status: 'success', errorMessage: undefined, details: { path: 'exceptions/e1', method: 'DELETE', status: 200, version: 6 } },
    ])
  })

  it('refuses a neighbouring verb or path of the exceptions: 404, no relay, no audit', async () => {
    const { GET, POST, PUT, DELETE } = await import('./route')
    const refused = [
      await callRoute(GET as any, ctx(['exceptions'])),
      await callRoute(GET as any, ctx(['exceptions', 'e1'])),
      await callRoute(POST as any, { ...ctx(['exceptions', 'e1']), body: { version: 1 } }),
      await callRoute(PUT as any, { ...ctx(['exceptions']), method: 'PUT', body: { version: 1 } }),
      await callRoute(DELETE as any, { ...ctx(['exceptions']), method: 'DELETE', body: { version: 1 } }),
      await callRoute(PUT as any, { ...ctx(['exceptions', 'e1', 'state']), method: 'PUT', body: { version: 1 } }),
    ]

    expect(refused.map(r => r.status)).toEqual(Array(6).fill(404))
    expect(relayMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('records a draft write without a body, version absent', async () => {
    const { POST } = await import('./route')

    await callRoute(POST as any, { ...ctx(['confirm-writes']), method: 'POST' })

    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'microseg.confirm_writes',
      status: 'success',
      details: { path: 'confirm-writes', method: 'POST', status: 200, version: undefined },
    })
  })

  it('records the manual check, queued or refused as already pending', async () => {
    const { POST } = await import('./route')

    relayMock.mockResolvedValue(upstream(202, { queued: true, requested_at: '2026-11-03T10:00:00Z' }))
    const res = await callRoute(POST as any, { ...ctx(['check']), body: {} })
    expect(res.status).toBe(202)
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/check')
    relayMock.mockResolvedValue(upstream(409, { code: 'CHECK_PENDING', error: 'a check is already queued' }))
    await callRoute(POST as any, { ...ctx(['check']), body: {} })

    expect(auditMock).toHaveBeenCalledTimes(2)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'microseg.check', status: 'success', details: { path: 'check', method: 'POST', status: 202 } })
    expect(auditMock.mock.calls[1][0]).toMatchObject({ action: 'microseg.check', status: 'failure', errorMessage: 'a check is already queued' })
  })

  it('records nothing for a lifecycle write the orchestrator handled, success or refusal', async () => {
    const { POST } = await import('./route')

    relayMock.mockResolvedValue(upstream(202, { run_id: 'r-1' }))
    await callRoute(POST as any, { ...ctx(['apply']), body: { version: 3 } })
    relayMock.mockResolvedValue(upstream(409, { code: 'VERSION_CONFLICT', error: 'version conflict' }))
    await callRoute(POST as any, { ...ctx(['emergency-stop']), body: { active: true } })

    expect(relayMock).toHaveBeenCalledTimes(2)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('records a lifecycle write that Next refused before the orchestrator saw it, under the orchestrator action', async () => {
    checkPermissionMock.mockResolvedValue(new Response('{"error":"Forbidden"}', { status: 403, headers: { 'Content-Type': 'application/json' } }))
    const { POST } = await import('./route')

    await callRoute(POST as any, { ...ctx(['remove']), body: { version: 2 } })

    expect(relayMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'microseg.remove',
      status: 'failure',
      errorMessage: 'Forbidden',
      details: { path: 'remove', method: 'POST', status: 403 },
    })
  })

  it('records nothing for a read or the plan preview', async () => {
    const { GET, POST } = await import('./route')

    await callRoute(GET as any, ctx(['policy']))
    await callRoute(POST as any, { ...ctx(['plan']), method: 'POST' })
    checkPermissionMock.mockResolvedValue(new Response('{"error":"Forbidden"}', { status: 403 }))
    await callRoute(GET as any, ctx(['status']))

    expect(auditMock).not.toHaveBeenCalled()
  })

  it('records a failure for a draft write the orchestrator refused, with its error', async () => {
    relayMock.mockResolvedValue(upstream(409, { code: 'VERSION_CONFLICT', error: 'version conflict' }))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['flows']), body: { version: 7, from: 'web', to: 'db' } })

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ code: 'VERSION_CONFLICT', error: 'version conflict' })
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'microseg.flow.create',
      status: 'failure',
      errorMessage: 'version conflict',
      details: { path: 'flows', method: 'POST', status: 409, version: 7 },
    })
  })

  it('records a failure for a draft write refused by RBAC or by size, and nothing behind a 401', async () => {
    const { POST } = await import('./route')

    checkPermissionMock.mockResolvedValueOnce(new Response('{"error":"Forbidden"}', { status: 403 }))
    await callRoute(POST as any, { ...ctx(['members']), body: { version: 1, add: [] } })
    const big = 'x'.repeat(1024 * 1024 + 1)

    await callRoute(POST as any, { ...ctx(['members']), body: big, headers: { 'content-length': String(big.length) } })
    denyIaasTenantMock.mockResolvedValueOnce(new Response('{"error":"Not authenticated"}', { status: 401 }))
    await callRoute(POST as any, { ...ctx(['members']), body: { version: 1, add: [] } })

    expect(auditMock.mock.calls.map(c => [c[0].status, c[0].details.status])).toEqual([
      ['failure', 403],
      ['failure', 413],
    ])
  })

  it('records a lifecycle write that hit an unreachable orchestrator, but not one that timed out', async () => {
    const unavailable: any = new Error('Orchestrator unavailable')

    unavailable.code = 'ORCHESTRATOR_UNAVAILABLE'
    const { POST } = await import('./route')

    relayMock.mockRejectedValueOnce(unavailable)
    await callRoute(POST as any, { ...ctx(['apply']), body: { version: 3 } })
    relayMock.mockRejectedValueOnce(new Error('Orchestrator request timeout'))
    await callRoute(POST as any, { ...ctx(['apply']), body: { version: 3 } })

    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'microseg.apply', status: 'failure', details: { status: 503, version: 3 } })
  })

  it('answers unchanged when the audit row cannot be written', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    auditMock.mockRejectedValue(new Error('db down'))
    const { PUT } = await import('./route')
    const res = await callRoute(PUT as any, { ...ctx(['policy']), method: 'PUT', body: { version: 1 } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ok: true })
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[audit]'), 'db down')
    errorSpy.mockRestore()
  })
})

describe('microseg proxy route rights on a shared policy', () => {
  const forbidden = () => new Response('{"error":"Forbidden"}', { status: 403, headers: { 'Content-Type': 'application/json' } })
  const notFound = () => new Response('{"error":"Connection not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })

  it('refuses a draft write when the caller may not manage another cluster of the policy, audited once as a failure', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    checkPermissionMock.mockImplementation(async (_permission: string, _type: string, id: string) => (id === 'c2' ? forbidden() : null))
    const { PUT } = await import('./route')
    const res = await callRoute(PUT as any, { ...ctx(['zones', 'z1']), method: 'PUT', body: { version: 4, name: 'web' } })

    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ error: 'Forbidden' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/microseg/c1/clusters')
    expect(verifyConnectionOwnershipMock.mock.calls).toEqual([['c1'], ['c2']])
    expect(checkPermissionMock.mock.calls).toEqual([
      ['node.manage', 'connection', 'c1'],
      ['node.manage', 'connection', 'c2'],
    ])
    expect(relayMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'microseg.zone.update', status: 'failure', resourceId: 'c1', details: { path: 'zones/z1', status: 403 } })
  })

  it('checks a cluster route on the URL connection only, without reading the clusters', async () => {
    const { GET, POST } = await import('./route')

    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    const res = await callRoute(GET as any, ctx(['runs']))
    await callRoute(POST as any, { ...ctx(['members']), body: { version: 1, add: [] } })

    expect(res.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(checkPermissionMock.mock.calls).toEqual([
      ['node.view', 'connection', 'c1'],
      ['node.manage', 'connection', 'c1'],
    ])
    expect(verifyConnectionOwnershipMock.mock.calls).toEqual([['c1'], ['c1']])
  })

  it('serves a policy read on a single-cluster group with the clusters read as its only extra call', async () => {
    relayMock.mockResolvedValue(upstream(200, { policy: { connection_id: 'c1' } }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['policy']))

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ policy: { connection_id: 'c1' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(relayMock).toHaveBeenCalledTimes(1)
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/policy')
    expect(checkPermissionMock.mock.calls).toEqual([['node.view', 'connection', 'c1']])
  })

  it.each([
    [['drifts']],
    [['suggestions']],
    [['revisions']],
    [['policy']],
  ])('checks the read rights on every linked cluster for GET /%s', async path => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2', 'c3'))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(path))

    expect(res.status).toBe(200)
    expect(checkPermissionMock.mock.calls).toEqual([
      ['node.view', 'connection', 'c1'],
      ['node.view', 'connection', 'c2'],
      ['node.view', 'connection', 'c3'],
    ])
  })

  it('answers the generic refusal of the helper, naming no cluster the caller cannot see', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'secret-cluster'))
    verifyConnectionOwnershipMock.mockImplementation(async (id: string) => (id === 'secret-cluster' ? notFound() : null))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['drifts']))
    const text = await res.text()

    expect(res.status).toBe(404)
    expect(JSON.parse(text)).toEqual({ error: 'Connection not found' })
    expect(text).not.toContain('secret-cluster')
    expect(checkPermissionMock.mock.calls).toEqual([['node.view', 'connection', 'c1']])
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('does not read the clusters when the URL connection itself is refused', async () => {
    checkPermissionMock.mockResolvedValue(forbidden())
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['policy']))

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('checks each linked connection once', async () => {
    fetchMock.mockResolvedValue(clusters('c2', 'c1', 'c2'))
    const { GET } = await import('./route')

    await callRoute(GET as any, ctx(['policy']))

    expect(verifyConnectionOwnershipMock.mock.calls).toEqual([['c1'], ['c2']])
    expect(checkPermissionMock.mock.calls).toEqual([
      ['node.view', 'connection', 'c1'],
      ['node.view', 'connection', 'c2'],
    ])
  })

  it('refuses an emergency stop the caller may not apply to every cluster, audited by the relay since the orchestrator never saw it', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    checkPermissionMock.mockImplementation(async (_permission: string, _type: string, id: string) => (id === 'c2' ? forbidden() : null))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['emergency-stop']), body: { active: true } })

    expect(res.status).toBe(403)
    expect(relayMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'microseg.emergency_stop', status: 'failure' })
  })

  it('refuses an association with a connection of another tenant with the ownership refusal, without calling the orchestrator write', async () => {
    verifyConnectionOwnershipMock.mockImplementation(async (id: string) => (id === 'c9' ? notFound() : null))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['clusters']), body: { connection_id: 'c9' } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'Connection not found' })
    expect(verifyConnectionOwnershipMock.mock.calls).toEqual([['c1'], ['c9']])
    expect(relayMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'microseg.cluster.associate', status: 'failure', details: { path: 'clusters', method: 'POST', status: 404 } })
  })

  it('requires node.manage on the connection an association brings in', async () => {
    checkPermissionMock.mockImplementation(async (_permission: string, _type: string, id: string) => (id === 'c9' ? forbidden() : null))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['clusters']), body: { connection_id: 'c9' } })

    expect(res.status).toBe(403)
    expect(checkPermissionMock.mock.calls).toEqual([
      ['node.manage', 'connection', 'c1'],
      ['node.manage', 'connection', 'c9'],
    ])
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('relays an association the caller may make, leaving its audit row to the orchestrator', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    relayMock.mockResolvedValue(upstream(201, clusters('c1', 'c2', 'c3')))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['clusters']), body: { connection_id: 'c3' } })

    expect(res.status).toBe(201)
    expect(checkPermissionMock.mock.calls.map(c => c[2])).toEqual(['c1', 'c2', 'c3'])
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/clusters')
    expect(JSON.parse(relayMock.mock.calls[0][1].body)).toEqual({ connection_id: 'c3' })
    // The orchestrator writes the row, with the cluster it added: a second one here would double it.
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('refuses an association whose body names no connection with 400, before any orchestrator call', async () => {
    const { POST } = await import('./route')

    for (const body of [{}, { connection_id: 7 }, { connection_id: '' }, 'not json']) {
      const res = await callRoute(POST as any, { ...ctx(['clusters']), body })

      expect(res.status).toBe(400)
      expect(await readJson<any>(res)).toMatchObject({ code: 'INVALID' })
    }
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('refuses an association body with a case-variant duplicate key, never calling the orchestrator write', async () => {
    const { POST } = await import('./route')
    const bodies = [
      '{"connection_id":"c3","Connection_ID":"c9"}',
      '{"connection_id":"c3","CONNECTION_ID":"c9"}',
      '{"Connection_Id":"c9"}',
      '{"connection_id":"c3","extra":true}',
      '["c3"]',
      'null',
    ]

    for (const body of bodies) {
      const res = await callRoute(POST as any, { ...ctx(['clusters']), body, headers: { 'content-type': 'application/json' } })

      expect(res.status, body).toBe(400)
      expect(await readJson<any>(res)).toMatchObject({ code: 'INVALID' })
    }
    expect(relayMock).not.toHaveBeenCalled()
    expect(checkPermissionMock.mock.calls.map(c => c[2])).not.toContain('c9')
  })

  it('forwards an association as the body the relay rebuilt, exactly {"connection_id":"<id>"}', async () => {
    relayMock.mockResolvedValue(upstream(201, clusters('c1', 'c3')))
    const { POST } = await import('./route')
    // Duplicate exact keys: JSON.parse keeps the last one, the relay checks and forwards that same one.
    const res = await callRoute(POST as any, { ...ctx(['clusters']), body: '{"connection_id":"c9", "connection_id" : "c3"}', headers: { 'content-type': 'application/json' } })

    expect(res.status).toBe(201)
    expect(checkPermissionMock.mock.calls.map(c => c[2])).toEqual(['c1', 'c3'])
    expect(relayMock.mock.calls[0][1].body).toBe('{"connection_id":"c3"}')
  })

  it('refuses an unauthorized or unauthenticated caller on the URL connection before reading the body', async () => {
    const { POST, PUT } = await import('./route')
    const big = 'x'.repeat(1024 * 1024 + 1)

    checkPermissionMock.mockResolvedValueOnce(forbidden())
    const unauthorized = await callRoute(POST as any, { ...ctx(['clusters']), body: big, headers: { 'content-length': String(big.length) } })

    expect(unauthorized.status).toBe(403)

    checkPermissionMock.mockResolvedValueOnce(new Response('{"error":"Unauthorized"}', { status: 401, headers: { 'Content-Type': 'application/json' } }))
    const unauthenticated = await callRoute(POST as any, { ...ctx(['zones']), body: big, headers: { 'content-length': String(big.length) } })

    expect(unauthenticated.status).toBe(401)

    verifyConnectionOwnershipMock.mockResolvedValueOnce(notFound())
    const foreign = await callRoute(POST as any, { ...ctx(['members']), body: big, headers: { 'content-length': String(big.length) } })

    expect(foreign.status).toBe(404)

    // A refused write is audited without the version of a body the relay never read.
    checkPermissionMock.mockResolvedValueOnce(forbidden())
    await callRoute(PUT as any, { ...ctx(['zones', 'z1']), method: 'PUT', body: { version: 4 } })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(relayMock).not.toHaveBeenCalled()
    expect(auditMock.mock.calls.map(c => [c[0].action, c[0].details.status, c[0].details.version])).toEqual([
      ['microseg.cluster.associate', 403, undefined],
      ['microseg.members.set', 404, undefined],
      ['microseg.zone.update', 403, undefined],
    ])
  })

  it('relays a dissociation under node.manage on every linked cluster, leaving its audit row to the orchestrator', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    relayMock.mockResolvedValue(upstream(200, clusters('c1')))
    const { DELETE } = await import('./route')
    const res = await callRoute(DELETE as any, { ...ctx(['clusters', 'c2']), method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(checkPermissionMock.mock.calls).toEqual([
      ['node.manage', 'connection', 'c1'],
      ['node.manage', 'connection', 'c2'],
    ])
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/clusters/c2')
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('audits a dissociation refused before the orchestrator saw it, under its action', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    checkPermissionMock.mockImplementation(async (_permission: string, _type: string, id: string) => (id === 'c2' ? forbidden() : null))
    const { DELETE } = await import('./route')
    const res = await callRoute(DELETE as any, { ...ctx(['clusters', 'c2']), method: 'DELETE' })

    expect(res.status).toBe(403)
    expect(relayMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'microseg.cluster.dissociate', status: 'failure', details: { path: 'clusters/c2', method: 'DELETE', status: 403 } })
  })

  it('fails closed when the clusters cannot be read: no relay, the generic orchestrator error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unavailable: any = new Error('Orchestrator unavailable')

    unavailable.code = 'ORCHESTRATOR_UNAVAILABLE'
    const { GET } = await import('./route')

    fetchMock.mockRejectedValueOnce(unavailable)
    const down = await callRoute(GET as any, ctx(['policy']))

    expect(down.status).toBe(503)
    expect(await readJson<any>(down)).toMatchObject({ code: 'MICROSEG_UNAVAILABLE' })

    fetchMock.mockRejectedValueOnce(new Error('Orchestrator request timeout'))
    expect((await callRoute(GET as any, ctx(['policy']))).status).toBe(504)

    fetchMock.mockRejectedValueOnce(new Error('Orchestrator 500: {"code":"INTERNAL","error":"db down on connection c2"}'))
    const broken = await callRoute(GET as any, ctx(['policy']))
    const brokenText = await broken.text()

    expect(broken.status).toBe(502)
    expect(JSON.parse(brokenText)).toMatchObject({ code: 'ORCHESTRATOR_ERROR' })
    expect(brokenText).not.toContain('c2')

    fetchMock.mockRejectedValueOnce(new Error('Orchestrator 401: {"error":"invalid api key"}'))
    expect((await callRoute(GET as any, ctx(['policy']))).status).toBe(502)

    for (const answer of [null, {}, { clusters: 'c1' }, { clusters: [{ connection_id: 3 }] }, { clusters: [{}] }]) {
      fetchMock.mockResolvedValueOnce(answer)
      const malformed = await callRoute(GET as any, ctx(['policy']))

      expect(malformed.status).toBe(502)
      expect(await readJson<any>(malformed)).toMatchObject({ code: 'ORCHESTRATOR_ERROR' })
    }

    expect(relayMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('keeps the gate codes the UI reads (licence, leadership, engine) when the clusters read is refused for them', async () => {
    const { GET } = await import('./route')

    for (const [status, code] of [[403, 'FEATURE_REQUIRED'], [503, 'NOT_LEADER'], [503, 'MICROSEG_UNAVAILABLE']] as const) {
      fetchMock.mockRejectedValueOnce(new Error(`Orchestrator ${status}: {"code":"${code}","error":"refused"}`))
      const res = await callRoute(GET as any, ctx(['policy']))

      expect(res.status).toBe(status)
      expect(await readJson(res)).toEqual({ code, error: 'refused' })
    }
    expect(relayMock).not.toHaveBeenCalled()
  })
})

describe('microseg proxy route clusters read', () => {
  it('refuses with the generic 502 when the clusters answered do not include the URL connection, an empty list included', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET, PUT } = await import('./route')

    for (const answer of [clusters(), clusters('c2'), clusters('c2', 'c3')]) {
      fetchMock.mockResolvedValueOnce(answer)
      const res = await callRoute(GET as any, ctx(['policy']))
      const text = await res.text()

      expect(res.status).toBe(502)
      expect(JSON.parse(text)).toEqual({ code: 'ORCHESTRATOR_ERROR', error: 'Unexpected answer from the orchestrator' })
      expect(text).not.toContain('c2')
    }
    fetchMock.mockResolvedValueOnce(clusters('c2'))
    expect((await callRoute(PUT as any, { ...ctx(['zones', 'z1']), method: 'PUT', body: { version: 1 } })).status).toBe(502)

    expect(relayMock).not.toHaveBeenCalled()
    expect(checkPermissionMock.mock.calls.map(c => c[2])).not.toContain('c2')
    errorSpy.mockRestore()
  })

  it('answers GET clusters from its own clusters read: one orchestrator call, the answer as the orchestrator gave it', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['clusters']))

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(clusters('c1', 'c2'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/microseg/c1/clusters')
    expect(relayMock).not.toHaveBeenCalled()
    expect(checkPermissionMock.mock.calls).toEqual([
      ['node.view', 'connection', 'c1'],
      ['node.view', 'connection', 'c2'],
    ])
  })

  it('still refuses GET clusters when the caller may not read another cluster of the policy', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'secret-cluster'))
    verifyConnectionOwnershipMock.mockImplementation(async (id: string) => (id === 'secret-cluster' ? new Response('{"error":"Connection not found"}', { status: 404 }) : null))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['clusters']))
    const text = await res.text()

    expect(res.status).toBe(404)
    expect(text).not.toContain('secret-cluster')
    expect(relayMock).not.toHaveBeenCalled()
  })

  it('hands the request abort signal to the clusters read', async () => {
    const { GET } = await import('./route')
    const controller = new AbortController()
    const req = new Request('http://test.local/_', { signal: controller.signal })

    await GET(req as any, { params: Promise.resolve({ connectionId: 'c1', path: ['policy'] }) })

    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal

    expect(signal).toBeDefined()
    expect(signal.aborted).toBe(false)
    controller.abort()
    expect(signal.aborted).toBe(true)
  })

  it('checks the other clusters in parallel and returns the first refusal in the order of the list', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2', 'c3'))
    const order: string[] = []
    // c2 answers last: checked one after the other, c3 would only be looked at once c2 has answered.
    verifyConnectionOwnershipMock.mockImplementation(async (id: string) => {
      order.push(`start ${id}`)
      if (id === 'c2') await new Promise(resolve => setTimeout(resolve, 20))
      order.push(`end ${id}`)
      return null
    })
    checkPermissionMock.mockImplementation(async (_permission: string, _type: string, id: string) => {
      if (id === 'c2') return new Response('{"error":"Forbidden"}', { status: 403, headers: { 'Content-Type': 'application/json' } })
      if (id === 'c3') return new Response('{"error":"Connection not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
      return null
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['drifts']))

    expect(order).toContain('start c3')
    expect(order.indexOf('start c3')).toBeLessThan(order.indexOf('end c2'))
    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ error: 'Forbidden' })
    expect(relayMock).not.toHaveBeenCalled()
  })
})

describe('microseg proxy route run of the URL cluster', () => {
  const run = (connection_id: unknown) => ({ id: 'r-1', policy_id: 'p1', connection_id, kind: 'apply', status: 'running', started_at: '2026-11-17T10:00:00Z', duration_ms: 0, api_calls: 3, writes: 1, result: null, error: '' })

  it('serves the run of the URL cluster with one orchestrator call and the rights on that cluster alone', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    relayMock.mockResolvedValue(upstream(200, run('c1')))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['runs', 'r-1']))

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(run('c1'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(relayMock).toHaveBeenCalledTimes(1)
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/runs/r-1')
    expect(checkPermissionMock.mock.calls).toEqual([['node.view', 'connection', 'c1']])
  })

  it('answers the generic 404 for a run of another cluster, never its body', async () => {
    relayMock.mockResolvedValue(upstream(200, { ...run('secret-cluster'), error: 'dial tcp 10.0.0.9: connection refused' }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['runs', 'r-1']))
    const text = await res.text()

    expect(res.status).toBe(404)
    expect(JSON.parse(text)).toEqual({ code: 'NOT_FOUND', error: 'run not found' })
    expect(text).not.toContain('secret-cluster')
    expect(text).not.toContain('10.0.0.9')
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('serves a run of older data whose connection_id is empty', async () => {
    relayMock.mockResolvedValue(upstream(200, run('')))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['runs', 'r-1']))

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(run(''))
  })

  it('serves a run without a connection_id field, from an orchestrator older than the shared policies', async () => {
    const { connection_id: _omitted, ...legacy } = run('c1')
    relayMock.mockResolvedValue(upstream(200, legacy))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['runs', 'r-1']))

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(legacy)
  })

  it('fails closed with the generic 404 when a 200 answer cannot be read as a run', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET } = await import('./route')
    const bodies = ['not json', '', 'null', '[]', '"c1"', JSON.stringify(run(7)), JSON.stringify(run(null))]

    for (const body of bodies) {
      relayMock.mockResolvedValueOnce(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }))
      const res = await callRoute(GET as any, ctx(['runs', 'r-1']))

      expect(res.status, body).toBe(404)
      expect(await readJson(res)).toEqual({ code: 'NOT_FOUND', error: 'run not found' })
    }
    errorSpy.mockRestore()
  })

  it('passes a refusal of the run read through as before', async () => {
    relayMock.mockResolvedValue(upstream(404, { code: 'NOT_FOUND', error: 'run not found' }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['runs', 'r-9']))

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ code: 'NOT_FOUND', error: 'run not found' })
  })

  it('reads another route as before, whatever connection its answer names', async () => {
    relayMock.mockResolvedValue(upstream(200, { runs: [run('c2')], limit: 10, offset: 0 }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['runs']))

    expect(res.status).toBe(200)
  })
})

describe('microseg proxy route removal, a policy-wide write', () => {
  const forbidden = () => new Response('{"error":"Forbidden"}', { status: 403, headers: { 'Content-Type': 'application/json' } })

  it('removes a policy of one cluster with node.manage on that cluster alone (the clusters read is not licence-gated)', async () => {
    relayMock.mockResolvedValue(upstream(202, { run_id: 'r-1' }))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['remove']), method: 'POST' })

    expect(res.status).toBe(202)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/microseg/c1/clusters')
    expect(checkPermissionMock.mock.calls).toEqual([['node.manage', 'connection', 'c1']])
    expect(relayMock).toHaveBeenCalledTimes(1)
    expect(relayMock.mock.calls[0][0]).toBe('/microseg/c1/remove')
  })

  it('refuses the removal of one cluster of a shared policy to a user who may not manage every cluster, naming none', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'secret-cluster'))
    checkPermissionMock.mockImplementation(async (_permission: string, _type: string, id: string) => (id === 'secret-cluster' ? forbidden() : null))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['remove']), method: 'POST' })
    const text = await res.text()

    expect(res.status).toBe(403)
    expect(JSON.parse(text)).toEqual({ error: 'Forbidden' })
    expect(text).not.toContain('secret-cluster')
    expect(relayMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'microseg.remove', status: 'failure', details: { path: 'remove', status: 403 } })
  })

  it('fails closed when the clusters of the policy cannot be read', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchMock.mockRejectedValueOnce(new Error('Orchestrator 500: {"code":"INTERNAL","error":"db down"}'))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['remove']), method: 'POST' })

    expect(res.status).toBe(502)
    expect(relayMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('microseg proxy route checked clusters', () => {
  const HEADER = 'X-Microseg-Clusters'
  const changed = () => upstream(409, { code: 'CLUSTERS_CHANGED', error: 'the clusters of the policy changed: read them again' })
  const sentHeader = (call: number) => relayMock.mock.calls[call][1].headers?.[HEADER]

  it('sends the set of clusters it checked with every call made after the clusters read, reads and writes alike', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2', 'c2'))
    const { GET, POST, PUT, DELETE } = await import('./route')

    await callRoute(GET as any, ctx(['policy']))
    await callRoute(PUT as any, { ...ctx(['zones', 'z1']), method: 'PUT', body: { version: 1 } })
    await callRoute(POST as any, { ...ctx(['apply']), body: { version: 1 } })
    await callRoute(POST as any, { ...ctx(['clusters']), body: { connection_id: 'c3' } })
    await callRoute(DELETE as any, { ...ctx(['clusters', 'c2']), method: 'DELETE' })

    expect(relayMock).toHaveBeenCalledTimes(5)
    for (let i = 0; i < 5; i++) expect(sentHeader(i), String(i)).toBe('c1,c2')
  })

  it('sends no such header on a cluster route, which reads no clusters', async () => {
    const { GET, POST } = await import('./route')

    await callRoute(GET as any, ctx(['runs']))
    await callRoute(GET as any, ctx(['runs', 'r-1']))
    await callRoute(POST as any, { ...ctx(['members']), body: { version: 1, add: [] } })

    expect(fetchMock).not.toHaveBeenCalled()
    for (let i = 0; i < 3; i++) expect(sentHeader(i), String(i)).toBeUndefined()
  })

  it('reads the clusters again, checks them and replays the call once when they changed meanwhile', async () => {
    fetchMock.mockResolvedValueOnce(clusters('c1', 'c2')).mockResolvedValueOnce(clusters('c1', 'c2', 'c3'))
    relayMock.mockResolvedValueOnce(changed()).mockResolvedValueOnce(upstream(202, { run_id: 'r-1' }))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['apply']), body: { version: 7 } })

    expect(res.status).toBe(202)
    expect(await readJson(res)).toEqual({ run_id: 'r-1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(relayMock).toHaveBeenCalledTimes(2)
    expect(sentHeader(0)).toBe('c1,c2')
    expect(sentHeader(1)).toBe('c1,c2,c3')
    expect(relayMock.mock.calls[1][1].body).toBe(relayMock.mock.calls[0][1].body)
    expect(checkPermissionMock.mock.calls.map(c => c[2])).toEqual(['c1', 'c2', 'c2', 'c3'])
  })

  it('replays a read the same way', async () => {
    fetchMock.mockResolvedValueOnce(clusters('c1')).mockResolvedValueOnce(clusters('c1', 'c2'))
    relayMock.mockResolvedValueOnce(changed()).mockResolvedValueOnce(upstream(200, { policy: { connection_id: 'c1' } }))
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, ctx(['policy']))

    expect(res.status).toBe(200)
    expect(relayMock).toHaveBeenCalledTimes(2)
    expect(sentHeader(1)).toBe('c1,c2')
  })

  it('answers the generic conflict when the clusters changed again on the replay, naming no cluster', async () => {
    fetchMock.mockResolvedValueOnce(clusters('c1', 'c2')).mockResolvedValueOnce(clusters('c1', 'c2', 'c3'))
    relayMock.mockImplementation(async () => changed())
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['zones']), body: { version: 2, name: 'web' } })
    const text = await res.text()

    expect(res.status).toBe(409)
    expect(JSON.parse(text)).toEqual({ code: 'VERSION_CONFLICT', error: 'The clusters of the policy changed: read them again' })
    expect(text).not.toMatch(/c[123]/)
    expect(relayMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses the replay when the user may not act on a cluster linked meanwhile, and audits the refusal', async () => {
    fetchMock.mockResolvedValueOnce(clusters('c1', 'c2')).mockResolvedValueOnce(clusters('c1', 'c2', 'secret-cluster'))
    relayMock.mockResolvedValueOnce(changed())
    checkPermissionMock.mockImplementation(async (_permission: string, _type: string, id: string) =>
      (id === 'secret-cluster' ? new Response('{"error":"Forbidden"}', { status: 403, headers: { 'Content-Type': 'application/json' } }) : null))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['apply']), body: { version: 7 } })
    const text = await res.text()

    expect(res.status).toBe(403)
    expect(text).not.toContain('secret-cluster')
    expect(relayMock).toHaveBeenCalledTimes(1)
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'microseg.apply', status: 'failure', details: { status: 403 } })
  })

  it('passes another 409 through without a replay', async () => {
    fetchMock.mockResolvedValue(clusters('c1', 'c2'))
    relayMock.mockResolvedValue(upstream(409, { code: 'BUSY', error: 'busy' }))
    const { POST } = await import('./route')
    const res = await callRoute(POST as any, { ...ctx(['apply']), body: { version: 7 } })

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ code: 'BUSY', error: 'busy' })
    expect(relayMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a clusters answer whose IDs could not travel in the header, before any relay', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { GET } = await import('./route')

    for (const bad of ['c2,c9', 'c2\r\nX-Api-Key: k', 'c 2', 'c2;c9', '.c2', 'c'.repeat(129)]) {
      fetchMock.mockResolvedValueOnce(clusters('c1', bad))
      const res = await callRoute(GET as any, ctx(['policy']))
      const text = await res.text()

      expect(res.status, JSON.stringify(bad)).toBe(502)
      expect(JSON.parse(text)).toEqual({ code: 'ORCHESTRATOR_ERROR', error: 'Unexpected answer from the orchestrator' })
      expect(text).not.toContain('c9')
    }
    expect(relayMock).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('microseg proxy route run identity', () => {
  const run = (over: Record<string, unknown> = {}) => ({ id: 'r-1', policy_id: 'p1', connection_id: 'c1', kind: 'apply', status: 'done', started_at: '2026-11-17T10:00:00Z', duration_ms: 5, api_calls: 3, writes: 1, result: null, error: '', ...over })

  it('refuses a run answer that is not the run asked for at its top level', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { id: _omitted, ...withoutId } = run()
    const { GET } = await import('./route')

    for (const body of [{ run: run() }, withoutId, run({ id: 7 }), run({ id: '' }), run({ id: null }), run({ id: 'r-2' })]) {
      relayMock.mockResolvedValueOnce(upstream(200, body))
      const res = await callRoute(GET as any, ctx(['runs', 'r-1']))

      expect(res.status, JSON.stringify(body)).toBe(404)
      expect(await readJson(res)).toEqual({ code: 'NOT_FOUND', error: 'run not found' })
    }
    errorSpy.mockRestore()
  })

  it('answers an unknown run, a run of another cluster and a run of a cluster no longer linked alike', async () => {
    const { GET } = await import('./route')
    const answers = [
      // Unknown: the store's own wording.
      upstream(404, { code: 'NOT_FOUND', error: 'microseg: not found' }),
      // Of another cluster of the policy: served by the orchestrator, refused here.
      upstream(200, run({ connection_id: 'c2' })),
      // Of a cluster that left the policy: the orchestrator answers 404 itself.
      upstream(404, { code: 'NOT_FOUND', error: 'run not found' }),
      // An orchestrator 404 with a body of its own shape.
      new Response('{"error":"not found","detail":{"connection":"c2"}}', { status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' } }),
    ]
    const seen: Array<{ status: number; type: string | null; text: string }> = []

    for (const answer of answers) {
      relayMock.mockResolvedValueOnce(answer)
      const res = await callRoute(GET as any, ctx(['runs', 'r-1']))
      seen.push({ status: res.status, type: res.headers.get('content-type'), text: await res.text() })
    }
    for (const one of seen) expect(one).toEqual(seen[0])
    expect(seen[0].status).toBe(404)
    expect(JSON.parse(seen[0].text)).toEqual({ code: 'NOT_FOUND', error: 'run not found' })
  })
})
