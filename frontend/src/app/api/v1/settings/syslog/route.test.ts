import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/syslog/guard', () => ({ requireSyslogAdmin: vi.fn() }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/syslog/forwarder', () => ({
  loadSyslogConfig: vi.fn(),
  saveSyslogConfig: vi.fn(),
  getSyslogStatus: vi.fn(),
  testSyslogDestination: vi.fn(),
}))

import { audit } from '@/lib/audit'
import { getSyslogStatus, loadSyslogConfig, saveSyslogConfig } from '@/lib/syslog/forwarder'
import { requireSyslogAdmin } from '@/lib/syslog/guard'
import type { SyslogDestination, SyslogDestinationStatus } from '@/lib/syslog/types'

import { GET, PUT } from './route'

const guardMock = vi.mocked(requireSyslogAdmin)
const auditMock = vi.mocked(audit)
const loadMock = vi.mocked(loadSyslogConfig)
const saveMock = vi.mocked(saveSyslogConfig)
const statusMock = vi.mocked(getSyslogStatus)

const ALLOWED = { denied: null, userId: 'u1', userEmail: 'alice@example.org' } as const

function deniedResponse(status = 403): Response {
  return new Response(JSON.stringify({ error: 'Forbidden' }), { status, headers: { 'content-type': 'application/json' } })
}

function dest(overrides: Partial<SyslogDestination> = {}): SyslogDestination {
  return {
    id: 'd1',
    name: 'SIEM',
    enabled: true,
    host: 'siem.example.org',
    port: 514,
    transport: 'udp',
    format: 'rfc5424',
    framing: 'newline',
    facility: 13,
    categories: [],
    tls: { verify: true, ca: '', serverName: '' },
    ...overrides,
  }
}

function status(overrides: Partial<SyslogDestinationStatus> = {}): SyslogDestinationStatus {
  return { connected: true, sent: 3, dropped: 0, failed: 0, lastSentAt: null, lastError: null, lastErrorAt: null, ...overrides }
}

function put(body: unknown): Request {
  return new Request('http://localhost/api/v1/settings/syslog', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

type AuditDetails = { before: Array<Record<string, unknown>>; after: Array<Record<string, unknown>> }

beforeEach(() => {
  guardMock.mockReset()
  auditMock.mockReset()
  loadMock.mockReset()
  saveMock.mockReset()
  statusMock.mockReset()
  guardMock.mockResolvedValue(ALLOWED)
  auditMock.mockResolvedValue('audit-1')
  statusMock.mockReturnValue({})
  loadMock.mockResolvedValue({ version: 1, destinations: [] })
  saveMock.mockImplementation(async cfg => cfg)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/v1/settings/syslog', () => {
  it('returns the guard response untouched when denied', async () => {
    const denied = deniedResponse(401)
    guardMock.mockResolvedValue({ denied })

    const res = await GET()

    expect(res).toBe(denied)
    expect(loadMock).not.toHaveBeenCalled()
  })

  it('returns destinations, live status and limits when allowed', async () => {
    const d = dest()
    loadMock.mockResolvedValue({ version: 1, destinations: [d] })
    statusMock.mockReturnValue({ d1: status() })

    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      destinations: [d],
      status: { d1: status() },
      limits: { maxDestinations: 20 },
    })
    // the settings screen must see what is saved, not a 30 s old cache
    expect(loadMock).toHaveBeenCalledWith(true)
  })

  it('answers 500 with the message when the settings read fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    loadMock.mockRejectedValue(new Error('db down'))

    const res = await GET()

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
  })
})

describe('PUT /api/v1/settings/syslog', () => {
  it('returns the guard response untouched when denied', async () => {
    const denied = deniedResponse()
    guardMock.mockResolvedValue({ denied })

    const res = await PUT(put({ destinations: [] }))

    expect(res).toBe(denied)
    expect(saveMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON with 400', async () => {
    const res = await PUT(put('{not json'))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' })
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('rejects a schema violation with 400 and the offending path', async () => {
    const res = await PUT(put({ destinations: [{ name: 'A', host: 'h', port: 70000, transport: 'udp' }] }))

    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; issues: Array<{ path: string; message: string }> }
    expect(body.error).toBe('Invalid destinations')
    expect(body.issues).toHaveLength(1)
    expect(body.issues[0].path).toBe('destinations.0.port')
    expect(typeof body.issues[0].message).toBe('string')
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('rejects more than MAX_SYSLOG_DESTINATIONS entries', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ name: `d${i}`, host: 'h', port: 514, transport: 'udp' }))

    const res = await PUT(put({ destinations: many }))

    expect(res.status).toBe(400)
    const body = (await res.json()) as { issues: Array<{ path: string }> }
    expect(body.issues[0].path).toBe('destinations')
  })

  it('assigns ids, saves the full config, audits without the CA bundle', async () => {
    const res = await PUT(
      put({
        destinations: [
          { name: 'Splunk', host: 'splunk.local', port: 514, transport: 'udp' },
          {
            name: 'Graylog',
            host: '10.0.0.9',
            port: 6514,
            transport: 'tls',
            framing: 'octet-counting',
            categories: ['auth', 'security'],
            tls: { verify: true, ca: 'PEM-CA-BUNDLE', serverName: 'graylog.local' },
          },
        ],
      }),
    )

    expect(res.status).toBe(200)

    // saved config
    expect(saveMock).toHaveBeenCalledTimes(1)
    const saved = saveMock.mock.calls[0][0]
    expect(saved.version).toBe(1)
    expect(saved.destinations).toHaveLength(2)
    const ids = saved.destinations.map(d => d.id)
    for (const id of ids) expect(id.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(2)
    expect(saved.destinations[0]).toEqual({
      id: ids[0],
      name: 'Splunk',
      enabled: true,
      host: 'splunk.local',
      port: 514,
      transport: 'udp',
      format: 'rfc5424',
      framing: 'newline',
      facility: 13,
      categories: [],
      tls: { verify: true, ca: '', serverName: '' },
    })
    expect(saved.destinations[1]).toMatchObject({
      id: ids[1],
      transport: 'tls',
      framing: 'octet-counting',
      categories: ['auth', 'security'],
      tls: { verify: true, ca: 'PEM-CA-BUNDLE', serverName: 'graylog.local' },
    })

    // audit row
    expect(auditMock).toHaveBeenCalledTimes(1)
    const entry = auditMock.mock.calls[0][0]
    expect(entry).toMatchObject({
      action: 'update',
      category: 'settings',
      resourceType: 'syslog_destinations',
      resourceId: 'syslog_destinations',
    })
    const details = entry.details as AuditDetails
    expect(details.before).toEqual([])
    expect(details.after).toHaveLength(2)
    expect(details.after[0]).not.toHaveProperty('tls')
    expect(details.after[0]).not.toHaveProperty('tls.ca')
    expect(details.after[1]).not.toHaveProperty('tls')
    expect(details.after[1]).toMatchObject({ id: ids[1], transport: 'tls', tlsVerify: true })
    expect(JSON.stringify(details)).not.toContain('PEM-CA-BUNDLE')

    // response
    const body = (await res.json()) as { destinations: SyslogDestination[]; status: unknown; limits: unknown }
    expect(body.destinations.map(d => d.id)).toEqual(ids)
    expect(body.status).toEqual({})
    expect(body.limits).toEqual({ maxDestinations: 20 })
  })

  it('keeps a provided id and records the previous list in details.before', async () => {
    loadMock.mockResolvedValue({ version: 1, destinations: [dest({ id: 'old', name: 'Old' })] })

    const res = await PUT(put({ destinations: [{ id: 'keep-me', name: 'A', host: 'h', port: 514, transport: 'udp' }] }))

    expect(res.status).toBe(200)
    expect(saveMock.mock.calls[0][0].destinations.map(d => d.id)).toEqual(['keep-me'])
    const details = auditMock.mock.calls[0][0].details as AuditDetails
    expect(details.before.map(d => d.id)).toEqual(['old'])
    expect(details.after.map(d => d.id)).toEqual(['keep-me'])
  })

  it('treats a blank id as missing', async () => {
    const res = await PUT(put({ destinations: [{ id: '   ', name: 'A', host: 'h', port: 514, transport: 'udp' }] }))

    expect(res.status).toBe(200)
    const id = saveMock.mock.calls[0][0].destinations[0].id
    expect(id.trim().length).toBeGreaterThan(0)
  })

  it('gives two destinations that share an id two distinct ids', async () => {
    const res = await PUT(
      put({
        destinations: [
          { id: 'same', name: 'A', host: 'h', port: 514, transport: 'udp' },
          { id: 'same', name: 'B', host: 'h', port: 515, transport: 'udp' },
        ],
      }),
    )

    expect(res.status).toBe(200)
    const ids = saveMock.mock.calls[0][0].destinations.map(d => d.id)
    expect(ids[0]).toBe('same')
    expect(ids[1]).not.toBe('same')
    expect(ids[1].length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(2)
  })

  it('answers 500 with the message when saving fails, and does not audit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    saveMock.mockRejectedValue(new Error('db down'))

    const res = await PUT(put({ destinations: [{ name: 'A', host: 'h', port: 514, transport: 'udp' }] }))

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'db down' })
    expect(auditMock).not.toHaveBeenCalled()
  })
})
