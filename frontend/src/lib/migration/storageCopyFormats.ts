/**
 * Offline cross-cluster copy (remote_migrate of a stopped VM): Proxmox exports
 * each disk in a format the target storage must import, without snapshots.
 * The formats come from the volume_export_formats / volume_import_formats of
 * each storage plugin (PVE 9.2/9.3, read on the lab nodes 27/11/2026):
 * a ZFS pool speaks `zfs` only, every other disk storage `raw+size`, and an
 * iSCSI LUN storage imports nothing. A live migration mirrors the disks over
 * NBD instead and needs none of this.
 *
 * Lab 27/11: a stopped VM on RBD sent to a ZFS pool was refused one second
 * into the task ("no matching import/export format found for storage").
 */

const RAW = 'raw+size'

const EXPORT_FORMATS: Record<string, readonly string[]> = {
  zfspool: ['zfs'],
  zfs: ['zfs'],
  rbd: [RAW],
  lvm: [RAW],
  lvmthin: [RAW],
  iscsidirect: [RAW],
  dir: [RAW],
  nfs: [RAW],
  cifs: [RAW],
  glusterfs: [RAW],
  cephfs: [RAW],
  btrfs: [RAW],
}

const IMPORT_FORMATS: Record<string, readonly string[]> = {
  ...EXPORT_FORMATS,
  iscsidirect: [],
}

/** True when Proxmox has no format to copy a disk of `sourceType` to `targetType` offline. */
export function offlineCopyFormatMismatch(sourceType: string | undefined, targetType: string | undefined): boolean {
  const exported = sourceType ? EXPORT_FORMATS[sourceType] : undefined
  const imported = targetType ? IMPORT_FORMATS[targetType] : undefined
  if (!exported || !imported) return false

  return !exported.some(format => imported.includes(format))
}
