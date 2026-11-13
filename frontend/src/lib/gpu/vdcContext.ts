// Server-side context of the vDC GPU routes (#672): what the vDC's single
// connection reports about its GPU contingent. Who may reach it is
// vdcAccess.ts: this module reads no session, so the guest routes an API
// token may call (clone, config, create, restore) can reach it through
// vdcGuard.ts.
import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import { getConnectionGpus, type ConnectionGpuSnapshot } from './collect'
import { getGpuMetricsLatest, visibleLatest, type VisibleVgpuType } from './metrics'
import { buildGpuReport, type GpuReport } from './report'
import { listVdcGpuEntries } from './vdcEntries'
import { vdcUsage } from './vdcPending'
import { poolGpus, unresolvedVgpuModelsOf, type PoolGpu, type VdcGpuEntry } from './vdcQuota'

export type VdcRef = { id: string; tenantId: string; connectionId: string; pvePoolName: string; enabled: boolean | null }

/** The vDC's connection, with the provider's token: the tenant does not own it. */
export async function loadVdcConnection(vdc: Pick<VdcRef, 'connectionId'>): Promise<{ conn: any; row: { id: string; name: string } }> {
  const row = await prisma.connection.findFirst({
    where: { id: vdc.connectionId, type: 'pve' },
    select: { id: true, tenantId: true, name: true },
  })
  if (!row) throw new Error('vDC connection not found')
  return { conn: await getConnectionById(row.id, row.tenantId), row: { id: row.id, name: row.name } }
}

export type PoolVm = { vmid: string; name: string; status: string; node: string; tags: unknown }

/** The qemu VMs of a pool, templates left out: one PVE call. */
export async function readPoolQemu(conn: any, pool: string): Promise<PoolVm[]> {
  const data = await pveFetch<{ members?: any[] }>(conn, `/pools/${encodeURIComponent(pool)}`)
  return (data?.members ?? [])
    .filter((x) => x?.type === 'qemu' && x.vmid != null && !Number(x.template))
    .map((x) => ({ vmid: String(x.vmid), name: String(x.name ?? ''), status: String(x.status ?? ''), node: String(x.node ?? ''), tags: x.tags }))
}

export type VdcGpuContext = {
  conn: any
  /** The collection the report was built from: says what could not be read. */
  snapshot: ConnectionGpuSnapshot
  report: GpuReport
  catalog: VisibleVgpuType[]
  latest: ReturnType<typeof visibleLatest> | null
  entries: VdcGpuEntry[]
  gpus: PoolGpu[]
  usage: Map<string, number>
  /**
   * Card models of which the pool holds a vGPU (templates aside) whose profile
   * the catalog does not name this round: it counts on no line, so no vGPU
   * line of these models can be judged.
   */
  unresolvedVgpuModels: Set<string>
}

/**
 * The infrastructure GPU report of the vDC's connection, read with the
 * provider's token (the tenant does not own the connection), with the vGPU
 * catalog, the readings, the contingent and what the pool holds. A failing
 * orchestrator leaves `latest` null and the catalog empty. The usage counts
 * the GPUs clones and restores still in their PVE task are about to bring.
 */
export async function loadVdcGpuContext(vdc: VdcRef, opts: { refresh: boolean }): Promise<VdcGpuContext> {
  const { conn, row } = await loadVdcConnection(vdc)
  const snap = await getConnectionGpus(conn, { id: row.id, name: row.name }, { refresh: opts.refresh })
  const report = buildGpuReport([snap], { tenantPools: null, visibleNodes: null, visibleVms: null })

  let latest: ReturnType<typeof visibleLatest> | null = null
  try {
    latest = visibleLatest(report, await getGpuMetricsLatest())
  } catch (e: any) {
    console.warn('[vdc-gpu] orchestrator readings unavailable:', e?.message || String(e))
  }
  const catalog = latest?.vgpuTypes ?? []

  const entries = await listVdcGpuEntries(vdc.id)
  const gpus = poolGpus(report, vdc.pvePoolName, catalog)
  return {
    conn,
    snapshot: snap,
    report,
    catalog,
    latest,
    entries,
    gpus,
    usage: vdcUsage(vdc.id, entries, gpus),
    unresolvedVgpuModels: unresolvedVgpuModelsOf(gpus),
  }
}
