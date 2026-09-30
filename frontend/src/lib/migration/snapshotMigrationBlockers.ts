// Which local volumes held by a snapshot stop an intra-cluster migration (#1027).
//
// Mirrors the snapshot branch of PVE 9.2.11's volume scan, so the migrate
// dialog can say why before PVE aborts with "Problem found while scanning
// volumes - can't migrate VM - check log":
//   - QEMU, PVE/QemuMigrate.pm scan_local_volumes():
//       live + not replicated  "online storage migration not possible if non-replicated snapshot exists"
//       storage not zfspool, btrfs raw or qcow2 (without snapshot-as-volume-chain)
//                              "non-migratable snapshot exists"
//   - LXC, PVE/LXC/Migrate.pm prepare(): storage not zfspool or btrfs
//                              "non-migratable snapshot exists"
// Shared storages are skipped by PVE before any of this. Offline ZFS keeps its
// snapshots, which is why "live" is reported apart from "storage": turning live
// migration off is a remedy that loses nothing.
//
// Pure module: the dialog and the migrate route both run it.

import { isDiskKey, volidOfDrive, type SnapshotConfig } from '@/lib/proxmox/snapshotRefs'
import { isSharedStorage } from '@/lib/proxmox/storage'

export type SnapshotBlockReason =
  /** Only live migration refuses it; an offline migration keeps the snapshots. */
  | 'live'
  /** The source storage cannot carry snapshots to another node at all. */
  | 'storage'
  /** The chosen target storage type cannot receive this volume's snapshots. */
  | 'target'

export interface SnapshotMigrationBlocker {
  volid: string
  storage: string
  /** Snapshots whose config holds the volume, the ones to delete to unblock it. */
  snapshots: string[]
  reason: SnapshotBlockReason
}

/** The storage.cfg facts the rule reads, keyed by storage id. */
export interface StorageFacts {
  type: string
  shared?: number | boolean
  'snapshot-as-volume-chain'?: number | boolean
}

export interface SnapshotMigrationInput {
  guestType: 'qemu' | 'lxc'
  /** QEMU live migration of a running guest. LXC has no live mode. */
  live: boolean
  snapshots: SnapshotConfig[]
  storages: Record<string, StorageFacts>
  /** Volids PVE replicates to the target node, which live migration accepts. */
  replicatedVolids?: ReadonlySet<string>
  /** Storage the disks are moved to, when one is chosen. */
  targetStorage?: string
}

function formatOf(volid: string): string {
  const m = /\.(qcow2|vmdk|raw)$/.exec(volid)
  return m ? m[1] : 'raw'
}

/** Snapshot names per local volid, from the drives of every snapshot config. */
function volumesHeldBySnapshots(input: SnapshotMigrationInput): Map<string, string[]> {
  const held = new Map<string, string[]>()
  for (const snap of input.snapshots) {
    if (snap.name === 'current') continue
    for (const [key, value] of Object.entries(snap.config)) {
      // unusedN never lands in a snapshot, and vmstate is skipped by PVE.
      if (!isDiskKey(key) || /^unused\d+$/.test(key)) continue
      if (typeof value === 'string' && /(?:^|,)media=cdrom(?:,|$)/.test(value)) continue
      const volid = volidOfDrive(value)
      // 'none', 'cdrom' and LXC bind mounts carry no storage volume.
      if (!volid || !volid.includes(':') || volid.startsWith('/')) continue
      const names = held.get(volid) ?? []
      if (!names.includes(snap.name)) names.push(snap.name)
      held.set(volid, names)
    }
  }
  return held
}

export function snapshotMigrationBlockers(input: SnapshotMigrationInput): SnapshotMigrationBlocker[] {
  const blockers: SnapshotMigrationBlocker[] = []
  const target = input.targetStorage ? input.storages[input.targetStorage] : undefined

  for (const [volid, snapshots] of volumesHeldBySnapshots(input)) {
    const storage = volid.split(':')[0]
    const scfg = input.storages[storage]
    // Unknown storage: leave the verdict to PVE rather than block on a guess.
    if (!scfg || isSharedStorage(scfg)) continue

    const format = formatOf(volid)
    const carries = input.guestType === 'lxc'
      ? scfg.type === 'zfspool' || scfg.type === 'btrfs'
      : scfg.type === 'zfspool'
        || (scfg.type === 'btrfs' && format === 'raw')
        || (format === 'qcow2' && !scfg['snapshot-as-volume-chain'])

    let reason: SnapshotBlockReason | null = null
    if (!carries) reason = 'storage'
    // zfs send and btrfs send only land on the same storage type.
    else if (target && (scfg.type === 'zfspool' || scfg.type === 'btrfs') && target.type !== scfg.type) reason = 'target'
    else if (input.guestType === 'qemu' && input.live && !input.replicatedVolids?.has(volid)) reason = 'live'

    if (reason) blockers.push({ volid, storage, snapshots, reason })
  }

  return blockers.sort((a, b) => a.volid.localeCompare(b.volid))
}

/** Every snapshot to delete to clear the given blockers, in first-seen order. */
export function snapshotsToClear(blockers: SnapshotMigrationBlocker[]): string[] {
  return [...new Set(blockers.flatMap(b => b.snapshots))]
}
