/**
 * Postgres-backed tests of the audit retention sweeper: the policy switch, the
 * floor, the batched deletion, the guard for orchestrator rows the syslog relay
 * has not forwarded, the trace row, the lease, and the timers around the pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'
import { AUDIT_RETENTION_MIN_DAYS } from '@/lib/compliance/policies'
import { ORCHESTRATOR_CURSOR_KEY } from '@/lib/syslog/orchestratorRelay'

import {
  AUDIT_RETENTION_INITIAL_DELAY_MS,
  AUDIT_RETENTION_LEASE,
  AUDIT_RETENTION_SWEEP_INTERVAL_MS,
  resolveAuditRetentionDeps,
  runAuditRetentionPass,
  startAuditRetentionSweeper,
  type AuditRetentionPassDeps,
  type AuditRetentionReport,
} from './retentionSweeper'

const TABLES = ['audit_logs', 'security_policies', 'settings', 'scheduler_leases']
const NOW = new Date('2026-10-23T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS)
}

async function seedRows(rows: Array<{ id: string; daysAgo: number; source?: string }>) {
  await prismaTest.auditLog.createMany({
    data: rows.map(r => ({
      id: r.id,
      tenantId: 'default',
      timestamp: daysAgo(r.daysAgo),
      action: 'update',
      category: 'settings',
      source: r.source ?? 'app',
    })),
  })
}

/** Ids still in the table, the sweeper's own trace rows left out. */
async function remainingIds(): Promise<string[]> {
  const rows = await prismaTest.auditLog.findMany({ where: { action: { not: 'audit_purge' } }, select: { id: true }, orderBy: { id: 'asc' } })

  return rows.map(r => r.id)
}

async function setPolicy(autoCleanup: boolean, retentionDays: number) {
  await prismaTest.securityPolicy.upsert({
    where: { id: 'default' },
    create: { id: 'default', tenantId: 'default', auditAutoCleanup: autoCleanup, auditRetentionDays: retentionDays, updatedAt: NOW },
    update: { auditAutoCleanup: autoCleanup, auditRetentionDays: retentionDays },
  })
}

async function setCursor(ts: Date) {
  await prismaTest.setting.create({ data: { key: ORCHESTRATOR_CURSOR_KEY, tenantId: 'default', value: { ts: ts.toISOString(), id: '' } } })
}

const noSyslog = async () => ({ destinations: [] })

function deps(overrides: AuditRetentionPassDeps = {}, holder = 'me'): Required<AuditRetentionPassDeps> {
  return resolveAuditRetentionDeps({ loadSyslog: noSyslog, now: () => NOW, ...overrides }, holder)
}

function report(deleted: number, complete = true): AuditRetentionReport {
  return { enabled: true, leader: true, retentionDays: 30, cutoff: NOW, deleted, complete }
}

beforeEach(async () => {
  await truncate(TABLES)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('runAuditRetentionPass', () => {
  it('deletes nothing while automatic cleanup is off, and does not take the lease', async () => {
    await setPolicy(false, 30)
    await seedRows([{ id: 'old', daysAgo: 400 }])

    const result = await runAuditRetentionPass(deps())

    expect(result).toMatchObject({ enabled: false, leader: false, deleted: 0, cutoff: null, complete: true })
    expect(await remainingIds()).toEqual(['old'])
    expect(await prismaTest.schedulerLease.count()).toBe(0)
  })

  it('deletes the rows older than the retention and keeps the newer ones', async () => {
    await setPolicy(true, 90)
    await seedRows([
      { id: 'ancient', daysAgo: 400 },
      { id: 'expired', daysAgo: 91 },
      { id: 'edge', daysAgo: 89 },
      { id: 'fresh', daysAgo: 1 },
    ])

    const result = await runAuditRetentionPass(deps())

    expect(result).toMatchObject({ enabled: true, leader: true, retentionDays: 90, deleted: 2, complete: true })
    expect(result.cutoff).toEqual(daysAgo(90))
    expect(await remainingIds()).toEqual(['edge', 'fresh'])
  })

  it('leaves one audit_purge trace row with the counts, and only when rows went', async () => {
    await setPolicy(true, 30)
    await seedRows([{ id: 'fresh', daysAgo: 1 }])

    await runAuditRetentionPass(deps())
    expect(await prismaTest.auditLog.count({ where: { action: 'audit_purge' } })).toBe(0)

    await seedRows([{ id: 'old', daysAgo: 31 }])
    await runAuditRetentionPass(deps())
    const traces = await prismaTest.auditLog.findMany({ where: { action: 'audit_purge' } })

    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      tenantId: 'default',
      category: 'security',
      resourceType: 'audit_logs',
      source: 'app',
      status: 'success',
      details: { deleted: 1, cutoff: daysAgo(30).toISOString(), retentionDays: 30 },
    })
  })

  it('never purges faster than the floor, whatever the stored row says', async () => {
    await setPolicy(true, 1)
    await seedRows([{ id: 'ten-days', daysAgo: 10 }, { id: 'old', daysAgo: 31 }])

    const result = await runAuditRetentionPass(deps())

    expect(result.retentionDays).toBe(AUDIT_RETENTION_MIN_DAYS)
    expect(result.cutoff).toEqual(daysAgo(AUDIT_RETENTION_MIN_DAYS))
    expect(await remainingIds()).toEqual(['ten-days'])
  })

  it('applies the floor to an injected policy as well', async () => {
    await seedRows([{ id: 'ten-days', daysAgo: 10 }, { id: 'old', daysAgo: 31 }])

    const result = await runAuditRetentionPass(deps({ loadPolicy: async () => ({ autoCleanup: true, retentionDays: 1 }) }))

    expect(result.retentionDays).toBe(AUDIT_RETENTION_MIN_DAYS)
    expect(await remainingIds()).toEqual(['ten-days'])
  })

  it('deletes in batches, oldest first, and stops at the cap for the next pass to continue', async () => {
    await setPolicy(true, 30)
    await seedRows([1, 2, 3, 4, 5].map(n => ({ id: `old-${n}`, daysAgo: 30 + n })))

    const first = await runAuditRetentionPass(deps({ batchSize: 2, maxBatches: 2 }))

    expect(first).toMatchObject({ deleted: 4, complete: false })
    expect(await remainingIds()).toEqual(['old-1'])

    const second = await runAuditRetentionPass(deps({ batchSize: 2, maxBatches: 2 }))

    expect(second).toMatchObject({ deleted: 1, complete: true })
    expect(await remainingIds()).toEqual([])
  })

  it('keeps the orchestrator rows the syslog relay has not forwarded yet', async () => {
    await setPolicy(true, 30)
    await setCursor(daysAgo(40))
    await seedRows([
      { id: 'orch-forwarded', daysAgo: 45, source: 'orchestrator' },
      { id: 'orch-pending', daysAgo: 35, source: 'orchestrator' },
      { id: 'orch-fresh', daysAgo: 1, source: 'orchestrator' },
      { id: 'app-old', daysAgo: 35 },
    ])

    const result = await runAuditRetentionPass(deps())

    expect(result.deleted).toBe(2)
    expect(await remainingIds()).toEqual(['orch-fresh', 'orch-pending'])
  })

  it('a cursor ahead of the cutoff leaves the normal cutoff in force', async () => {
    await setPolicy(true, 30)
    await setCursor(daysAgo(1))
    await seedRows([
      { id: 'orch-old', daysAgo: 31, source: 'orchestrator' },
      { id: 'orch-new', daysAgo: 29, source: 'orchestrator' },
    ])

    await runAuditRetentionPass(deps())

    expect(await remainingIds()).toEqual(['orch-new'])
  })

  it('without a cursor, waits for the relay when a collector is enabled and purges when none is', async () => {
    await setPolicy(true, 30)
    await seedRows([{ id: 'orch-old', daysAgo: 60, source: 'orchestrator' }, { id: 'app-old', daysAgo: 60 }])

    const withCollector = await runAuditRetentionPass(deps({ loadSyslog: async () => ({ destinations: [{ enabled: false }, { enabled: true }] }) }))

    expect(withCollector.deleted).toBe(1)
    expect(await remainingIds()).toEqual(['orch-old'])

    const disabledOnly = await runAuditRetentionPass(deps({ loadSyslog: async () => ({ destinations: [{ enabled: false }] }) }))

    expect(disabledOnly.deleted).toBe(1)
    expect(await remainingIds()).toEqual([])
  })

  it('purges only in the process that holds the lease', async () => {
    await setPolicy(true, 30)
    await seedRows([{ id: 'old', daysAgo: 31 }])

    const other = await runAuditRetentionPass(deps({ acquireLease: async () => false }))

    expect(other).toMatchObject({ enabled: true, leader: false, deleted: 0, cutoff: null })
    expect(await remainingIds()).toEqual(['old'])

    expect((await runAuditRetentionPass(deps({}, 'a'))).leader).toBe(true)
    expect((await prismaTest.schedulerLease.findUnique({ where: { name: AUDIT_RETENTION_LEASE } }))?.holder).toBe('a')
    expect((await runAuditRetentionPass(deps({}, 'b'))).leader).toBe(false)
    expect(await remainingIds()).toEqual([])
  })
})

describe('startAuditRetentionSweeper', () => {
  it('runs a first pass after the initial delay, then one per interval, until stopped', async () => {
    vi.useFakeTimers()
    const pass = vi.fn(async () => report(0))
    const stop = startAuditRetentionSweeper({ initialDelayMs: 1000, intervalMs: 5000, pass, acquireLease: async () => true })

    await vi.advanceTimersByTimeAsync(999)
    expect(pass).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(pass).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(pass).toHaveBeenCalledTimes(3)

    stop()
    stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(pass).toHaveBeenCalledTimes(3)
  })

  it('defaults to a first pass after a minute, then one an hour', async () => {
    vi.useFakeTimers()
    const pass = vi.fn(async () => report(0))
    const stop = startAuditRetentionSweeper({ pass, acquireLease: async () => true })

    await vi.advanceTimersByTimeAsync(AUDIT_RETENTION_INITIAL_DELAY_MS - 1)
    expect(pass).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(pass).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(AUDIT_RETENTION_SWEEP_INTERVAL_MS)
    expect(pass).toHaveBeenCalledTimes(2)
    stop()
  })

  it('a failing pass is logged, never thrown, and does not stop the sweeper', async () => {
    vi.useFakeTimers()
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const pass = vi.fn(async () => { throw new Error('db down') })
    const stop = startAuditRetentionSweeper({ initialDelayMs: 10, intervalMs: 1000, pass, acquireLease: async () => true })

    await vi.advanceTimersByTimeAsync(2010)

    expect(pass).toHaveBeenCalledTimes(3)
    expect(error).toHaveBeenCalledWith('[audit-retention] pass failed (non-fatal):', expect.any(Error))
    stop()
  })

  it('skips a tick while the previous pass is still running', async () => {
    vi.useFakeTimers()
    let release: (r: AuditRetentionReport) => void = () => {}
    const pending = new Promise<AuditRetentionReport>(resolve => { release = resolve })
    const pass = vi.fn<() => Promise<AuditRetentionReport>>().mockReturnValueOnce(pending).mockResolvedValue(report(0))
    const stop = startAuditRetentionSweeper({ initialDelayMs: 10, intervalMs: 1000, pass, acquireLease: async () => true })

    await vi.advanceTimersByTimeAsync(3010)
    expect(pass).toHaveBeenCalledTimes(1)

    release(report(0))
    await vi.advanceTimersByTimeAsync(1000)
    expect(pass).toHaveBeenCalledTimes(2)
    stop()
  })

  it('logs only a pass that deleted rows, and says when more remain', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const pass = vi.fn<() => Promise<AuditRetentionReport>>()
      .mockResolvedValueOnce(report(0))
      .mockResolvedValueOnce(report(3, false))
      .mockResolvedValue(report(2))
    const stop = startAuditRetentionSweeper({ initialDelayMs: 10, intervalMs: 1000, pass, acquireLease: async () => true })

    await vi.advanceTimersByTimeAsync(10)
    expect(log).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(log).toHaveBeenCalledWith(`[audit-retention] purged 3 audit row(s) older than ${NOW.toISOString()} (30 days), more at the next pass`)
    await vi.advanceTimersByTimeAsync(1000)
    expect(log).toHaveBeenLastCalledWith(`[audit-retention] purged 2 audit row(s) older than ${NOW.toISOString()} (30 days)`)
    stop()
  })

  it('unrefs its timer so it cannot keep the process alive', () => {
    const unref = vi.fn()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockReturnValue({ unref } as any)

    try {
      const stop = startAuditRetentionSweeper({ pass: async () => report(0), acquireLease: async () => true })

      expect(unref).toHaveBeenCalledTimes(1)
      stop()
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  it('runs the real pass by default and gives the lease back on stop', async () => {
    await setPolicy(true, 30)
    await seedRows([{ id: 'old', daysAgo: 31 }])
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stop = startAuditRetentionSweeper({ initialDelayMs: 10, holder: 'me', loadSyslog: noSyslog, now: () => NOW })

    await vi.waitFor(async () => expect(await remainingIds()).toEqual([]), { timeout: 5000 })
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[audit-retention\] purged 1 audit row\(s\) older than /)), { timeout: 5000 })
    expect((await prismaTest.schedulerLease.findUnique({ where: { name: AUDIT_RETENTION_LEASE } }))?.holder).toBe('me')

    stop()
    await vi.waitFor(async () => expect(await prismaTest.schedulerLease.count({ where: { name: AUDIT_RETENTION_LEASE } })).toBe(0), { timeout: 5000 })
  })
})
