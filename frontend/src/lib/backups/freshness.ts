// Fleet-wide backup freshness per guest (#254, spec D12). No existing
// aggregate answers "which guests have not been backed up in 48h":
// fetchAllPbsBackups is per PBS server and guests/[vmid]/backups is per guest.
// Built ONCE here and projected twice: JSON by /api/v1/public/backups and the
// proxcenter_backup_age_seconds series by /api/v1/public/metrics.
import { prisma } from "@/lib/db/prisma"
import { getPbsConnectionByIdUnscoped } from "@/lib/connections/getConnection"

import { getAllBackups, type CachedBackup } from "./pbsSnapshots"

export type GuestBackupFreshness = {
  connId: string
  connectionName: string
  vmid: string
  backupType: string
  latestBackupTime: number | null
  latestBackupIso: string | null
  ageSeconds: number | null
  datastore: string | null
  namespace: string | null
  pbsConnectionId: string | null
  pbsConnectionName: string | null
  sizeBytes: number | null
  verified: boolean | null
  warnings: string[]
}

export type FleetBackupFreshness = {
  guests: GuestBackupFreshness[]
  warnings: string[]
}

/** PBS backup-type for a PVE guest type. */
export function pbsBackupType(guestType: string): string {
  return guestType === "lxc" ? "ct" : "vm"
}

/** PURE: index snapshots by backupType/backupId, keeping the most recent point. */
export function latestPerGuest(snapshots: CachedBackup[]): Map<string, CachedBackup> {
  const latest = new Map<string, CachedBackup>()
  for (const snapshot of snapshots) {
    const key = `${snapshot.backupType}/${snapshot.backupId}`
    const current = latest.get(key)
    if (!current || snapshot.backupTime > current.backupTime) latest.set(key, snapshot)
  }
  return latest
}

export async function buildFleetBackupFreshness(opts: {
  tenantId: string
  visibleConnectionIds: Set<string>
  guests: Array<{ connId: string; connectionName: string; vmid: string; type: string }>
  nowMs?: number
}): Promise<FleetBackupFreshness> {
  const nowMs = opts.nowMs ?? Date.now()
  const warnings: string[] = []

  const pbsConnections = (await prisma.connection.findMany({
    where: { type: "pbs" },
    select: { id: true, name: true },
  })).filter(conn => opts.visibleConnectionIds.has(conn.id))

  // best = the most recent point across every visible PBS server.
  const best = new Map<string, { snapshot: CachedBackup; pbsId: string; pbsName: string }>()

  for (const pbs of pbsConnections) {
    try {
      const conn = await getPbsConnectionByIdUnscoped(pbs.id)
      const result = await getAllBackups(pbs.id, conn, opts.tenantId)
      for (const warning of result.warnings) warnings.push(`[${pbs.name}] ${warning}`)
      for (const [key, snapshot] of latestPerGuest(result.data)) {
        const current = best.get(key)
        if (!current || snapshot.backupTime > current.snapshot.backupTime) {
          best.set(key, { snapshot, pbsId: pbs.id, pbsName: pbs.name })
        }
      }
    } catch (e: any) {
      warnings.push(`[${pbs.name}] ${e?.message || String(e)}`)
    }
  }

  const guests = opts.guests.map<GuestBackupFreshness>(guest => {
    const backupType = pbsBackupType(guest.type)
    const hit = best.get(`${backupType}/${guest.vmid}`)
    if (!hit) {
      // Never-backed-up guests MUST be present with a null age, otherwise the
      // question "who is not backed up" has no answer (spec section 8).
      return {
        connId: guest.connId,
        connectionName: guest.connectionName,
        vmid: guest.vmid,
        backupType,
        latestBackupTime: null,
        latestBackupIso: null,
        ageSeconds: null,
        datastore: null,
        namespace: null,
        pbsConnectionId: null,
        pbsConnectionName: null,
        sizeBytes: null,
        verified: null,
        warnings: [],
      }
    }
    return {
      connId: guest.connId,
      connectionName: guest.connectionName,
      vmid: guest.vmid,
      backupType,
      latestBackupTime: hit.snapshot.backupTime,
      latestBackupIso: hit.snapshot.backupTimeIso || new Date(hit.snapshot.backupTime * 1000).toISOString(),
      ageSeconds: Math.max(0, Math.floor(nowMs / 1000 - hit.snapshot.backupTime)),
      datastore: hit.snapshot.datastore,
      namespace: hit.snapshot.namespace,
      pbsConnectionId: hit.pbsId,
      pbsConnectionName: hit.pbsName,
      sizeBytes: hit.snapshot.size,
      verified: hit.snapshot.verified,
      warnings: [],
    }
  })

  return { guests, warnings }
}
