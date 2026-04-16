/** File-based storage types that support PVE download-url API */
export const FILE_BASED_STORAGE_TYPES = ["dir", "nfs", "cifs", "glusterfs", "cephfs", "btrfs"] as const

export function isFileBasedStorage(type: string): boolean {
  return FILE_BASED_STORAGE_TYPES.includes(type as any)
}

/** Storage types that are inherently shared across cluster nodes */
export const SHARED_STORAGE_TYPES = ["rbd", "cephfs", "nfs", "cifs", "glusterfs", "iscsi", "iscsidirect", "zfs", "pbs"] as const

/**
 * Check if a storage is shared, using both the PVE `shared` flag AND type-based detection.
 * This guards against transient API responses where the `shared` field is missing or 0
 * for inherently-shared backends like RBD/Ceph during cluster events (issue #249).
 */
export function isSharedStorage(storage: { shared?: number | boolean; type?: string }): boolean {
  return !!storage.shared || SHARED_STORAGE_TYPES.includes(storage.type as any)
}

/** Storage types that support VM disk images (content type "images") */
export const VM_DISK_STORAGE_TYPES = ["dir", "nfs", "cifs", "glusterfs", "btrfs", "rbd", "lvm", "lvmthin", "zfspool", "zfs"] as const

export function supportsVmDisks(type: string): boolean {
  return VM_DISK_STORAGE_TYPES.includes(type as any)
}
