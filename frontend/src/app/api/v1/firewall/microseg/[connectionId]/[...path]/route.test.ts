import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const verifyConnectionOwnershipMock = vi.fn<(id: string) => Promise<Response | null>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const denyIaasTenantMock = vi.fn<() => Promise<Response | null>>()
const relayMock = vi.fn<(...args: any[]) => Promise<Response>>()
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
}))

function upstream(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// callRoute types params as strings; a catch-all gets an array.
const ctx = (path: string[]) => ({ params: { connectionId: 'c1', path } as any })

beforeEach(() => {
  vi.clearAllMocks()
  verifyConnectionOwnershipMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  denyIaasTenantMock.mockResolvedValue(null)
  relayMock.mockResolvedValue(upstream(200, { ok: true }))
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
