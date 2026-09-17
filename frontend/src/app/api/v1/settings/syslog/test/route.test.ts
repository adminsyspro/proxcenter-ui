import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/syslog/guard', () => ({ requireSyslogAdmin: vi.fn() }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/syslog/forwarder', () => ({
  loadSyslogConfig: vi.fn(),
  saveSyslogConfig: vi.fn(),
  getSyslogStatus: vi.fn(),
  testSyslogDestination: vi.fn(),
}))

import { testSyslogDestination } from '@/lib/syslog/forwarder'
import { requireSyslogAdmin } from '@/lib/syslog/guard'

import { POST } from './route'

const guardMock = vi.mocked(requireSyslogAdmin)
const testMock = vi.mocked(testSyslogDestination)

const ALLOWED = { denied: null, userId: 'u1', userEmail: 'alice@example.org' } as const
const RENDERED = '<110>1 2026-09-17T09:36:16.000Z pxc-01 proxcenter 4242 test [proxcenter@32473 action="test"] alice@example.org test'

function deniedResponse(status = 403): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), { status, headers: { 'content-type': 'application/json' } })
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/v1/settings/syslog/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const minimal = { name: 'SIEM', host: '127.0.0.1', port: 514, transport: 'udp' }

beforeEach(() => {
  guardMock.mockReset()
  testMock.mockReset()
  guardMock.mockResolvedValue(ALLOWED)
  testMock.mockResolvedValue({ ok: true, message: RENDERED })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('POST /api/v1/settings/syslog/test', () => {
  it('returns the guard response untouched when denied', async () => {
    const denied = deniedResponse(401)
    guardMock.mockResolvedValue({ denied })

    const res = await POST(post(minimal))

    expect(res).toBe(denied)
    expect(testMock).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON with 400', async () => {
    const res = await POST(post('{not json'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' })
    expect(testMock).not.toHaveBeenCalled()
  })

  it('rejects a schema violation with 400 and the offending path', async () => {
    const res = await POST(post({ ...minimal, port: 0 }))

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; issues: Array<{ path: string; message: string }> }
    expect(body.error).toBe('Invalid destination')
    expect(body.issues).toHaveLength(1)
    expect(body.issues[0].path).toBe('port')
    expect(testMock).not.toHaveBeenCalled()
  })

  it('defaults the id to "test", passes the guard actor and returns the result as is', async () => {
    const res = await POST(post(minimal))

    expect(res.status).toBe(200)
    expect(testMock).toHaveBeenCalledTimes(1)
    const [dest, actor] = testMock.mock.calls[0]
    expect(dest).toEqual({
      id: 'test',
      name: 'SIEM',
      enabled: true,
      host: '127.0.0.1',
      port: 514,
      transport: 'udp',
      format: 'rfc5424',
      framing: 'newline',
      facility: 13,
      categories: [],
      tls: { verify: true, ca: '', serverName: '' },
    })
    expect(actor).toEqual({ userId: 'u1', userEmail: 'alice@example.org' })
    expect(await res.json()).toEqual({ ok: true, message: RENDERED })
  })

  it('keeps a provided id and the tls block of an unsaved destination', async () => {
    const res = await POST(
      post({
        ...minimal,
        id: 'dest-42',
        transport: 'tls',
        port: 6514,
        framing: 'octet-counting',
        tls: { verify: false, ca: 'PEM', serverName: 'collector.internal' },
      }),
    )

    expect(res.status).toBe(200)
    expect(testMock.mock.calls[0][0]).toMatchObject({
      id: 'dest-42',
      transport: 'tls',
      port: 6514,
      framing: 'octet-counting',
      tls: { verify: false, ca: 'PEM', serverName: 'collector.internal' },
    })
  })

  it('passes a delivery failure through with status 200 so the UI can show the reason', async () => {
    testMock.mockResolvedValue({ ok: false, error: 'connect ECONNREFUSED 127.0.0.1:514', message: RENDERED })

    const res = await POST(post(minimal))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, error: 'connect ECONNREFUSED 127.0.0.1:514', message: RENDERED })
  })

  it('answers 500 with ok: false when the test itself throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    testMock.mockRejectedValue(new Error('boom'))

    const res = await POST(post(minimal))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ ok: false, error: 'boom' })
  })
})
