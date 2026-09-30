// Reads what snapshotMigrationBlockers() needs from PVE for one guest (#1027).
//
// Server-only: it goes through pveFetch. The migrate dialog reaches it through
// GET .../migrate/snapshot-check, and POST .../migrate runs it as a guard so
// the bulk and rolling-update callers get the reason instead of a task that
// dies with "check log".

import { pveFetch, type ProxmoxClientOptions } from '@/lib/proxmox/client'
import { volidOfDrive, type SnapshotConfig } from '@/lib/proxmox/snapshotRefs'
import { storageSupportsReplication } from './ccm-prereqs.types'
import {
  snapshotMigrationBlockers,
  type SnapshotMigrationBlocker,
  type StorageFacts,
} from './snapshotMigrationBlockers'

export interface SnapshotMigrationCheck {
  /** Blockers when migrating live, and when migrating offline. */
  live: SnapshotMigrationBlocker[]
  offline: SnapshotMigrationBlocker[]
}

type GuestRef = { node: string; type: 'qemu' | 'lxc'; vmid: string }

export async function checkSnapshotMigration(
  conn: ProxmoxClientOptions,
  guest: GuestRef,
  opts: { target: string; targetStorage?: string },
): Promise<SnapshotMigrationCheck> {
  const base = `/nodes/${encodeURIComponent(guest.node)}/${guest.type}/${encodeURIComponent(guest.vmid)}`

  const list = await pveFetch<Array<{ name: string }>>(conn, `${base}/snapshot`)
  const names = (Array.isArray(list) ? list : []).map(s => s?.name).filter(n => n && n !== 'current')
  if (names.length === 0) return { live: [], offline: [] }

  const [snapshots, storageList, jobs] = await Promise.all([
    Promise.all(names.map(async (name): Promise<SnapshotConfig> => ({
      name,
      config: await pveFetch<Record<string, unknown>>(conn, `${base}/snapshot/${encodeURIComponent(name)}/config`) ?? {},
    }))),
    pveFetch<Array<StorageFacts & { storage: string }>>(conn, '/storage'),
    guest.type === 'qemu' ? pveFetch<any[]>(conn, '/cluster/replication') : Promise.resolve([]),
  ])

  const storages: Record<string, StorageFacts> = {}
  for (const s of Array.isArray(storageList) ? storageList : []) {
    if (s?.storage) storages[s.storage] = s
  }

  // PVE only counts a volume as replicated when a job replicates the guest to
  // the migration target (QemuMigrate.pm, replication_jobcfg).
  const replicatedVolids = new Set<string>()
  const replicatesToTarget = (Array.isArray(jobs) ? jobs : [])
    .some(job => String(job?.guest) === String(guest.vmid) && String(job?.target) === opts.target)
  if (replicatesToTarget) {
    for (const snap of snapshots) {
      for (const value of Object.values(snap.config)) {
        if (typeof value !== 'string' || /(?:^|,)replicate=0(?:,|$)/.test(value)) continue
        const volid = volidOfDrive(value)
        const type = volid ? storages[volid.split(':')[0]]?.type : undefined
        if (volid && type && storageSupportsReplication(type)) replicatedVolids.add(volid)
      }
    }
  }

  const common = { guestType: guest.type, snapshots, storages, replicatedVolids, targetStorage: opts.targetStorage }
  return {
    live: snapshotMigrationBlockers({ ...common, live: true }),
    offline: snapshotMigrationBlockers({ ...common, live: false }),
  }
}

const REASON_TEXT: Record<SnapshotMigrationBlocker['reason'], string> = {
  live: 'blocks a live migration, PVE only moves local snapshots offline: shut the guest down to migrate it with its snapshots, or delete them',
  storage: 'cannot follow the guest to another node from this storage type: delete the snapshots or move the disk to shared storage first',
  target: 'can only be sent to a storage of the same type: keep the current storage or delete the snapshots',
}

/** One readable sentence per blocked volume, for the migrate route's error. */
export function describeSnapshotBlockers(blockers: SnapshotMigrationBlocker[]): string {
  return blockers
    .map(b => `Snapshot(s) ${b.snapshots.join(', ')} on local volume ${b.volid} ${REASON_TEXT[b.reason]}.`)
    .join(' ')
}

/**
 * Blockers for the migration POST .../migrate is about to request. PVE decides
 * live versus offline from the guest's real state, not from the online flag:
 * a running QEMU guest is always migrated live (without online=1 PVE refuses
 * it outright), so the state is read rather than trusted from the caller.
 */
export async function snapshotMigrationGuard(
  conn: ProxmoxClientOptions,
  guest: GuestRef,
  opts: { target: string; targetStorage?: string },
): Promise<SnapshotMigrationBlocker[]> {
  const check = await checkSnapshotMigration(conn, guest, opts)
  if (check.live.length === 0 && check.offline.length === 0) return []
  if (guest.type === 'lxc') return check.offline

  const status = await pveFetch<{ status?: string }>(
    conn,
    `/nodes/${encodeURIComponent(guest.node)}/qemu/${encodeURIComponent(guest.vmid)}/status/current`,
  )
  return status?.status === 'running' ? check.live : check.offline
}
