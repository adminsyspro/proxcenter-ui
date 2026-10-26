/**
 * Per-storage decisions of the direct-ESXi cold pipeline (#317, lot 2).
 *
 * Before lot 2 the pipeline read ONE storage config and derived one import
 * strategy for every disk. With per-disk target storages a VM can put its boot
 * disk on LVM (raw volume, streamed to the block device) and a data disk on NFS
 * (qcow2 converted into the storage's own images/<vmid> directory, then adopted
 * by rename), so the strategy is resolved once per distinct storage and looked
 * up per disk. Kept pure so the SSHFS-boot branch, which no unit harness can
 * drive end to end, is still decided by tested code.
 */

import { assertAbsPath } from "@/lib/ssh/validate"
import { isFileBasedStorage } from "@/lib/proxmox/storage"

import { planStorages, type DiskPlan } from "./target-overrides"

export interface ColdStorageTarget {
  storage: string
  /** PVE storage type (`dir`, `nfs`, `lvmthin`, `rbd`, ...). */
  type: string
  isFileBased: boolean
  /** Format of the volume on this storage: qcow2 on a file-based storage, raw on a block one. */
  importFormat: "qcow2" | "raw"
  /** `<storage path>/images/<vmid>` on a file-based storage, where temp files and adopted volumes live; "" on block storage. */
  imagesDir: string
  /** Drive options appended to the volid at attach time: discard only makes sense on a file target. */
  driveOpts: string
}

/** Fields of a `/storage/{id}` answer this module reads. */
export interface StorageConfigLike {
  type?: string
  path?: string
}

const GIB = 1073741824

/** Free space must exceed the bytes to copy by this factor (unchanged since the single-storage check). */
export const SPACE_MARGIN = 1.1

/** The import strategy of one storage, from its `/storage/{id}` config. */
export function coldStorageTarget(
  storage: string,
  cfg: StorageConfigLike | null | undefined,
  vmid: number,
): ColdStorageTarget {
  const type = cfg?.type || "dir"
  const isFileBased = isFileBasedStorage(type)
  // The storage path comes from the cluster's storage.cfg and lands in node
  // shell commands: only a plain absolute path passes (assertAbsPath throws).
  const imagesDir = isFileBased ? assertAbsPath(`${cfg?.path || "/var/lib/vz"}/images/${vmid}`) : ""
  return {
    storage,
    type,
    isFileBased,
    importFormat: isFileBased ? "qcow2" : "raw",
    imagesDir,
    driveOpts: isFileBased ? ",discard=on" : "",
  }
}

/**
 * The storages the pipeline must know about: the job default first (it hosts
 * efidisk0, tpmstate0 and every unmapped disk), then the other storages of the
 * plan in first-use order. Without per-disk choices this is `[defaultStorage]`.
 */
export function coldStorages(defaultStorage: string, plan: DiskPlan<unknown>): string[] {
  return [...new Set([defaultStorage, ...planStorages(plan)])]
}

/** Kind of the local volumes the SSHFS-boot mode allocates: one word when every disk agrees, both otherwise. */
export function localVolumeKinds(targets: readonly ColdStorageTarget[]): string {
  const kinds = new Set(targets.map(t => (t.isFileBased ? "file-based" : "block")))
  return kinds.size > 0 ? [...kinds].join(" and ") : "block"
}

/** Job-log line of the free-space check of one storage. */
export function describeStorageSpace(storage: string, freeBytes: number, neededBytes: number): string {
  return `Target storage "${storage}": ${(freeBytes / GIB).toFixed(1)} GB free, need ${(neededBytes / GIB).toFixed(1)} GB`
}

/** The error to throw when a storage cannot take its share of the disks, or null when it can. */
export function storageSpaceShortfall(storage: string, freeBytes: number, neededBytes: number): string | null {
  if (freeBytes >= neededBytes * SPACE_MARGIN) return null
  return `Insufficient disk space on "${storage}": ${(freeBytes / GIB).toFixed(1)} GB free, need ${(neededBytes / GIB).toFixed(1)} GB`
}
