/**
 * Scheduled sampling of vDC usage (#902).
 *
 * The usage of a vDC used to be measured only when somebody read it: a vDC
 * nobody opened had no measurement at all, and each reading overwrote the one
 * before. This sampler measures every vDC at the cadence set in the vDC
 * settings, whether or not anybody looks, and keeps each measurement as a row
 * of `vdc_usage_history` next to the refreshed cache row.
 *
 * It lives in the frontend because the measurement does: refreshVdcUsage
 * walks the PVE pool, the guest configs and the PBS namespaces with the
 * connection credentials the frontend holds.
 *
 * One process samples. Every frontend starts the timer, but a pass runs only
 * in the holder of the `vdc-usage-sampler` lease (lib/scheduler/lease.ts):
 * HA replicas, or several dev servers on one database, would otherwise each
 * write their own row for the same period. The lease is renewed before each
 * vDC, so a holder that stalls longer than the lease stops writing as soon as
 * another process has taken over.
 *
 * The history of a deleted vDC is kept (no foreign key) until the retention
 * purges it, so the last month of a vDC can still be invoiced and audited.
 *
 * Which vDCs are due is read from the history itself (the last sample of
 * each vDC), not from memory: a new leader resumes the cadence where the
 * previous one left it, and a cadence change applies at the next tick.
 *
 * Timer discipline copied from sessionSweeper.ts: an in-flight guard so a slow
 * pass cannot overlap the next tick, unref() so the timers never keep the
 * process alive by themselves, and an error path that can never throw.
 */
import { randomUUID } from 'node:crypto'
import os from 'node:os'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/prisma'
import { releaseLease, tryAcquireLease } from '@/lib/scheduler/lease'
import type { VdcUsage } from '@/lib/vdc/types'

import { loadVdcUsageHistorySettings, type VdcUsageHistorySettings } from './settings'

export const VDC_USAGE_SAMPLER_LEASE = 'vdc-usage-sampler'
export const VDC_USAGE_SAMPLER_TICK_MS = 60_000
export const VDC_USAGE_SAMPLER_INITIAL_DELAY_MS = 20_000
export const VDC_USAGE_SAMPLER_LEASE_TTL_MS = 3 * 60_000
export const VDC_USAGE_PURGE_BATCH_SIZE = 5000
const VDC_USAGE_PURGE_MAX_BATCHES = 50
const DAY_MS = 24 * 60 * 60 * 1000

export interface VdcUsageSamplerReport {
  leader: boolean
  enabled: boolean
  due: number
  sampled: number
  failed: number
  purged: number
}

export interface VdcUsageSamplerDeps {
  loadSettings?: () => Promise<VdcUsageHistorySettings>
  /** Refresh the cache row of one vDC and return what it holds now. */
  refresh?: (vdcId: string) => Promise<VdcUsage>
  /** Take or renew the lease; false = another process samples. */
  acquireLease?: () => Promise<boolean>
  now?: () => Date
}

async function defaultRefresh(vdcId: string): Promise<VdcUsage> {
  // Imported on use: lib/vdc pulls the whole tenant/RBAC graph, which the
  // instrumentation hook has no reason to load at boot.
  const { refreshVdcUsage } = await import('@/lib/vdc')

  return refreshVdcUsage(vdcId, { strict: true })
}

/**
 * The vDCs whose last sample is at least one cadence old (or that have none):
 * every vDC minus those sampled inside the window. Only the window's rows are
 * read, through the sampled_at index, whatever the size of the history.
 * The tick is one minute, so a sample landing a few seconds after the minute
 * would push a 1-minute cadence to 2: half a tick of slack absorbs that.
 */
export async function findDueVdcIds(intervalMinutes: number, now: Date): Promise<string[]> {
  const intervalMs = intervalMinutes * 60_000
  const slackMs = Math.min(VDC_USAGE_SAMPLER_TICK_MS / 2, intervalMs / 2)
  const windowStart = new Date(now.getTime() - (intervalMs - slackMs))

  const [vdcs, recent] = await Promise.all([
    prisma.vdc.findMany({ select: { id: true }, orderBy: { id: 'asc' } }),
    prisma.vdcUsageSample.findMany({
      where: { sampledAt: { gt: windowStart } },
      select: { vdcId: true },
      distinct: ['vdcId'],
    }),
  ])
  const fresh = new Set(recent.map(r => r.vdcId))

  return vdcs.map(v => v.id).filter(id => !fresh.has(id))
}

/** What identifies a vDC on its history rows, kept after the vDC is deleted. */
export interface VdcSampleIdentity {
  id: string
  name: string
  tenantId: string
  tenantName: string
  connectionId: string
  pvePoolName: string
}

/** The identity of a live vDC, or null once it is deleted. */
export async function loadVdcSampleIdentity(vdcId: string): Promise<VdcSampleIdentity | null> {
  const vdc = await prisma.vdc.findUnique({
    where: { id: vdcId },
    select: { id: true, name: true, tenantId: true, connectionId: true, pvePoolName: true, tenant: { select: { name: true } } },
  })

  if (!vdc) return null

  return {
    id: vdc.id,
    name: vdc.name,
    tenantId: vdc.tenantId,
    tenantName: vdc.tenant?.name ?? vdc.tenantId,
    connectionId: vdc.connectionId,
    pvePoolName: vdc.pvePoolName,
  }
}

/** Write one history row from a usage reading, stamped with the cache row's own time. */
export async function recordVdcUsageSample(vdc: VdcSampleIdentity, usage: VdcUsage, now: Date): Promise<void> {
  const byStorage = usage.usedStorageByStorage

  await prisma.vdcUsageSample.create({
    data: {
      id: randomUUID(),
      vdcId: vdc.id,
      vdcName: vdc.name,
      tenantId: vdc.tenantId,
      tenantName: vdc.tenantName,
      connectionId: vdc.connectionId,
      pvePoolName: vdc.pvePoolName,
      sampledAt: usage.lastSyncedAt ? new Date(usage.lastSyncedAt) : now,
      usedVcpus: usage.usedVcpus,
      usedRamMb: usage.usedRamMb,
      usedStorageMb: usage.usedStorageMb,
      usedVms: usage.usedVms,
      usedSnapshots: usage.usedSnapshots,
      usedBackups: usage.usedBackups,
      usedStorageByStorage: byStorage && Object.keys(byStorage).length > 0 ? byStorage : Prisma.DbNull,
    },
  })
}

/**
 * Delete the samples older than the retention, deleted vDCs included, in
 * batches so a first purge after a retention cut (a year of rows) never holds
 * one huge transaction.
 * Bounded per pass; whatever remains goes at the next tick.
 */
export async function purgeVdcUsageHistory(retentionDays: number, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
  let total = 0

  for (let i = 0; i < VDC_USAGE_PURGE_MAX_BATCHES; i++) {
    const batch = await prisma.vdcUsageSample.findMany({
      where: { sampledAt: { lt: cutoff } },
      select: { id: true },
      take: VDC_USAGE_PURGE_BATCH_SIZE,
    })

    if (batch.length === 0) break
    const { count } = await prisma.vdcUsageSample.deleteMany({ where: { id: { in: batch.map(r => r.id) } } })

    total += count
    if (batch.length < VDC_USAGE_PURGE_BATCH_SIZE) break
  }

  return total
}

/** One sampler pass: purge, then sample every due vDC, in the lease holder only. */
export async function runVdcUsageSamplerPass(deps: Required<VdcUsageSamplerDeps>): Promise<VdcUsageSamplerReport> {
  const report: VdcUsageSamplerReport = { leader: false, enabled: false, due: 0, sampled: 0, failed: 0, purged: 0 }

  if (!(await deps.acquireLease())) return report
  report.leader = true

  const settings = await deps.loadSettings()

  report.enabled = settings.enabled

  // Retention applies even with sampling switched off: it bounds what is kept.
  report.purged = await purgeVdcUsageHistory(settings.retentionDays, deps.now())

  if (!settings.enabled) return report

  const due = await findDueVdcIds(settings.intervalMinutes, deps.now())

  report.due = due.length

  for (const vdcId of due) {
    // A pass slower than the lease must stop as soon as another process
    // could have taken over, or both would write the same period.
    if (!(await deps.acquireLease())) {
      report.leader = false
      break
    }

    try {
      const usage = await deps.refresh(vdcId)
      // Read after the measurement: a vDC deleted meanwhile has no row to write.
      const identity = await loadVdcSampleIdentity(vdcId)

      if (!identity) throw new Error('deleted during the pass')
      await recordVdcUsageSample(identity, usage, deps.now())
      report.sampled++
    } catch (e: any) {
      // Unreachable cluster, vDC deleted mid-pass: a gap, retried next tick.
      report.failed++
      console.warn(`[vdc-usage-sampler] vDC ${vdcId} not sampled: ${e?.message || e}`)
    }
  }

  return report
}

export interface VdcUsageSamplerOptions extends VdcUsageSamplerDeps {
  tickMs?: number
  initialDelayMs?: number
  holder?: string
  leaseTtlMs?: number
}

function unref(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) {
  if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
}

/**
 * Start the sampler: a first pass after `initialDelayMs`, then one per tick.
 * The cadence of each vDC comes from the settings, read at every pass.
 *
 * @returns A stop() function, safe to call multiple times.
 */
export function startVdcUsageSampler(options: VdcUsageSamplerOptions = {}): () => void {
  const holder = options.holder ?? `${process.env.PROXCENTER_INSTANCE_ID || os.hostname()}#${process.pid}#${randomUUID().slice(0, 8)}`
  const leaseTtlMs = options.leaseTtlMs ?? VDC_USAGE_SAMPLER_LEASE_TTL_MS
  const deps: Required<VdcUsageSamplerDeps> = {
    loadSettings: options.loadSettings ?? loadVdcUsageHistorySettings,
    refresh: options.refresh ?? defaultRefresh,
    acquireLease: options.acquireLease ?? (() => tryAcquireLease(VDC_USAGE_SAMPLER_LEASE, holder, leaseTtlMs)),
    now: options.now ?? (() => new Date()),
  }
  const tickMs = options.tickMs ?? VDC_USAGE_SAMPLER_TICK_MS

  let stopped = false
  let inFlight = false
  let wasLeader = false
  let interval: ReturnType<typeof setInterval> | null = null

  const tick = () => {
    if (stopped || inFlight) return
    inFlight = true
    runVdcUsageSamplerPass(deps)
      .then(report => {
        if (report.leader !== wasLeader) {
          console.log(`[vdc-usage-sampler] ${report.leader ? 'sampling from this process' : 'another process samples'} (${holder})`)
          wasLeader = report.leader
        }
        if (report.failed > 0 || report.purged > 0) {
          console.log(`[vdc-usage-sampler] sampled ${report.sampled}/${report.due} vDCs, failed ${report.failed}, purged ${report.purged} samples`)
        }
      })
      .catch(e => {
        console.error('[vdc-usage-sampler] pass failed:', e?.message || e)
      })
      .finally(() => {
        inFlight = false
      })
  }

  const first = setTimeout(() => {
    tick()
    if (stopped) return
    interval = setInterval(tick, tickMs)
    unref(interval)
  }, options.initialDelayMs ?? VDC_USAGE_SAMPLER_INITIAL_DELAY_MS)

  unref(first)

  return () => {
    if (stopped) return
    stopped = true
    clearTimeout(first)
    if (interval) clearInterval(interval)
    if (!options.acquireLease) {
      void releaseLease(VDC_USAGE_SAMPLER_LEASE, holder).catch(() => undefined)
    }
  }
}
