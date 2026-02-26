/** File-based storage types that support PVE download-url API */
export const FILE_BASED_STORAGE_TYPES = ["dir", "nfs", "cifs", "glusterfs", "cephfs", "btrfs"] as const

export function isFileBasedStorage(type: string): boolean {
  return FILE_BASED_STORAGE_TYPES.includes(type as any)
}
