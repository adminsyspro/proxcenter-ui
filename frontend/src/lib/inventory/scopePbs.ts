import { getPbsConnectionByIdUnscoped } from "@/lib/connections/getConnection"
import type { VdcScope } from "@/lib/vdc/scope"

export type PbsDatastoreData = {
  name: string
  path?: string
  comment?: string
  total: number
  used: number
  available: number
  usagePercent: number
  backupCount: number
  vmCount: number
  ctCount: number
  hostCount: number
}

export type PbsServerData = {
  id: string
  name: string
  type: 'pbs'
  status: 'online' | 'offline'
  version?: string
  uptime?: number
  datastores: PbsDatastoreData[]
  stats: {
    totalSize: number
    totalUsed: number
    datastoreCount: number
    backupCount: number
  }
}

/**
 * Restrict a PbsServerData payload to the namespaces the tenant's vDC allows.
 * Counts are recomputed from only the permitted namespaces, and the
 * datastore-wide capacity figures are zeroed: PBS has no per-namespace
 * capacity, so total/used on a namespace-shared PBS would leak other
 * tenants' consumption (mirrors the dashboard, which reports zero capacity
 * with namespace-scoped backup counts for vDC tenants).
 * Returns null if no datastores remain after filtering (caller should skip
 * the send).
 */
export async function scopePbsDataForTenant(
  data: PbsServerData,
  scope: VdcScope | null,
): Promise<PbsServerData | null> {
  if (!scope) return data
  const allowed = scope.pbsNamespacesByConnection.get(data.id)
  if (!allowed || allowed.length === 0) return null

  const { listSnapshotsInNamespace } = await import('@/lib/proxmox/pbsNamespace')
  const conn = await getPbsConnectionByIdUnscoped(data.id).catch(() => null)
  if (!conn) return null

  const byStore = new Map<string, string[]>()
  for (const { datastore, namespace } of allowed) {
    const list = byStore.get(datastore) ?? []
    list.push(namespace)
    byStore.set(datastore, list)
  }

  let vmCount = 0, ctCount = 0, hostCount = 0, backupCount = 0
  const datastores: PbsDatastoreData[] = []

  for (const ds of data.datastores) {
    const namespaces = byStore.get(ds.name)
    if (!namespaces) continue
    let dsVm = 0, dsCt = 0, dsHost = 0, dsBackup = 0
    for (const ns of namespaces) {
      try {
        const snapshots = await listSnapshotsInNamespace(conn, ds.name, ns)
        for (const s of snapshots) {
          dsBackup++
          const t = s['backup-type']
          if (t === 'vm') dsVm++
          else if (t === 'ct') dsCt++
          else if (t === 'host') dsHost++
        }
      } catch { /* ignore per-namespace failure */ }
    }
    datastores.push({
      ...ds,
      total: 0,
      used: 0,
      available: 0,
      usagePercent: 0,
      backupCount: dsBackup,
      vmCount: dsVm,
      ctCount: dsCt,
      hostCount: dsHost,
    })
    vmCount += dsVm; ctCount += dsCt; hostCount += dsHost; backupCount += dsBackup
  }

  if (datastores.length === 0) return null

  return {
    ...data,
    datastores,
    stats: {
      datastoreCount: datastores.length,
      backupCount,
      totalSize: 0,
      totalUsed: 0,
    },
  }
}
