import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./forwarder', () => ({ forwardAuditEvent: vi.fn(async () => {}), loadSyslogConfig: vi.fn() }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'

import { forwardAuditEvent, loadSyslogConfig } from './forwarder'
import {
  ORCHESTRATOR_CURSOR_KEY,
  ORCHESTRATOR_RELAY_BATCH_SIZE,
  ORCHESTRATOR_RELAY_INTERVAL_MS,
  parseCursor,
  relayOrchestratorAuditOnce,
  startOrchestratorAuditRelay,
  toSyslogEvent,
  type OrchestratorRelayDeps,
  type RelayCursor,
} from './orchestratorRelay'
import type { SyslogConfig } from './types'

const forwardMock = vi.mocked(forwardAuditEvent)
const loadConfigMock = vi.mocked(loadSyslogConfig)

const T0 = new Date('2026-10-20T09:00:00.000Z')
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000)

function config(enabled: boolean): SyslogConfig {
  return {
    version: 1,
    destinations: [
      {
        id: 'd1',
        name: 'SIEM',
        enabled,
        host: '127.0.0.1',
        port: 514,
        transport: 'udp',
        format: 'rfc5424',
        framing: 'newline',
        facility: 13,
        categories: [],
        tls: { verify: true, ca: '', serverName: '' },
      },
    ],
  }
}

async function row(id: string, timestamp: Date, source = 'orchestrator', extra: Record<string, unknown> = {}) {
  await prismaTest.auditLog.create({
    data: {
      id,
      tenantId: 'default',
      timestamp,
      action: 'drs.migrate',
      category: 'automation',
      userEmail: 'system:orchestrator',
      userAgent: 'proxcenter-orchestrator',
      source,
      ...extra,
    },
  })
}

async function cursor(): Promise<RelayCursor | null> {
  const setting = await prismaTest.setting.findUnique({ where: { key_tenantId: { key: ORCHESTRATOR_CURSOR_KEY, tenantId: 'default' } } })
  return setting ? parseCursor(setting.value) : null
}

/** Rows written after the cursor, in the order the relay reads them. */
function forwardedIds(): string[] {
  return forwardMock.mock.calls.map(call => call[0].id)
}

beforeEach(async () => {
  forwardMock.mockClear()
  loadConfigMock.mockReset()
  loadConfigMock.mockResolvedValue(config(true))
  await truncate(['audit_logs', 'settings'])
})

describe('relayOrchestratorAuditOnce', () => {
  it('does nothing while no destination is enabled, not even create the cursor', async () => {
    loadConfigMock.mockResolvedValue(config(false))
    await row('old', at(-60))

    expect(await relayOrchestratorAuditOnce()).toBe(0)
    expect(forwardMock).not.toHaveBeenCalled()
    expect(await cursor()).toBeNull()
  })

  it('starts from now on the first run, so the history is not replayed', async () => {
    await row('history-1', at(-120))
    await row('history-2', at(-60))

    expect(await relayOrchestratorAuditOnce({ now: () => T0 })).toBe(0)
    expect(forwardMock).not.toHaveBeenCalled()
    expect(await cursor()).toEqual({ ts: T0.toISOString(), id: '' })
  })

  it('forwards the orchestrator rows written after the cursor, in (timestamp, id) order, and advances it', async () => {
    await relayOrchestratorAuditOnce({ now: () => T0 })
    await row('b', at(2))
    await row('a', at(1), 'orchestrator', { resourceId: '100', resourceName: 'web-01', details: { reason: 'cpu' } })
    await row('app-row', at(3), 'app')
    await row('before', at(-1))

    expect(await relayOrchestratorAuditOnce({ now: () => at(10) })).toBe(2)
    expect(forwardedIds()).toEqual(['a', 'b'])
    expect(forwardMock.mock.calls[0][0]).toMatchObject({
      id: 'a',
      tenantId: 'default',
      userEmail: 'system:orchestrator',
      action: 'drs.migrate',
      category: 'automation',
      resourceId: '100',
      resourceName: 'web-01',
      details: { reason: 'cpu' },
      status: 'success',
    })
    expect(await cursor()).toEqual({ ts: at(2).toISOString(), id: 'b' })

    forwardMock.mockClear()
    expect(await relayOrchestratorAuditOnce()).toBe(0)
    expect(forwardMock).not.toHaveBeenCalled()
  })

  it('breaks a timestamp tie on the id, so a row sharing the cursor timestamp is forwarded once', async () => {
    await prismaTest.setting.create({
      data: { key: ORCHESTRATOR_CURSOR_KEY, tenantId: 'default', value: { ts: at(5).toISOString(), id: 'm' } },
    })
    await row('a', at(5))
    await row('m', at(5))
    await row('z', at(5))

    expect(await relayOrchestratorAuditOnce()).toBe(1)
    expect(forwardedIds()).toEqual(['z'])
    expect(await cursor()).toEqual({ ts: at(5).toISOString(), id: 'z' })
  })

  it('relays at most one batch per run and picks up the rest on the next', async () => {
    await relayOrchestratorAuditOnce({ now: () => T0 })
    const total = ORCHESTRATOR_RELAY_BATCH_SIZE + 2
    await prismaTest.auditLog.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        id: `r${String(i).padStart(4, '0')}`,
        tenantId: 'default',
        timestamp: at(1 + i),
        action: 'rolling.step',
        category: 'automation',
        source: 'orchestrator',
      })),
    })

    expect(await relayOrchestratorAuditOnce()).toBe(ORCHESTRATOR_RELAY_BATCH_SIZE)
    expect(await cursor()).toEqual({ ts: at(ORCHESTRATOR_RELAY_BATCH_SIZE).toISOString(), id: `r${String(ORCHESTRATOR_RELAY_BATCH_SIZE - 1).padStart(4, '0')}` })
    expect(await relayOrchestratorAuditOnce()).toBe(2)
    expect(await relayOrchestratorAuditOnce()).toBe(0)
    expect(forwardMock).toHaveBeenCalledTimes(total)
  })

  it('restarts from now on a corrupt cursor instead of replaying the table', async () => {
    await prismaTest.setting.create({ data: { key: ORCHESTRATOR_CURSOR_KEY, tenantId: 'default', value: 'garbage' } })
    await row('old', at(-60))

    expect(await relayOrchestratorAuditOnce({ now: () => T0 })).toBe(0)
    expect(forwardMock).not.toHaveBeenCalled()
  })

  it('claims the batch before forwarding it, so a failed forward is never re-sent', async () => {
    await relayOrchestratorAuditOnce({ now: () => T0 })
    await row('a', at(1))

    await expect(relayOrchestratorAuditOnce({ forward: async () => { throw new Error('format failed') } })).rejects.toThrow('format failed')
    expect(await cursor()).toEqual({ ts: at(1).toISOString(), id: 'a' })
    expect(await relayOrchestratorAuditOnce()).toBe(0)
  })

  it('skips the batch when another replica advanced the cursor first', async () => {
    await relayOrchestratorAuditOnce({ now: () => T0 })
    await row('a', at(1))
    await row('b', at(2))

    // Both replicas read the same cursor; exactly one claim succeeds.
    const counts = await Promise.all([relayOrchestratorAuditOnce(), relayOrchestratorAuditOnce()])

    expect(counts.sort()).toEqual([0, 2])
    expect(forwardedIds()).toEqual(['a', 'b'])
    expect(await cursor()).toEqual({ ts: at(2).toISOString(), id: 'b' })
  })

  it('tolerates two replicas creating the cursor at the same time', async () => {
    const counts = await Promise.all([relayOrchestratorAuditOnce({ now: () => T0 }), relayOrchestratorAuditOnce({ now: () => at(1) })])

    expect(counts).toEqual([0, 0])
    const created = await cursor()
    expect([T0.toISOString(), at(1).toISOString()]).toContain(created?.ts)
    expect(created?.id).toBe('')
  })
})

describe('parseCursor and toSyslogEvent', () => {
  it('accepts a stored cursor and rejects anything else', () => {
    expect(parseCursor({ ts: '2026-10-20T09:00:00.000Z', id: 'x' })).toEqual({ ts: '2026-10-20T09:00:00.000Z', id: 'x' })
    expect(parseCursor({ ts: '2026-10-20T09:00:00.000Z' })).toEqual({ ts: '2026-10-20T09:00:00.000Z', id: '' })
    expect(parseCursor({ ts: 'not a date', id: 'x' })).toBeNull()
    expect(parseCursor({ id: 'x' })).toBeNull()
    expect(parseCursor(null)).toBeNull()
    expect(parseCursor('2026-10-20T09:00:00.000Z')).toBeNull()
  })

  it('maps a row field by field', () => {
    const timestamp = at(0)
    expect(
      toSyslogEvent({
        id: 'r1',
        tenantId: 't1',
        timestamp,
        userId: null,
        userEmail: 'alice@example.org',
        action: 'drain.start',
        category: 'automation',
        resourceType: 'node',
        resourceId: 'pve1',
        resourceName: null,
        details: { initiated_by: 'alice@example.org' },
        ipAddress: null,
        userAgent: 'proxcenter-orchestrator',
        status: 'failure',
        errorMessage: 'boom',
        apiTokenId: null,
        source: 'orchestrator',
      }),
    ).toEqual({
      id: 'r1',
      tenantId: 't1',
      timestamp,
      userId: null,
      userEmail: 'alice@example.org',
      apiTokenId: null,
      action: 'drain.start',
      category: 'automation',
      resourceType: 'node',
      resourceId: 'pve1',
      resourceName: null,
      details: { initiated_by: 'alice@example.org' },
      ipAddress: null,
      userAgent: 'proxcenter-orchestrator',
      status: 'failure',
      errorMessage: 'boom',
    })
  })
})

describe('startOrchestratorAuditRelay', () => {
  let stop: (() => void) | undefined
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    stop?.()
    stop = undefined
    warn.mockRestore()
    vi.useRealTimers()
  })

  it('relays on every tick and passes the deps through', async () => {
    const relay = vi.fn<(deps: OrchestratorRelayDeps) => Promise<number>>(async () => 0)
    const now = () => T0
    stop = startOrchestratorAuditRelay({ relay, now })

    await vi.advanceTimersByTimeAsync(ORCHESTRATOR_RELAY_INTERVAL_MS * 3)

    expect(relay).toHaveBeenCalledTimes(3)
    expect(relay.mock.calls[0][0]).toEqual({ now })
  })

  it('is idempotent: a second start returns the running relay', async () => {
    const relay = vi.fn(async () => 0)
    stop = startOrchestratorAuditRelay({ relay, intervalMs: 100 })
    const again = startOrchestratorAuditRelay({ relay: vi.fn(async () => 0), intervalMs: 100 })

    await vi.advanceTimersByTimeAsync(250)

    expect(again).toBe(stop)
    expect(relay).toHaveBeenCalledTimes(2)
  })

  it('never overlaps a slow batch with the next tick', async () => {
    let release: () => void = () => {}
    const relay = vi.fn(() => new Promise<number>(resolve => { release = () => resolve(0) }))
    stop = startOrchestratorAuditRelay({ relay, intervalMs: 100 })

    await vi.advanceTimersByTimeAsync(350)
    expect(relay).toHaveBeenCalledTimes(1)

    release()
    await vi.advanceTimersByTimeAsync(100)
    expect(relay).toHaveBeenCalledTimes(2)
  })

  it('keeps ticking after a failure and warns once per five minutes', async () => {
    const relay = vi.fn(async () => { throw new Error('database is down') })
    stop = startOrchestratorAuditRelay({ relay, intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(5000)

    expect(relay).toHaveBeenCalledTimes(5)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[syslog] orchestrator audit relay failed:', 'database is down')
  })

  it('stops, and a later start creates a fresh relay', async () => {
    const first = vi.fn(async () => 0)
    stop = startOrchestratorAuditRelay({ relay: first, intervalMs: 100 })
    stop()
    stop()

    const second = vi.fn(async () => 0)
    stop = startOrchestratorAuditRelay({ relay: second, intervalMs: 100 })
    await vi.advanceTimersByTimeAsync(150)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
