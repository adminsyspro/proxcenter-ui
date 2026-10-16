/**
 * Postgres-backed tests of the vDC usage sampler (#902): which vDCs are due,
 * the history row it writes, the batched retention purge, the lease that
 * keeps a second process from writing the same period, and the pass that
 * ties them together. refreshVdcUsage is injected: its own tests cover the
 * measurement; here it only has to return a reading.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../../__tests__/setup/prisma-test'
import { releaseLease, tryAcquireLease } from '@/lib/scheduler/lease'
import type { VdcUsage } from '@/lib/vdc/types'

import {
  findDueVdcIds,
  loadVdcSampleIdentity,
  purgeVdcUsageHistory,
  recordVdcUsageSample,
  runVdcUsageSamplerPass,
  startVdcUsageSampler,
  VDC_USAGE_PURGE_BATCH_SIZE,
} from './sampler'
import { DEFAULT_VDC_USAGE_HISTORY_SETTINGS, loadVdcUsageHistorySettings, parseVdcUsageHistorySettings, saveVdcUsageHistorySettings } from './settings'

const TABLES = ['vdc_usage_history', 'scheduler_leases', 'settings', 'vdcs', 'provider_connections', 'Connection', 'tenants']
const NOW = new Date('2026-10-14T12:00:00.000Z')
const MIN = 60_000

function usage(storageMb: number, at = NOW): VdcUsage {
  return {
    usedVcpus: 4,
    usedRamMb: 4096,
    usedStorageMb: storageMb,
    usedVms: 2,
    usedSnapshots: 1,
    usedBackups: 3,
    usedStorageByStorage: { ceph: storageMb },
    lastSyncedAt: at.toISOString(),
  }
}

function ident(vdcId: string) {
  return { id: vdcId, name: vdcId, tenantId: 'tenant-1', tenantName: 'Test', connectionId: 'conn1', pvePoolName: `pool-${vdcId}` }
}

async function sample(vdcId: string, at: Date, storageMb = 1) {
  await recordVdcUsageSample(ident(vdcId), usage(storageMb, at), at)
}

beforeEach(async () => {
  await truncate(TABLES)
  const now = new Date()

  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  for (const id of ['conn1', 'conn2']) {
    await prismaTest.$transaction(async (tx) => {
      await tx.connection.create({
        data: { id, tenantId: 'default', name: id, baseUrl: `https://${id}`, apiTokenEnc: 'enc' },
      })
      await tx.providerConnection.create({ data: { connectionId: id } })
    })
  }
  for (const [id, conn] of [['vdc-a', 'conn1'], ['vdc-b', 'conn2']]) {
    await prismaTest.vdc.create({
      data: { id, tenantId: 'tenant-1', connectionId: conn, name: id, slug: id, pvePoolName: `pool-${id}` },
    })
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('settings', () => {
  it('defaults to a 15 minute cadence and 400 days, and survives a corrupt row', async () => {
    expect(DEFAULT_VDC_USAGE_HISTORY_SETTINGS).toEqual({ enabled: true, intervalMinutes: 15, retentionDays: 400 })
    expect(parseVdcUsageHistorySettings({ intervalMinutes: 0 })).toEqual(DEFAULT_VDC_USAGE_HISTORY_SETTINGS)
    expect(await loadVdcUsageHistorySettings()).toEqual(DEFAULT_VDC_USAGE_HISTORY_SETTINGS)

    await saveVdcUsageHistorySettings({ enabled: false, intervalMinutes: 1, retentionDays: 7 })
    expect(await loadVdcUsageHistorySettings()).toEqual({ enabled: false, intervalMinutes: 1, retentionDays: 7 })
  })
})

describe('recordVdcUsageSample', () => {
  it('writes the counters and the per storage detail, stamped with the cache time', async () => {
    const at = new Date('2026-10-14T11:59:30.000Z')

    await recordVdcUsageSample(ident('vdc-a'), usage(5000, at), NOW)
    const rows = await prismaTest.vdcUsageSample.findMany()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      vdcId: 'vdc-a',
      usedVcpus: 4,
      usedRamMb: 4096,
      usedStorageMb: 5000,
      usedVms: 2,
      usedSnapshots: 1,
      usedBackups: 3,
      usedStorageByStorage: { ceph: 5000 },
      vdcName: 'vdc-a',
      tenantId: 'tenant-1',
      tenantName: 'Test',
      connectionId: 'conn1',
      pvePoolName: 'pool-vdc-a',
    })
    expect(rows[0].sampledAt.toISOString()).toBe(at.toISOString())
  })

  it('stores no storage detail when there is none', async () => {
    await recordVdcUsageSample(ident('vdc-a'), { ...usage(1), usedStorageByStorage: {}, lastSyncedAt: null }, NOW)
    const [row] = await prismaTest.vdcUsageSample.findMany()

    expect(row.usedStorageByStorage).toBeNull()
    expect(row.sampledAt.toISOString()).toBe(NOW.toISOString())
  })
})

describe('history of a deleted vDC', () => {
  it('is kept when the vDC is deleted, under the identity it was sampled with', async () => {
    expect(await loadVdcSampleIdentity('vdc-a')).toEqual({ ...ident('vdc-a'), name: 'vdc-a' })
    await sample('vdc-a', new Date(NOW.getTime() - MIN))
    await prismaTest.vdc.delete({ where: { id: 'vdc-a' } })

    expect(await loadVdcSampleIdentity('vdc-a')).toBeNull()
    expect(await prismaTest.vdcUsageSample.findMany({ select: { vdcId: true, vdcName: true, tenantName: true } })).toEqual([
      { vdcId: 'vdc-a', vdcName: 'vdc-a', tenantName: 'Test' },
    ])
    // A deleted vDC is never due again.
    expect(await findDueVdcIds(1, NOW)).toEqual(['vdc-b'])
  })

  it('is purged by the retention like any other sample', async () => {
    await sample('vdc-a', new Date(NOW.getTime() - 10 * 24 * 60 * MIN))
    await sample('vdc-a', new Date(NOW.getTime() - MIN))
    await prismaTest.vdc.delete({ where: { id: 'vdc-a' } })

    expect(await purgeVdcUsageHistory(5, NOW)).toBe(1)
    expect(await prismaTest.vdcUsageSample.count({ where: { vdcId: 'vdc-a' } })).toBe(1)
  })
})

describe('findDueVdcIds', () => {
  it('lists the vDCs never sampled and those whose last sample is a cadence old', async () => {
    await sample('vdc-a', new Date(NOW.getTime() - 20 * MIN))
    await sample('vdc-a', new Date(NOW.getTime() - 5 * MIN))

    expect(await findDueVdcIds(15, NOW)).toEqual(['vdc-b'])
    expect(await findDueVdcIds(5, NOW)).toEqual(['vdc-a', 'vdc-b'])
  })

  it('absorbs half a tick of jitter on a one minute cadence', async () => {
    await sample('vdc-a', new Date(NOW.getTime() - 40_000))
    await sample('vdc-b', new Date(NOW.getTime() - 20_000))

    expect(await findDueVdcIds(1, NOW)).toEqual(['vdc-a'])
  })
})

describe('purgeVdcUsageHistory', () => {
  it('deletes only the samples past the retention', async () => {
    await sample('vdc-a', new Date(NOW.getTime() - 10 * 24 * 60 * MIN))
    await sample('vdc-a', new Date(NOW.getTime() - 3 * 24 * 60 * MIN))
    await sample('vdc-b', new Date(NOW.getTime() - MIN))

    expect(await purgeVdcUsageHistory(5, NOW)).toBe(1)
    expect(await prismaTest.vdcUsageSample.count()).toBe(2)
  })

  it('goes through more rows than one batch holds', async () => {
    const old = new Date(NOW.getTime() - 30 * 24 * 60 * MIN)
    const total = VDC_USAGE_PURGE_BATCH_SIZE + 7

    await prismaTest.vdcUsageSample.createMany({
      data: Array.from({ length: total }, (_, i) => ({
        id: `old-${i}`, vdcId: 'vdc-a', vdcName: 'a', tenantId: 't', tenantName: 't', connectionId: 'c', pvePoolName: 'p', sampledAt: old,
      })),
    })
    await sample('vdc-a', NOW)

    expect(await purgeVdcUsageHistory(1, NOW)).toBe(total)
    expect(await prismaTest.vdcUsageSample.count()).toBe(1)
  })
})

describe('scheduler lease', () => {
  it('lets one holder at a time take it, renews it for the holder, and frees it on release', async () => {
    expect(await tryAcquireLease('job', 'a', 60_000)).toBe(true)
    expect(await tryAcquireLease('job', 'b', 60_000)).toBe(false)
    expect(await tryAcquireLease('job', 'a', 60_000)).toBe(true)

    await releaseLease('job', 'b') // not b's: untouched
    expect(await tryAcquireLease('job', 'b', 60_000)).toBe(false)

    await releaseLease('job', 'a')
    expect(await tryAcquireLease('job', 'b', 60_000)).toBe(true)
  })

  it('hands an expired lease over to another holder', async () => {
    expect(await tryAcquireLease('job', 'a', 60_000)).toBe(true)
    await prismaTest.schedulerLease.update({ where: { name: 'job' }, data: { expiresAt: new Date(Date.now() - 1000) } })

    expect(await tryAcquireLease('job', 'b', 60_000)).toBe(true)
    expect((await prismaTest.schedulerLease.findUnique({ where: { name: 'job' } }))?.holder).toBe('b')
  })

  it('stores its expiry in UTC, comparable with the JS clock', async () => {
    await tryAcquireLease('job', 'a', 120_000)
    const lease = await prismaTest.schedulerLease.findUnique({ where: { name: 'job' } })
    const ahead = lease!.expiresAt.getTime() - Date.now()

    expect(ahead).toBeGreaterThan(60_000)
    expect(ahead).toBeLessThanOrEqual(125_000)
  })
})

describe('runVdcUsageSamplerPass', () => {
  const settings = { enabled: true, intervalMinutes: 15, retentionDays: 30 }

  function deps(overrides: Partial<Parameters<typeof runVdcUsageSamplerPass>[0]> = {}) {
    return {
      loadSettings: async () => settings,
      refresh: vi.fn(async (_id: string) => usage(42)),
      acquireLease: vi.fn(async () => true),
      now: () => NOW,
      ...overrides,
    }
  }

  it('samples every due vDC once and purges the old samples', async () => {
    await sample('vdc-b', new Date(NOW.getTime() - 5 * MIN))
    await sample('vdc-b', new Date(NOW.getTime() - 40 * 24 * 60 * MIN))
    const d = deps()

    const report = await runVdcUsageSamplerPass(d)

    expect(report).toEqual({ leader: true, enabled: true, due: 1, sampled: 1, failed: 0, purged: 1 })
    expect(d.refresh).toHaveBeenCalledWith('vdc-a')
    expect(await prismaTest.vdcUsageSample.count({ where: { vdcId: 'vdc-a' } })).toBe(1)
    expect(await prismaTest.vdcUsageSample.count({ where: { vdcId: 'vdc-b' } })).toBe(1)
  })

  it('does nothing without the lease', async () => {
    const d = deps({ acquireLease: vi.fn(async () => false) })

    expect(await runVdcUsageSamplerPass(d)).toMatchObject({ leader: false, sampled: 0 })
    expect(d.refresh).not.toHaveBeenCalled()
    expect(await prismaTest.vdcUsageSample.count()).toBe(0)
  })

  it('stops writing as soon as the lease is lost mid-pass', async () => {
    const acquire = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false)
    const d = deps({ acquireLease: acquire })

    const report = await runVdcUsageSamplerPass(d)

    expect(report).toMatchObject({ leader: false, due: 2, sampled: 1 })
    expect(await prismaTest.vdcUsageSample.count()).toBe(1)
  })

  it('leaves a gap, not a zero, for a vDC that cannot be measured', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deps({
      refresh: vi.fn(async (id: string) => {
        if (id === 'vdc-a') throw new Error('pool unreachable')

        return usage(7)
      }),
    })

    expect(await runVdcUsageSamplerPass(d)).toMatchObject({ sampled: 1, failed: 1 })
    expect(await prismaTest.vdcUsageSample.findMany({ select: { vdcId: true } })).toEqual([{ vdcId: 'vdc-b' }])
  })

  it('writes nothing for a vDC deleted while it was measured', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deps({
      refresh: vi.fn(async (id: string) => {
        if (id === 'vdc-a') await prismaTest.vdc.delete({ where: { id } })

        return usage(7)
      }),
    })

    expect(await runVdcUsageSamplerPass(d)).toMatchObject({ sampled: 1, failed: 1 })
    expect(await prismaTest.vdcUsageSample.findMany({ select: { vdcId: true } })).toEqual([{ vdcId: 'vdc-b' }])
  })

  it('only purges when sampling is switched off', async () => {
    await sample('vdc-a', new Date(NOW.getTime() - 40 * 24 * 60 * MIN))
    const d = deps({ loadSettings: async () => ({ ...settings, enabled: false }) })

    expect(await runVdcUsageSamplerPass(d)).toMatchObject({ leader: true, enabled: false, purged: 1, due: 0 })
    expect(d.refresh).not.toHaveBeenCalled()
  })
})

describe('startVdcUsageSampler', () => {
  it('runs a first pass after the initial delay, then one per tick, until stopped', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const acquireLease = vi.fn(async () => false)
    const stop = startVdcUsageSampler({ initialDelayMs: 1000, tickMs: 5000, acquireLease, loadSettings: async () => DEFAULT_VDC_USAGE_HISTORY_SETTINGS })

    await vi.advanceTimersByTimeAsync(999)
    expect(acquireLease).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(acquireLease).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(acquireLease).toHaveBeenCalledTimes(3)

    stop()
    stop()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(acquireLease).toHaveBeenCalledTimes(3)
  })

  it('never lets a failing pass escape', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = startVdcUsageSampler({ initialDelayMs: 10, acquireLease: async () => { throw new Error('db down') } })

    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('[vdc-usage-sampler] pass failed:', 'db down'))
    stop()
  })

  it('logs when this process becomes the sampler', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stop = startVdcUsageSampler({
      initialDelayMs: 10,
      holder: 'me',
      acquireLease: async () => true,
      loadSettings: async () => ({ ...DEFAULT_VDC_USAGE_HISTORY_SETTINGS, enabled: false }),
    })

    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('[vdc-usage-sampler] sampling from this process (me)'))
    stop()
  })
})
