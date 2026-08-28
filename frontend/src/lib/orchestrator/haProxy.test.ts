import net from 'node:net'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { orchestratorFailure, proxyHaJson } from './haProxy'

vi.mock('./headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

const undiciError = (message: string, code: string) =>
  Object.assign(new TypeError(message), {
    cause: Object.assign(new Error('simulated'), { code }),
  })

describe('orchestratorFailure', () => {
  it('reports an orchestrator that is not listening as 503 unavailable', () => {
    expect(orchestratorFailure(undiciError('fetch failed', 'ECONNREFUSED'))).toEqual({
      status: 503,
      error: 'Orchestrator unavailable',
    })
  })

  it('keeps 503 for an unknown failure, including an error without a cause', () => {
    expect(orchestratorFailure(new Error('ECONNREFUSED')).status).toBe(503)
    expect(orchestratorFailure(undefined).status).toBe(503)
    expect(orchestratorFailure(undiciError('fetch failed', 'ENOTFOUND')).status).toBe(503)
  })

  it.each([
    ['UND_ERR_SOCKET', 'fetch failed'],
    ['ECONNRESET', 'fetch failed'],
    ['UND_ERR_HEADERS_TIMEOUT', 'fetch failed'],
    ['UND_ERR_BODY_TIMEOUT', 'terminated'],
  ])('reports a cut exchange (%s) as 504, not as an unavailable orchestrator', (code, message) => {
    const failure = orchestratorFailure(undiciError(message, code))

    expect(failure.status).toBe(504)
    expect(failure.error).toContain('closed the connection')
  })

  it('reports a cut that happened after the headers (undici "terminated") as 504', () => {
    expect(orchestratorFailure(new TypeError('terminated')).status).toBe(504)
  })

  it('reports an aborted request as 504', () => {
    expect(orchestratorFailure(Object.assign(new Error('x'), { name: 'AbortError' })).status).toBe(504)
  })
})

// These two run against the real runtime fetch, on real sockets: the whole
// point of the fix is that Node reports "nothing is listening" and "the peer
// hung up mid-request" with the SAME `TypeError: fetch failed`, and only
// `cause.code` separates them. A hand-built error object cannot prove that.
describe('proxyHaJson against real sockets', () => {
  const originalUrl = process.env.ORCHESTRATOR_URL

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.ORCHESTRATOR_URL
    else process.env.ORCHESTRATOR_URL = originalUrl
  })

  it('answers 504 when the orchestrator closes the socket without answering (#803)', async () => {
    // Exactly what the Go http.Server does when api.write_timeout expires
    // while the HA preflight is still probing nodes.
    const server = net.createServer(sock => {
      sock.on('data', () => sock.end())
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
    const { port } = server.address() as net.AddressInfo
    process.env.ORCHESTRATOR_URL = `http://127.0.0.1:${port}`

    try {
      const res = await proxyHaJson('/ha/validate', { method: 'POST', body: { nodes: [] } })
      const body = await res.json()

      expect(res.status).toBe(504)
      expect(body.error).toContain('closed the connection')
      expect(body.error).not.toContain('unavailable')
    } finally {
      await new Promise(resolve => server.close(resolve))
    }
  })

  it('answers 503 when nothing is listening at all', async () => {
    const probe = net.createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', () => resolve()))
    const { port } = probe.address() as net.AddressInfo
    await new Promise(resolve => probe.close(resolve))
    process.env.ORCHESTRATOR_URL = `http://127.0.0.1:${port}`

    const res = await proxyHaJson('/ha/cluster')
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body).toEqual({ error: 'Orchestrator unavailable' })
  })
})

describe('proxyHaJson forwarding', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch') as any
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  const upstream = (status: number, json: unknown) =>
    fetchSpy.mockResolvedValue({ ok: status < 400, status, json: async () => json } as any)

  it('hands the orchestrator payload and status back untouched', async () => {
    upstream(200, { results: [{ ip: '192.0.2.101' }] })

    const res = await proxyHaJson('/ha/validate', { method: 'POST', body: { vip: '192.0.2.100' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ results: [{ ip: '192.0.2.101' }] })
  })

  it('forwards an upstream error status instead of flattening it', async () => {
    upstream(409, { error: 'deployment already running' })

    const res = await proxyHaJson('/ha/deploy', { method: 'POST', body: {} })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'deployment already running' })
  })

  it('sends the API key, and a Content-Type only when there is a body', async () => {
    upstream(200, {})
    await proxyHaJson('/ha/pause', { method: 'POST' })
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/v1/ha/pause'),
      expect.objectContaining({ method: 'POST', body: undefined, headers: { 'X-API-Key': 'test' } })
    )

    upstream(200, {})
    await proxyHaJson('/ha/sync-mode', { method: 'PUT', body: { mode: 'off' } })
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/v1/ha/sync-mode'),
      expect.objectContaining({
        method: 'PUT',
        body: '{"mode":"off"}',
        headers: { 'X-API-Key': 'test', 'Content-Type': 'application/json' },
      })
    )
  })

  it('keeps an upstream error status when the error body is not JSON either', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    } as any)

    const res = await proxyHaJson('/ha/cluster')

    expect(res.status).toBe(500)
  })

  it('does not blame the orchestrator for a malformed body it did send', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    } as any)

    const res = await proxyHaJson('/ha/cluster')

    expect(res.status).toBe(502)
    expect((await res.json()).error).toContain('malformed')
  })
})
