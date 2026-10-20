import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { auditMock } = vi.hoisted(() => ({
  auditMock: vi.fn<(entry: any) => Promise<string>>(),
}))

// The real audit() pulls next/headers, Prisma and the syslog forwarder; the
// wrapper's contract is what it hands over, so the call is captured instead.
vi.mock('./index', () => ({ audit: auditMock }))

import { markAuditExplicit } from './scope'
import { MAX_CAPTURED_BODY_BYTES, MAX_REQUEST_DETAIL_CHARS, withAudit, type AuditRouteSpec } from './withAudit'

const SPEC: AuditRouteSpec = { category: 'vms', resourceType: 'guest', resourceParam: 'vmid' }

function jsonRequest(method: string, body: unknown, url = 'http://t/api/v1/connections/c1/guests/qemu/pve1', headers: Record<string, string> = {}) {
  const text = JSON.stringify(body)
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)), ...headers },
    body: text,
  })
}

type Handler = (req: Request, ctx?: unknown) => Promise<Response>

function ok(body: unknown = { ok: true }, status = 200): Handler {
  return async () => Response.json(body, { status })
}

const ctx = (params: Record<string, string | string[]>) => ({ params: Promise.resolve(params) })

function entry() {
  expect(auditMock).toHaveBeenCalledTimes(1)
  return auditMock.mock.calls[0][0]
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  auditMock.mockReset()
  auditMock.mockResolvedValue('row-id')
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
})

describe('withAudit, the row it writes', () => {
  it('writes one success row with route, method, status, params, query and the redacted body', async () => {
    const handler = withAudit(SPEC, ok())
    const req = jsonRequest('POST', { name: 'web-01', password: 'hunter2', nested: { token: 'abc', keep: 1 } }, 'http://t/api/v1/connections/c1/guests/qemu/pve1?dry=1&x=y')

    const res = await handler(req, ctx({ id: 'c1', type: 'qemu', node: 'pve1' }))

    expect(res.status).toBe(200)
    const row = entry()
    expect(row.category).toBe('vms')
    expect(row.action).toBe('create')
    expect(row.resourceType).toBe('guest')
    expect(row.status).toBe('success')
    expect(row.errorMessage).toBeUndefined()
    expect(row.details.route).toBe('/api/v1/connections/c1/guests/qemu/pve1')
    expect(row.details.method).toBe('POST')
    expect(row.details.httpStatus).toBe(200)
    expect(row.details.params).toEqual({ id: 'c1', type: 'qemu', node: 'pve1' })
    expect(row.details.query).toEqual({ dry: '1', x: 'y' })
    expect(row.details.request).toEqual({ name: 'web-01', password: '[redacted]', nested: { token: '[redacted]', keep: 1 } })
    expect(JSON.stringify(row)).not.toContain('hunter2')
  })

  it('derives the action from the method and lets the spec override it', async () => {
    await withAudit(SPEC, ok())(jsonRequest('PUT', {}), ctx({}))
    await withAudit(SPEC, ok())(jsonRequest('PATCH', {}), ctx({}))
    await withAudit(SPEC, ok())(new Request('http://t/api/v1/x', { method: 'DELETE' }), ctx({}))
    await withAudit(SPEC, ok())(new Request('http://t/api/v1/x'), ctx({}))
    await withAudit({ ...SPEC, action: 'upgrade' }, ok())(jsonRequest('POST', {}), ctx({}))

    expect(auditMock.mock.calls.map(c => c[0].action)).toEqual(['update', 'update', 'delete', 'read', 'upgrade'])
  })

  it('takes the resource id from the route param first, then from the body field', async () => {
    const spec: AuditRouteSpec = { ...SPEC, resourceBodyField: 'vmid', resourceNameBodyField: 'name' }

    await withAudit(spec, ok())(jsonRequest('POST', { vmid: 200, name: 'from-body' }), ctx({ vmid: '100' }))
    expect(auditMock.mock.calls[0][0].resourceId).toBe('100')
    expect(auditMock.mock.calls[0][0].resourceName).toBe('from-body')

    await withAudit(spec, ok())(jsonRequest('POST', { vmid: 200, name: 42 }), ctx({}))
    expect(auditMock.mock.calls[1][0].resourceId).toBe('200')
    expect(auditMock.mock.calls[1][0].resourceName).toBeUndefined()
  })

  it('accepts a plain params object and a missing context', async () => {
    await withAudit(SPEC, ok())(jsonRequest('POST', {}), { params: { vmid: '7' } })
    expect(auditMock.mock.calls[0][0].resourceId).toBe('7')

    await withAudit(SPEC, ok())(jsonRequest('POST', {}))
    expect(auditMock.mock.calls[1][0].resourceId).toBeUndefined()
    expect(auditMock.mock.calls[1][0].details.params).toEqual({})
  })

  it('joins a catch-all param into one id', async () => {
    await withAudit({ category: 'storage', resourceParam: 'path' }, ok())(jsonRequest('POST', {}), ctx({ path: ['a', 'b'] }))
    expect(entry().resourceId).toBe('a/b')
  })

  describe('resourceTypeParam, the guest [type] segment', () => {
    const guest: AuditRouteSpec = { ...SPEC, resourceTypeParam: 'type' }

    it('names the resource after the param instead of the spec, a qemu guest staying under vms', async () => {
      await withAudit(guest, ok())(jsonRequest('POST', {}), ctx({ type: 'qemu', vmid: '100' }))
      expect(entry()).toMatchObject({ category: 'vms', resourceType: 'qemu', resourceId: '100' })
    })

    it('moves an lxc guest from vms to containers, like the routes that audit themselves', async () => {
      await withAudit(guest, ok())(jsonRequest('POST', {}), ctx({ type: 'lxc', vmid: '200' }))
      expect(entry()).toMatchObject({ category: 'containers', resourceType: 'lxc', resourceId: '200' })
    })

    it('switches the category on a failure row too', async () => {
      await withAudit(guest, ok({ error: 'locked' }, 409))(jsonRequest('POST', {}), ctx({ type: 'lxc', vmid: '200' }))
      expect(entry()).toMatchObject({ category: 'containers', status: 'failure', errorMessage: 'locked' })
    })

    it('leaves another category alone whatever the type param says', async () => {
      await withAudit({ category: 'firewall', resourceTypeParam: 'type' }, ok())(jsonRequest('POST', {}), ctx({ type: 'lxc' }))
      expect(entry()).toMatchObject({ category: 'firewall', resourceType: 'lxc' })
    })

    it('falls back to the spec resourceType when the param is absent or empty', async () => {
      await withAudit(guest, ok())(jsonRequest('POST', {}), ctx({ vmid: '100' }))
      expect(auditMock.mock.calls[0][0]).toMatchObject({ category: 'vms', resourceType: 'guest' })

      await withAudit(guest, ok())(jsonRequest('POST', {}), ctx({ type: '', vmid: '100' }))
      expect(auditMock.mock.calls[1][0]).toMatchObject({ category: 'vms', resourceType: 'guest' })
    })

    it('does not read the type from the body', async () => {
      await withAudit(guest, ok())(jsonRequest('POST', { type: 'lxc' }), ctx({ vmid: '100' }))
      expect(entry()).toMatchObject({ category: 'vms', resourceType: 'guest' })
    })
  })
})

describe('withAudit, failures', () => {
  it('writes a failure row with the error of a JSON 4xx response, and keeps the response readable', async () => {
    const handler = withAudit(SPEC, ok({ error: 'Permission denied' }, 403))
    const res = await handler(jsonRequest('POST', {}), ctx({ vmid: '100' }))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Permission denied' })
    const row = entry()
    expect(row.status).toBe('failure')
    expect(row.errorMessage).toBe('Permission denied')
    expect(row.details.httpStatus).toBe(403)
  })

  it('falls back to `message`, ignores non-string errors and truncates at 500 chars', async () => {
    await withAudit(SPEC, ok({ message: 'Upstream said no' }, 502))(jsonRequest('POST', {}), ctx({}))
    expect(auditMock.mock.calls[0][0].errorMessage).toBe('Upstream said no')

    await withAudit(SPEC, ok({ error: { code: 1 } }, 500))(jsonRequest('POST', {}), ctx({}))
    expect(auditMock.mock.calls[1][0].errorMessage).toBeUndefined()

    await withAudit(SPEC, ok({ error: 'x'.repeat(700) }, 500))(jsonRequest('POST', {}), ctx({}))
    expect(auditMock.mock.calls[2][0].errorMessage).toHaveLength(500)
  })

  it('leaves errorMessage empty on a non-JSON error response', async () => {
    const handler = withAudit(SPEC, async (_req: Request, _ctx?: unknown) => new Response('nope', { status: 500, headers: { 'content-type': 'text/plain' } }))
    const res = await handler(jsonRequest('POST', {}), ctx({}))

    expect(await res.text()).toBe('nope')
    expect(entry().errorMessage).toBeUndefined()
    expect(entry().status).toBe('failure')
  })

  it('writes a failure row with the thrown message, then rethrows the same error', async () => {
    const boom = new Error('PVE: 595 no route to host')
    const handler = withAudit(SPEC, async (_req: Request, _ctx?: unknown) => { throw boom })

    await expect(handler(jsonRequest('POST', { vmid: 1 }), ctx({ vmid: '1' }))).rejects.toBe(boom)
    const row = entry()
    expect(row.status).toBe('failure')
    expect(row.errorMessage).toBe('PVE: 595 no route to host')
    expect(row.details.httpStatus).toBe(500)
    expect(row.resourceId).toBe('1')
  })

  it('stringifies a non-Error throw', async () => {
    const handler = withAudit(SPEC, async (_req: Request, _ctx?: unknown) => { throw 'plain' })
    await expect(handler(jsonRequest('POST', {}), ctx({}))).rejects.toBe('plain')
    expect(entry().errorMessage).toBe('plain')
  })
})

describe('withAudit, when it writes nothing', () => {
  it('skips the row when the handler audited itself', async () => {
    const handler = withAudit(SPEC, async (_req: Request, _ctx?: unknown) => {
      markAuditExplicit()
      return Response.json({ ok: true })
    })
    const res = await handler(jsonRequest('POST', {}), ctx({}))

    expect(res.status).toBe(200)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('skips the row when the handler audited itself and then threw', async () => {
    const handler = withAudit(SPEC, async (_req: Request, _ctx?: unknown) => {
      markAuditExplicit()
      throw new Error('after audit')
    })
    await expect(handler(jsonRequest('POST', {}), ctx({}))).rejects.toThrow('after audit')
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('does not flag a request as explicit from another request', async () => {
    const quiet = withAudit(SPEC, ok())
    const loud = withAudit(SPEC, async (_req: Request, _ctx?: unknown) => {
      markAuditExplicit()
      return Response.json({})
    })
    await Promise.all([loud(jsonRequest('POST', {}), ctx({})), quiet(jsonRequest('POST', {}), ctx({}))])
    expect(auditMock).toHaveBeenCalledTimes(1)
  })

  it('skips 401 and 3xx responses', async () => {
    await withAudit(SPEC, ok({ error: 'Unauthorized' }, 401))(jsonRequest('POST', {}), ctx({}))
    await withAudit(SPEC, async (_req: Request, _ctx?: unknown) => Response.redirect('http://t/login', 302))(jsonRequest('POST', {}), ctx({}))
    await withAudit(SPEC, async (_req: Request, _ctx?: unknown) => new Response(null, { status: 304 }))(jsonRequest('POST', {}), ctx({}))
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('still writes a 403 and a 404', async () => {
    await withAudit(SPEC, ok({ error: 'Forbidden' }, 403))(jsonRequest('POST', {}), ctx({}))
    await withAudit(SPEC, ok({ error: 'Not found' }, 404))(jsonRequest('POST', {}), ctx({}))
    expect(auditMock.mock.calls.map(c => c[0].errorMessage)).toEqual(['Forbidden', 'Not found'])
  })
})

describe('withAudit, body capture', () => {
  it('leaves the body readable for the handler', async () => {
    let seen: unknown
    const handler = withAudit(SPEC, async (req: Request, _ctx?: unknown) => {
      seen = await req.json()
      return Response.json({})
    })
    await handler(jsonRequest('POST', { vmid: 101, name: 'db' }), ctx({}))

    expect(seen).toEqual({ vmid: 101, name: 'db' })
    expect(entry().details.request).toEqual({ vmid: 101, name: 'db' })
  })

  it('never clones a body that is not declared as JSON', async () => {
    const req = new Request('http://t/api/v1/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'content-length': '3' },
      body: 'iso',
    })
    const clone = vi.spyOn(req, 'clone')
    await withAudit({ category: 'storage' }, ok())(req, ctx({}))

    expect(clone).not.toHaveBeenCalled()
    expect(entry().details).not.toHaveProperty('request')
  })

  it('never clones without a content-length, nor above 64 KiB', async () => {
    const noLength = new Request('http://t/api/v1/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' })
    const tooBig = new Request('http://t/api/v1/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(MAX_CAPTURED_BODY_BYTES + 1) },
      body: '{"a":1}',
    })
    const spies = [vi.spyOn(noLength, 'clone'), vi.spyOn(tooBig, 'clone')]

    await withAudit(SPEC, ok())(noLength, ctx({}))
    await withAudit(SPEC, ok())(tooBig, ctx({}))

    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    for (const call of auditMock.mock.calls) expect(call[0].details).not.toHaveProperty('request')
  })

  it('tolerates a body that is not valid JSON', async () => {
    const req = new Request('http://t/api/v1/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '5' },
      body: '{bad}',
    })
    const res = await withAudit(SPEC, ok())(req, ctx({}))

    expect(res.status).toBe(200)
    expect(entry().details).not.toHaveProperty('request')
  })

  it('replaces an oversized redacted body by requestTruncated', async () => {
    const body = { blob: 'z'.repeat(MAX_REQUEST_DETAIL_CHARS) }
    await withAudit(SPEC, ok())(jsonRequest('POST', body), ctx({}))

    const details = entry().details
    expect(details.requestTruncated).toBe(true)
    expect(details).not.toHaveProperty('request')
  })

  it('redacts credentials in the query string too', async () => {
    await withAudit(SPEC, ok())(jsonRequest('POST', {}, 'http://t/api/v1/x?password=p4ss&node=pve1'), ctx({}))
    expect(entry().details.query).toEqual({ password: '[redacted]', node: 'pve1' })
  })

  it('keeps a JSON array body as is', async () => {
    await withAudit(SPEC, ok())(jsonRequest('POST', [1, 2]), ctx({}))
    expect(entry().details.request).toEqual([1, 2])
    expect(entry().resourceId).toBeUndefined()
  })
})

describe('withAudit never changes the response', () => {
  it('returns the handler response untouched when the audit write fails', async () => {
    auditMock.mockRejectedValue(new Error('database is down'))
    const response = Response.json({ created: 1 }, { status: 201 })
    const handler = withAudit(SPEC, async (_req: Request, _ctx?: unknown) => response)

    const res = await handler(jsonRequest('POST', {}), ctx({}))

    expect(res).toBe(response)
    expect(await res.json()).toEqual({ created: 1 })
    expect(consoleError).toHaveBeenCalledWith('[audit] withAudit could not write the audit row:', 'database is down')
  })

  it('rethrows the handler error even when the audit write fails', async () => {
    auditMock.mockRejectedValue(new Error('database is down'))
    const handler = withAudit(SPEC, async (_req: Request, _ctx?: unknown) => { throw new Error('handler failed') })

    await expect(handler(jsonRequest('POST', {}), ctx({}))).rejects.toThrow('handler failed')
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('survives a rejected params promise', async () => {
    const res = await withAudit(SPEC, ok())(jsonRequest('POST', {}), { params: Promise.reject(new Error('no params')) })
    expect(res.status).toBe(200)
    expect(entry().details.params).toEqual({})
  })
})
