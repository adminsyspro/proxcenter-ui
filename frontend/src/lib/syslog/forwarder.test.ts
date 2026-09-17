import dgram from 'node:dgram'
import net from 'node:net'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/settings', () => ({ getSetting: vi.fn(), setSetting: vi.fn() }))

import { getSetting, setSetting } from '@/lib/db/settings'

import {
  _impl,
  _resetSyslogRegistry,
  destinationAccepts,
  formatContext,
  forwardAuditEvent,
  getSyslogStatus,
  invalidateSyslogConfig,
  loadSyslogConfig,
  parseSyslogConfig,
  saveSyslogConfig,
  testEvent,
  testSyslogDestination,
  transportFingerprint,
} from './forwarder'
import type { SyslogAuditEvent, SyslogConfig, SyslogDestination } from './types'

const WAIT_MS = 2000
const T0 = Date.parse('2026-09-17T09:36:16.000Z')
const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const getSettingMock = vi.mocked(getSetting)
const setSettingMock = vi.mocked(setSetting)

let now = T0
const spyLicense = () => vi.spyOn(_impl, 'hasServerFeature')
let license: ReturnType<typeof spyLicense>

// ---- fixtures ------------------------------------------------------------------

function dest(overrides: Partial<SyslogDestination> = {}): SyslogDestination {
  return {
    id: 'd1',
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
    ...overrides,
  }
}

function config(...destinations: SyslogDestination[]): SyslogConfig {
  return { version: 1, destinations }
}

function evt(overrides: Partial<SyslogAuditEvent> = {}): SyslogAuditEvent {
  return {
    id: 'evt_01',
    timestamp: new Date('2026-09-17T09:36:16.000Z'),
    tenantId: 'default',
    userId: 'u1',
    userEmail: 'alice@example.org',
    apiTokenId: null,
    action: 'login',
    category: 'auth',
    resourceType: null,
    resourceId: null,
    resourceName: null,
    details: null,
    ipAddress: '10.0.0.5',
    userAgent: null,
    status: 'success',
    errorMessage: null,
    ...overrides,
  }
}

// ---- harness -------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, label: string, ms = WAIT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${label}`)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function waitUntil(predicate: () => boolean, label: string, ms = WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() > deadline) return reject(new Error(`timed out after ${ms} ms waiting for ${label}`))
      setTimeout(tick, 5)
    }
    tick()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface UdpHarness {
  port: number
  count: () => number
  next: () => Promise<Buffer>
  close: () => Promise<void>
}

const cleanups: Array<() => Promise<void>> = []

async function startUdp(): Promise<UdpHarness> {
  const socket = dgram.createSocket('udp4')
  const messages: Buffer[] = []
  const waiters: Array<() => void> = []
  let cursor = 0
  socket.on('message', msg => {
    messages.push(msg)
    waiters.shift()?.()
  })
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  const harness: UdpHarness = {
    port: socket.address().port,
    count: () => messages.length,
    next: () =>
      withTimeout(
        new Promise<Buffer>(resolve => {
          if (messages.length > cursor) return resolve(messages[cursor++])
          waiters.push(() => resolve(messages[cursor++]))
        }),
        'a datagram',
      ),
    close: () => new Promise<void>(resolve => socket.close(() => resolve())),
  }
  cleanups.push(harness.close)
  return harness
}

beforeEach(() => {
  _resetSyslogRegistry()
  now = T0
  getSettingMock.mockReset()
  setSettingMock.mockReset()
  setSettingMock.mockResolvedValue(undefined)
  vi.spyOn(_impl, 'now').mockImplementation(() => now)
  license = spyLicense().mockResolvedValue(true)
})

afterEach(async () => {
  _resetSyslogRegistry()
  vi.restoreAllMocks()
  for (const c of cleanups.splice(0)) await c()
})

// ---- parseSyslogConfig ---------------------------------------------------------

describe('parseSyslogConfig', () => {
  it('yields the empty config for a missing row', () => {
    expect(parseSyslogConfig(null)).toEqual({ version: 1, destinations: [] })
    expect(parseSyslogConfig(undefined)).toEqual({ version: 1, destinations: [] })
  })

  it('yields the empty config for garbage, never throws', () => {
    expect(parseSyslogConfig('garbage')).toEqual({ version: 1, destinations: [] })
    expect(parseSyslogConfig(42)).toEqual({ version: 1, destinations: [] })
    expect(parseSyslogConfig({ destinations: 'nope' })).toEqual({ version: 1, destinations: [] })
    expect(parseSyslogConfig({ version: 2, destinations: [] })).toEqual({ version: 1, destinations: [] })
  })

  it('round-trips a valid config', () => {
    const cfg = config(dest(), dest({ id: 'd2', name: 'Graylog', transport: 'tcp', port: 1514, categories: ['auth', 'vms'] }))
    expect(parseSyslogConfig(cfg)).toEqual(cfg)
  })

  it('fills the schema defaults on a minimal destination', () => {
    const parsed = parseSyslogConfig({ destinations: [{ id: 'x', name: 'X', host: 'h', port: 514, transport: 'udp' }] })
    expect(parsed).toEqual({
      version: 1,
      destinations: [
        {
          id: 'x',
          name: 'X',
          enabled: true,
          host: 'h',
          port: 514,
          transport: 'udp',
          format: 'rfc5424',
          framing: 'newline',
          facility: 13,
          categories: [],
          tls: { verify: true, ca: '', serverName: '' },
        },
      ],
    })
  })

  it('rejects the whole config when one destination has a bad port', () => {
    const parsed = parseSyslogConfig(config(dest(), dest({ id: 'd2', port: 70000 })))
    expect(parsed).toEqual({ version: 1, destinations: [] })
  })
})

// ---- loadSyslogConfig ----------------------------------------------------------

describe('loadSyslogConfig', () => {
  it('reads the provider row once and serves it from cache for 30 s', async () => {
    const cfg = config(dest())
    getSettingMock.mockResolvedValue(cfg)

    expect(await loadSyslogConfig()).toEqual(cfg)
    expect(await loadSyslogConfig()).toEqual(cfg)
    expect(getSettingMock).toHaveBeenCalledTimes(1)
    expect(getSettingMock).toHaveBeenCalledWith('syslog_destinations', 'default')

    now += 29 * SECOND
    await loadSyslogConfig()
    expect(getSettingMock).toHaveBeenCalledTimes(1)

    now += 2 * SECOND // 31 s after the first read
    await loadSyslogConfig()
    expect(getSettingMock).toHaveBeenCalledTimes(2)
  })

  it('force = true bypasses the cache', async () => {
    getSettingMock.mockResolvedValue(config(dest()))
    await loadSyslogConfig()
    await loadSyslogConfig(true)
    expect(getSettingMock).toHaveBeenCalledTimes(2)
  })

  it('invalidateSyslogConfig() bypasses the cache on the next read', async () => {
    getSettingMock.mockResolvedValue(config(dest()))
    await loadSyslogConfig()
    invalidateSyslogConfig()
    await loadSyslogConfig()
    expect(getSettingMock).toHaveBeenCalledTimes(2)
  })

  it('caches an empty config for a corrupt row too', async () => {
    getSettingMock.mockResolvedValue('garbage')
    expect(await loadSyslogConfig()).toEqual({ version: 1, destinations: [] })
    await loadSyslogConfig()
    expect(getSettingMock).toHaveBeenCalledTimes(1)
  })
})

// ---- destinationAccepts --------------------------------------------------------

describe('destinationAccepts', () => {
  it('refuses a disabled destination whatever the category', () => {
    expect(destinationAccepts(dest({ enabled: false }), 'auth')).toBe(false)
    expect(destinationAccepts(dest({ enabled: false, categories: ['auth'] }), 'auth')).toBe(false)
  })

  it('accepts every category when the filter is empty', () => {
    expect(destinationAccepts(dest(), 'auth')).toBe(true)
    expect(destinationAccepts(dest(), 'vms')).toBe(true)
    expect(destinationAccepts(dest(), 'something-new')).toBe(true)
  })

  it('accepts only the listed categories otherwise', () => {
    const d = dest({ categories: ['auth', 'security'] })
    expect(destinationAccepts(d, 'auth')).toBe(true)
    expect(destinationAccepts(d, 'security')).toBe(true)
    expect(destinationAccepts(d, 'vms')).toBe(false)
  })
})

// ---- forwardAuditEvent ---------------------------------------------------------

describe('forwardAuditEvent', () => {
  it('never probes the licence when no destination accepts the event', async () => {
    getSettingMock.mockResolvedValue(null)
    await forwardAuditEvent(evt())
    expect(license).not.toHaveBeenCalled()

    getSettingMock.mockResolvedValue(config(dest({ categories: ['vms'] })))
    invalidateSyslogConfig()
    await forwardAuditEvent(evt({ category: 'auth' }))
    expect(license).not.toHaveBeenCalled()
    expect(getSyslogStatus()).toEqual({})
  })

  it('delivers a matching event to a UDP destination and counts it', async () => {
    const udp = await startUdp()
    getSettingMock.mockResolvedValue(config(dest({ port: udp.port })))

    await forwardAuditEvent(evt())

    const line = (await udp.next()).toString('utf8')
    expect(line.startsWith('<110>1 2026-09-17T09:36:16.000Z ')).toBe(true)
    expect(line).toContain('action="login"')
    expect(line).toContain('alice@example.org login from 10.0.0.5: success')
    await waitUntil(() => getSyslogStatus().d1?.sent === 1, 'status.sent === 1 for d1')
    expect(license).toHaveBeenCalledTimes(1)
    expect(license).toHaveBeenCalledWith('syslog_forwarding')
  })

  it('fans out to every accepting destination, honouring each format', async () => {
    const a = await startUdp()
    const b = await startUdp()
    getSettingMock.mockResolvedValue(
      config(
        dest({ id: 'a', port: a.port }),
        dest({ id: 'b', port: b.port, format: 'cef', categories: ['auth'] }),
        dest({ id: 'c', port: b.port, categories: ['vms'] }),
        dest({ id: 'd', port: b.port, enabled: false }),
      ),
    )

    await forwardAuditEvent(evt())

    expect((await a.next()).toString('utf8').startsWith('<110>1 ')).toBe(true)
    expect((await b.next()).toString('utf8')).toContain(' CEF:0|ProxCenter|')
    await waitUntil(() => getSyslogStatus().a?.sent === 1 && getSyslogStatus().b?.sent === 1, 'both counters')
    expect(Object.keys(getSyslogStatus()).sort()).toEqual(['a', 'b'])
  })

  it('reuses the sender across events and re-reads the config after the TTL', async () => {
    const udp = await startUdp()
    getSettingMock.mockResolvedValue(config(dest({ port: udp.port })))

    await forwardAuditEvent(evt({ id: 'e1' }))
    await forwardAuditEvent(evt({ id: 'e2' }))
    await udp.next()
    await udp.next()
    expect(getSettingMock).toHaveBeenCalledTimes(1)
    await waitUntil(() => getSyslogStatus().d1?.sent === 2, 'two sends on one sender')

    now += 31 * SECOND
    await forwardAuditEvent(evt({ id: 'e3' }))
    await udp.next()
    expect(getSettingMock).toHaveBeenCalledTimes(2)
    await waitUntil(() => getSyslogStatus().d1?.sent === 3, 'third send on the same sender')
  })

  it('sends nothing when the licence is denied and no previous verdict exists', async () => {
    const udp = await startUdp()
    getSettingMock.mockResolvedValue(config(dest({ port: udp.port })))
    license.mockResolvedValue(false)

    await forwardAuditEvent(evt())
    await sleep(50)

    expect(udp.count()).toBe(0)
    expect(getSyslogStatus()).toEqual({})
    expect(license).toHaveBeenCalledTimes(1)

    // the negative verdict is cached for a minute
    await forwardAuditEvent(evt())
    expect(license).toHaveBeenCalledTimes(1)
    expect(getSyslogStatus()).toEqual({})
  })

  it('keeps forwarding on a denial within 24 h of a positive verdict (grace)', async () => {
    const udp = await startUdp()
    getSettingMock.mockResolvedValue(config(dest({ port: udp.port })))

    license.mockResolvedValue(true)
    await forwardAuditEvent(evt({ id: 'e1' }))
    await udp.next()

    now += 2 * HOUR
    license.mockResolvedValue(false)
    await forwardAuditEvent(evt({ id: 'e2' }))

    const line = (await udp.next()).toString('utf8')
    expect(line).toContain('event_id="e2"')
    expect(license).toHaveBeenCalledTimes(2)
    await waitUntil(() => getSyslogStatus().d1?.sent === 2, 'status.sent === 2 for d1')
  })

  it('stops forwarding once a denial comes more than 24 h after the last positive verdict', async () => {
    const udp = await startUdp()
    getSettingMock.mockResolvedValue(config(dest({ port: udp.port })))

    license.mockResolvedValue(true)
    await forwardAuditEvent(evt({ id: 'e1' }))
    await udp.next()
    await waitUntil(() => getSyslogStatus().d1?.sent === 1, 'first send')

    now += 25 * HOUR
    license.mockResolvedValue(false)
    await forwardAuditEvent(evt({ id: 'e2' }))
    await sleep(50)

    expect(udp.count()).toBe(1)
    expect(getSyslogStatus().d1?.sent).toBe(1)
    expect(license).toHaveBeenCalledTimes(2)
  })

  it('swallows a settings failure, warning at most once every five minutes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSettingMock.mockRejectedValue(new Error('db down'))

    await expect(forwardAuditEvent(evt())).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[syslog] forwarding failed:', 'db down')

    now += 4 * MINUTE
    await expect(forwardAuditEvent(evt())).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)

    now += 2 * MINUTE // 6 min after the first warning
    await forwardAuditEvent(evt())
    expect(warn).toHaveBeenCalledTimes(2)
    expect(license).not.toHaveBeenCalled()
  })

  it('swallows a licence probe failure as well', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    getSettingMock.mockResolvedValue(config(dest()))
    license.mockRejectedValue(new Error('orchestrator unreachable'))

    await expect(forwardAuditEvent(evt())).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[syslog] forwarding failed:', 'orchestrator unreachable')
    expect(getSyslogStatus()).toEqual({})
  })
})

// ---- saveSyslogConfig ----------------------------------------------------------

describe('saveSyslogConfig', () => {
  it('persists the parsed config under the provider tenant and returns it', async () => {
    const cfg = config(dest(), dest({ id: 'd2', transport: 'tcp', port: 1514 }))

    const saved = await saveSyslogConfig(cfg)

    expect(saved).toEqual(cfg)
    expect(setSettingMock).toHaveBeenCalledTimes(1)
    expect(setSettingMock).toHaveBeenCalledWith('syslog_destinations', 'default', cfg)
  })

  it('refreshes the read cache so the next load does not hit the database', async () => {
    const cfg = config(dest())
    await saveSyslogConfig(cfg)
    expect(await loadSyslogConfig()).toEqual(cfg)
    expect(getSettingMock).not.toHaveBeenCalled()
  })

  it('closes the sender of a destination that was removed', async () => {
    const udp = await startUdp()
    getSettingMock.mockResolvedValue(config(dest({ port: udp.port })))
    await forwardAuditEvent(evt())
    await udp.next()
    expect(Object.keys(getSyslogStatus())).toEqual(['d1'])

    await saveSyslogConfig(config())

    expect(getSyslogStatus()).toEqual({})
  })

  it('closes the sender of a destination that was disabled, keeps the others', async () => {
    const udp = await startUdp()
    getSettingMock.mockResolvedValue(config(dest({ id: 'a', port: udp.port }), dest({ id: 'b', port: udp.port })))
    await forwardAuditEvent(evt())
    await udp.next()
    await udp.next()
    expect(Object.keys(getSyslogStatus()).sort()).toEqual(['a', 'b'])

    await saveSyslogConfig(config(dest({ id: 'a', port: udp.port, enabled: false }), dest({ id: 'b', port: udp.port })))

    expect(Object.keys(getSyslogStatus())).toEqual(['b'])
  })

  it('replaces the socket when the transport fingerprint changes, keeps it otherwise', async () => {
    const udp = await startUdp()
    const other = await startUdp()
    getSettingMock.mockResolvedValue(config(dest({ port: udp.port })))
    await forwardAuditEvent(evt({ id: 'e1' }))
    await udp.next()
    await waitUntil(() => getSyslogStatus().d1?.sent === 1, 'first send')

    // a format change keeps the sender (and its counters)
    await saveSyslogConfig(config(dest({ port: udp.port, format: 'cef' })))
    await forwardAuditEvent(evt({ id: 'e2' }))
    expect((await udp.next()).toString('utf8')).toContain(' CEF:0|')
    await waitUntil(() => getSyslogStatus().d1?.sent === 2, 'counter carried over')

    // a port change opens a new sender: counters start again
    await saveSyslogConfig(config(dest({ port: other.port })))
    await forwardAuditEvent(evt({ id: 'e3' }))
    expect((await other.next()).toString('utf8')).toContain('event_id="e3"')
    await waitUntil(() => getSyslogStatus().d1?.sent === 1, 'fresh counter on the new sender')
    expect(udp.count()).toBe(2)
  })

  it('rejects an invalid config before touching the database', async () => {
    await expect(saveSyslogConfig(config(dest({ port: 0 })))).rejects.toThrow()
    expect(setSettingMock).not.toHaveBeenCalled()
  })
})

// ---- transportFingerprint ------------------------------------------------------

describe('transportFingerprint', () => {
  const base = dest()

  it('ignores format, facility, categories, name and enabled', () => {
    const fp = transportFingerprint(base)
    expect(transportFingerprint(dest({ format: 'cef' }))).toBe(fp)
    expect(transportFingerprint(dest({ facility: 4 }))).toBe(fp)
    expect(transportFingerprint(dest({ categories: ['auth'] }))).toBe(fp)
    expect(transportFingerprint(dest({ name: 'renamed' }))).toBe(fp)
    expect(transportFingerprint(dest({ enabled: false }))).toBe(fp)
    expect(transportFingerprint(dest({ id: 'other-id' }))).toBe(fp)
  })

  it('changes with host, port, transport, framing and every tls field', () => {
    const fp = transportFingerprint(base)
    expect(transportFingerprint(dest({ host: '10.0.0.9' }))).not.toBe(fp)
    expect(transportFingerprint(dest({ port: 1514 }))).not.toBe(fp)
    expect(transportFingerprint(dest({ transport: 'tcp' }))).not.toBe(fp)
    expect(transportFingerprint(dest({ framing: 'octet-counting' }))).not.toBe(fp)
    expect(transportFingerprint(dest({ tls: { verify: false, ca: '', serverName: '' } }))).not.toBe(fp)
    expect(transportFingerprint(dest({ tls: { verify: true, ca: 'PEM', serverName: '' } }))).not.toBe(fp)
    expect(transportFingerprint(dest({ tls: { verify: true, ca: '', serverName: 'sni' } }))).not.toBe(fp)
  })
})

// ---- test button ---------------------------------------------------------------

describe('testEvent / testSyslogDestination', () => {
  it('builds a synthetic settings/test row that names the destination and the actor', () => {
    const d = dest({ id: 'dest-42', name: 'Splunk', transport: 'tcp', port: 1514 })
    const e = testEvent(d, { userId: 'u1', userEmail: 'alice@example.org' })

    expect(e.action).toBe('test')
    expect(e.category).toBe('settings')
    expect(e.resourceType).toBe('syslog_destination')
    expect(e.resourceId).toBe('dest-42')
    expect(e.resourceName).toBe('Splunk')
    expect(e.userId).toBe('u1')
    expect(e.userEmail).toBe('alice@example.org')
    expect(e.apiTokenId).toBeNull()
    expect(e.tenantId).toBe('default')
    expect(e.status).toBe('success')
    expect(e.id.startsWith('test-')).toBe(true)
    expect(e.details).toEqual({ transport: 'tcp', format: 'rfc5424', host: '127.0.0.1', port: 1514 })
  })

  it('tolerates a missing actor', () => {
    const e = testEvent(dest(), {})
    expect(e.userId).toBeNull()
    expect(e.userEmail).toBeNull()
  })

  it('delivers the rendered test line over UDP and returns it with ok: true', async () => {
    const udp = await startUdp()

    const result = await testSyslogDestination(dest({ port: udp.port }), { userId: 'u1', userEmail: 'alice@example.org' })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('test')
    expect(result.message).toContain('action="test"')
    expect(result.message).toContain('alice@example.org test syslog_destination d1 (SIEM): success')
    expect((await udp.next()).toString('utf8')).toBe(result.message)
    // the test button does not go through the registry: no sender, no counters
    expect(getSyslogStatus()).toEqual({})
  })

  it('reports the transport error on an unreachable TCP collector', async () => {
    // bind a TCP listener on port 0, read the port, release it: a port nobody listens on
    const probe = net.createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as net.AddressInfo).port
    await new Promise<void>(resolve => probe.close(() => resolve()))

    const result = await testSyslogDestination(dest({ transport: 'tcp', port }), {})

    expect(result).toEqual({
      ok: false,
      error: expect.stringMatching(/ECONNREFUSED/),
      message: expect.stringContaining('action="test"'),
    })
  })
})

describe('formatContext', () => {
  it('reports this process', () => {
    const ctx = formatContext()
    expect(ctx.pid).toBe(process.pid)
    expect(typeof ctx.hostname).toBe('string')
    expect(ctx.hostname.length).toBeGreaterThan(0)
  })
})
