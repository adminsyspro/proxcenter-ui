/**
 * GPU chargeback sampler (#672): at every pass, adds the time elapsed since
 * the previous one to the hour row of each GPU a VM holds, as running time
 * when the VM is started and as reserved time otherwise.
 *
 * Load on Proxmox: none of its own. A pass reads each connection through
 * getConnectionGpus, the cached collection of the GPU page (60 s per
 * connection: one /cluster/resources and the configs of the guests of GPU
 * nodes only). At the default five minutes, a cluster with no GPU costs one
 * /nodes and one PCI list per node every five minutes.
 *
 * One process samples, the holder of the `gpu-usage-sampler` lease (HA
 * replicas or several dev servers would each count the same minutes). The
 * time of the last pass is kept in the settings table, so a new holder
 * resumes from it; the credit is capped at two intervals so an outage of the
 * sampler is never billed blindly.
 *
 * Timer discipline as in lib/vdc/usageHistory/sampler.ts.
 */
import { randomUUID } from 'node:crypto'
import os from 'node:os'

import { prisma } from '@/lib/db/prisma'
import { releaseLease, tryAcquireLease } from '@/lib/scheduler/lease'

import type { ConnectionGpuSnapshot } from '../collect'
import { modelKey } from '../fleet'

import { loadGpuBillingSettings, loadLastPass, saveLastPass, type GpuBillingSettings } from './settings'

export const GPU_USAGE_SAMPLER_LEASE = 'gpu-usage-sampler'
export const GPU_USAGE_SAMPLER_TICK_MS = 60_000
export const GPU_USAGE_SAMPLER_INITIAL_DELAY_MS = 30_000
export const GPU_USAGE_SAMPLER_LEASE_TTL_MS = 3 * 60_000
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export type SamplerConnection = { id: string; name: string; tenantId: string | null }
export type SamplerVdc = { id: string; name: string; connectionId: string; pvePoolName: string; tenantId: string; tenantName: string }

export type UsageIncrement = {
  hour: Date
  connectionId: string
  connectionName: string
  node: string
  vmid: number
  vmName: string
  deviceKey: string
  modelKey: string
  modelName: string
  mdev: string | null
  pool: string | null
  vdcId: string | null
  vdcName: string | null
  tenantId: string | null
  tenantName: string | null
  runningSeconds: number
  reservedSeconds: number
}

export interface GpuUsageSamplerDeps {
  /** The licence carries gpu_management: without it nothing is read, no PVE call is spent. */
  licensed: () => Promise<boolean>
  acquireLease: () => Promise<boolean>
  loadSettings: () => Promise<GpuBillingSettings>
  loadLastPass: () => Promise<Date | null>
  saveLastPass: (at: Date) => Promise<void>
  listConnections: () => Promise<SamplerConnection[]>
  listVdcs: () => Promise<SamplerVdc[]>
  listTenantNames: () => Promise<Map<string, string>>
  readConnection: (conn: SamplerConnection) => Promise<ConnectionGpuSnapshot>
  addUsage: (rows: UsageIncrement[]) => Promise<void>
  purge: (before: Date) => Promise<number>
  now: () => Date
}

export type GpuUsageSamplerReport = { leader: boolean; enabled: boolean; due: boolean; credited: number; rows: number; failed: number; purged: number }

/** The usage rows one connection adds for `seconds` of time. */
export function usageIncrements(
  snap: ConnectionGpuSnapshot,
  conn: SamplerConnection,
  vdcs: SamplerVdc[],
  tenantNames: Map<string, string>,
  hour: Date,
  seconds: number,
): UsageIncrement[] {
  const devices = new Map(snap.devices.map(d => [d.key, d]))
  const vdcOf = new Map(vdcs.filter(v => v.connectionId === conn.id).map(v => [v.pvePoolName, v]))
  const out: UsageIncrement[] = []
  for (const a of snap.allocations) {
    if (a.template) continue
    const d = devices.get(a.deviceKey)
    if (!d || d.kind !== 'gpu') continue
    const vdc = a.pool ? vdcOf.get(a.pool) : undefined
    const tenantId = vdc?.tenantId ?? conn.tenantId
    const running = a.vmStatus === 'running'
    out.push({
      hour,
      connectionId: conn.id,
      connectionName: conn.name,
      node: a.node,
      vmid: Number(a.vmid),
      vmName: a.vmName,
      deviceKey: a.deviceKey,
      modelKey: modelKey(d),
      modelName: d.deviceName || [d.vendorName, d.deviceId].filter(Boolean).join(' ') || '?',
      mdev: a.mdev,
      pool: a.pool,
      vdcId: vdc?.id ?? null,
      vdcName: vdc?.name ?? null,
      tenantId: tenantId ?? null,
      tenantName: vdc?.tenantName ?? (tenantId ? tenantNames.get(tenantId) ?? tenantId : null),
      runningSeconds: running ? seconds : 0,
      reservedSeconds: running ? 0 : seconds,
    })
  }
  return out
}

export async function runGpuUsagePass(deps: GpuUsageSamplerDeps): Promise<GpuUsageSamplerReport> {
  const report: GpuUsageSamplerReport = { leader: false, enabled: false, due: false, credited: 0, rows: 0, failed: 0, purged: 0 }
  if (!(await deps.licensed())) return report
  if (!(await deps.acquireLease())) return report
  report.leader = true

  const settings = await deps.loadSettings()
  report.enabled = settings.enabled
  const now = deps.now()
  // Retention applies even with sampling switched off: it bounds what is kept.
  report.purged = await deps.purge(new Date(now.getTime() - settings.retentionDays * DAY_MS))
  if (!settings.enabled) return report

  const intervalS = settings.intervalMinutes * 60
  const last = await deps.loadLastPass()
  // Half a tick of slack: a pass landing a few seconds early still counts.
  if (last && (now.getTime() - last.getTime()) / 1000 < intervalS - GPU_USAGE_SAMPLER_TICK_MS / 2000) return report
  report.due = true
  const elapsed = last ? Math.round((now.getTime() - last.getTime()) / 1000) : intervalS
  const seconds = Math.max(0, Math.min(elapsed, 2 * intervalS))
  report.credited = seconds

  const [connections, vdcs, tenantNames] = await Promise.all([deps.listConnections(), deps.listVdcs(), deps.listTenantNames()])
  const hour = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS)
  const readOne = async (conn: SamplerConnection): Promise<UsageIncrement[]> => {
    try {
      const snap = await deps.readConnection(conn)
      if (snap.error) throw new Error(snap.error)
      return usageIncrements(snap, conn, vdcs, tenantNames, hour, seconds)
    } catch (e: any) {
      // An unreachable cluster leaves a gap, never a guess.
      report.failed++
      console.warn(`[gpu-usage-sampler] connection ${conn.id} not sampled: ${e?.message || e}`)
      return []
    }
  }
  // One cluster after the other, never all at once: the sampler is background load.
  const readFrom = async (i: number, acc: UsageIncrement[]): Promise<UsageIncrement[]> =>
    i >= connections.length ? acc : readFrom(i + 1, [...acc, ...(await readOne(connections[i]))])
  const rows = await readFrom(0, [])
  if (seconds > 0 && rows.length) await deps.addUsage(rows)
  report.rows = rows.length
  await deps.saveLastPass(now)
  return report
}

// ---- default dependencies -------------------------------------------------------

async function defaultReadConnection(conn: SamplerConnection): Promise<ConnectionGpuSnapshot> {
  // Imported on use: the tenant and connection graph has no business at boot.
  const [{ runWithBackgroundTenant }, { getConnectionById }, { getConnectionGpus }] = await Promise.all([
    import('@/lib/tenant/background'),
    import('@/lib/connections/getConnection'),
    import('../collect'),
  ])
  // No request scope here: headers() would throw (reference_background_job_no_request_scope).
  return runWithBackgroundTenant(conn.tenantId || 'default', async () => {
    const connData = await getConnectionById(conn.id, conn.tenantId || undefined)
    return getConnectionGpus(connData, { id: conn.id, name: conn.name })
  })
}

async function defaultAddUsage(rows: UsageIncrement[]): Promise<void> {
  // One transaction: a pass is credited whole or not at all.
  await prisma.$transaction(rows.map(r => {
    const { runningSeconds, reservedSeconds, ...identity } = r
    return prisma.gpuUsageHour.upsert({
      where: { hour_connectionId_vmid_deviceKey: { hour: r.hour, connectionId: r.connectionId, vmid: r.vmid, deviceKey: r.deviceKey } },
      create: { ...identity, runningSeconds, reservedSeconds },
      update: {
        // Names and owner as they are now: a renamed VM is invoiced under its current name.
        vmName: r.vmName,
        pool: r.pool,
        vdcId: r.vdcId,
        vdcName: r.vdcName,
        tenantId: r.tenantId,
        tenantName: r.tenantName,
        runningSeconds: { increment: runningSeconds },
        reservedSeconds: { increment: reservedSeconds },
      },
    })
  }))
}

export function defaultGpuUsageDeps(holder: string, leaseTtlMs: number): GpuUsageSamplerDeps {
  return {
    licensed: async () => {
      const [{ hasServerFeature }, { Features }] = await Promise.all([import('@/lib/auth/requireEnterprise'), import('@/lib/license/features')])
      return hasServerFeature(Features.GPU_MANAGEMENT)
    },
    acquireLease: () => tryAcquireLease(GPU_USAGE_SAMPLER_LEASE, holder, leaseTtlMs),
    loadSettings: loadGpuBillingSettings,
    loadLastPass,
    saveLastPass,
    listConnections: () => prisma.connection.findMany({ where: { type: 'pve' }, select: { id: true, name: true, tenantId: true } }),
    listVdcs: async () =>
      (await prisma.vdc.findMany({ select: { id: true, name: true, connectionId: true, pvePoolName: true, tenantId: true, tenant: { select: { name: true } } } })).map(v => ({
        id: v.id,
        name: v.name,
        connectionId: v.connectionId,
        pvePoolName: v.pvePoolName,
        tenantId: v.tenantId,
        tenantName: v.tenant?.name ?? v.tenantId,
      })),
    listTenantNames: async () => new Map((await prisma.tenant.findMany({ select: { id: true, name: true } })).map(t => [t.id, t.name])),
    readConnection: defaultReadConnection,
    addUsage: defaultAddUsage,
    purge: async before => (await prisma.gpuUsageHour.deleteMany({ where: { hour: { lt: before } } })).count,
    now: () => new Date(),
  }
}

function unref(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) {
  if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
}

/** Start the sampler: a first pass after a delay, then one per tick. Returns stop(). */
export function startGpuUsageSampler(options: { tickMs?: number; initialDelayMs?: number; deps?: Partial<GpuUsageSamplerDeps> } = {}): () => void {
  const holder = `${process.env.PROXCENTER_INSTANCE_ID || os.hostname()}#${process.pid}#${randomUUID().slice(0, 8)}`
  const deps = { ...defaultGpuUsageDeps(holder, GPU_USAGE_SAMPLER_LEASE_TTL_MS), ...options.deps }
  let stopped = false
  let inFlight = false
  let wasLeader = false
  let interval: ReturnType<typeof setInterval> | null = null

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true
    try {
      const r = await runGpuUsagePass(deps)
      wasLeader = r.leader
    } catch (e) {
      console.error('[gpu-usage-sampler] pass failed:', e)
    } finally {
      inFlight = false
    }
  }

  const first = setTimeout(() => {
    void tick()
    interval = setInterval(() => void tick(), options.tickMs ?? GPU_USAGE_SAMPLER_TICK_MS)
    unref(interval)
  }, options.initialDelayMs ?? GPU_USAGE_SAMPLER_INITIAL_DELAY_MS)
  unref(first)

  return () => {
    if (stopped) return
    stopped = true
    clearTimeout(first)
    if (interval) clearInterval(interval)
    if (wasLeader) void releaseLease(GPU_USAGE_SAMPLER_LEASE, holder).catch(() => {})
  }
}
