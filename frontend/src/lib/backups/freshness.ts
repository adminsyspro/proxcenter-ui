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

/**
 * PURE: for each PBS group id (`vm/100`, `ct/300`), the distinct visible
 * connections that hold a guest with it. More than one entry means the id is
 * reused across clusters and a snapshot of that group has no single owner.
 */
export function connectionsSharingGroup(
  guests: Array<{ connId: string; connectionName: string; vmid: string; type: string }>,
): Map<string, Array<{ connId: string; connectionName: string }>> {
  const byGroup = new Map<string, Array<{ connId: string; connectionName: string }>>()
  for (const guest of guests) {
    const key = `${pbsBackupType(guest.type)}/${guest.vmid}`
    const list = byGroup.get(key) ?? []
    if (!list.some(c => c.connId === guest.connId)) list.push({ connId: guest.connId, connectionName: guest.connectionName })
    byGroup.set(key, list)
  }
  return byGroup
}

type Attributed = { snapshot: CachedBackup; pbsId: string; pbsName: string; owner: Set<string> | null }

function namespaceKey(pbsId: string, datastore: string, namespace: string | null | undefined): string {
  return `${pbsId}\u0000${datastore}\u0000${namespace ?? ""}`
}

/**
 * PVE connections that write into each vDC-bound PBS namespace: the PVE
 * storages of the binding, or the vDC's own connection when none is recorded.
 * A database read only. On failure every snapshot is treated as having no
 * provenance, which only makes attribution stricter.
 */
async function loadNamespaceOwners(pbsIds: string[], warnings: string[]): Promise<Map<string, Set<string>>> {
  const owners = new Map<string, Set<string>>()
  if (pbsIds.length === 0) return owners
  try {
    const rows = await prisma.vdcPbsNamespace.findMany({
      where: { pbsConnectionId: { in: pbsIds } },
      select: {
        pbsConnectionId: true,
        datastore: true,
        namespace: true,
        vdc: { select: { connectionId: true } },
        pveStorages: { select: { pveConnectionId: true } },
      },
    })
    for (const row of rows) {
      const writers = row.pveStorages.map(s => s.pveConnectionId)
      const set = new Set(writers.length > 0 ? writers : [row.vdc.connectionId])
      owners.set(namespaceKey(row.pbsConnectionId, row.datastore, row.namespace), set)
    }
  } catch (e: any) {
    warnings.push(`PBS namespace bindings unavailable: ${e?.message || String(e)}`)
  }
  return owners
}

/**
 * PURE: the snapshot to credit a guest with, among the latest points of its
 * group per provenance. A snapshot whose namespace is owned by the guest's
 * cluster always counts; one owned by other clusters never does. A snapshot
 * with no provenance counts only when no other visible cluster uses the same
 * group id (`shared`): otherwise it could be theirs, and `unattributed` says
 * so when that left the guest without a backup.
 */
export function pickForGuest(
  byOwner: Map<string, Attributed> | undefined,
  connId: string,
  shared: boolean,
): { hit: Attributed | undefined; unattributed: boolean } {
  let hit: Attributed | undefined
  let skipped = false
  for (const candidate of byOwner?.values() ?? []) {
    const eligible = candidate.owner ? candidate.owner.has(connId) : !shared
    if (!eligible) {
      if (!candidate.owner) skipped = true
      continue
    }
    if (!hit || candidate.snapshot.backupTime > hit.snapshot.backupTime) hit = candidate
  }
  return { hit, unattributed: !hit && skipped }
}

export async function buildFleetBackupFreshness(opts: {
  tenantId: string
  visibleConnectionIds: Set<string>
  guests: Array<{ connId: string; connectionName: string; vmid: string; type: string }>
  nowMs?: number
  /** D12: forwarded to getAllBackups so a public scrape never blocks on a
   * cold PBS cache. Omitted (default false) by every other caller. */
  nonBlocking?: boolean
}): Promise<FleetBackupFreshness> {
  const nowMs = opts.nowMs ?? Date.now()
  const warnings: string[] = []

  const pbsConnections = (await prisma.connection.findMany({
    where: { type: "pbs" },
    select: { id: true, name: true },
  })).filter(conn => opts.visibleConnectionIds.has(conn.id))

  // Provenance: a (PBS, datastore, namespace) bound to a vDC is written by the
  // PVE storages of that binding, so its snapshots belong to those clusters.
  // Anything else (root namespace, unbound namespace) has no provenance.
  const owners = await loadNamespaceOwners(pbsConnections.map(p => p.id), warnings)

  // best = the most recent point per (group, provenance) across every visible PBS server.
  const best = new Map<string, Map<string, Attributed>>()

  for (const pbs of pbsConnections) {
    try {
      const conn = await getPbsConnectionByIdUnscoped(pbs.id)
      const result = await getAllBackups(pbs.id, conn, opts.tenantId, undefined, opts.nonBlocking)
      for (const warning of result.warnings) warnings.push(`[${pbs.name}] ${warning}`)
      for (const snapshot of result.data) {
        const groupKey = `${snapshot.backupType}/${snapshot.backupId}`
        const owner = owners.get(namespaceKey(pbs.id, snapshot.datastore, snapshot.namespace)) ?? null
        const ownerKey = owner ? [...owner].sort().join(",") : ""
        const byOwner = best.get(groupKey) ?? new Map<string, Attributed>()
        const current = byOwner.get(ownerKey)
        if (!current || snapshot.backupTime > current.snapshot.backupTime) {
          byOwner.set(ownerKey, { snapshot, pbsId: pbs.id, pbsName: pbs.name, owner })
        }
        best.set(groupKey, byOwner)
      }
    } catch (e: any) {
      warnings.push(`[${pbs.name}] ${e?.message || String(e)}`)
    }
  }

  const sharing = connectionsSharingGroup(opts.guests)

  const guests = opts.guests.map<GuestBackupFreshness>(guest => {
    const backupType = pbsBackupType(guest.type)
    const groupKey = `${backupType}/${guest.vmid}`
    const others = (sharing.get(groupKey) ?? []).filter(c => c.connId !== guest.connId)
    const { hit, unattributed } = pickForGuest(best.get(groupKey), guest.connId, others.length > 0)
    const guestWarnings = unattributed
      ? [`backup group ${groupKey} is also used by ${others.map(c => c.connectionName).join(", ")}: a snapshot outside a vDC-bound PBS namespace carries no cluster provenance, so it is not attributed`]
      : []
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
        warnings: guestWarnings,
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
