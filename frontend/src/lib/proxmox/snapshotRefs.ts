// Which snapshots of a guest still reference a given volume (#1004).
//
// PVE refuses two disk operations while a snapshot config carries the volume:
// move_disk/move_volume with delete=1 ("you can't move a disk with snapshots
// and delete the source") and removing an unusedN entry ("volume is still in
// use (snapshot?)"). Pure module so the dialog can be warned before the call.

import { DATA_DISK_KEY_RE, AUX_DISK_KEY_RE, LXC_DISK_KEY_RE } from '@/lib/vdc/drives'

export interface SnapshotConfig {
  name: string
  config: Record<string, unknown>
}

/** A config key that holds a volume on either guest type (drives, efi/tpm, unusedN, rootfs, mpN). */
export function isDiskKey(key: string): boolean {
  return DATA_DISK_KEY_RE.test(key) || AUX_DISK_KEY_RE.test(key) || LXC_DISK_KEY_RE.test(key)
}

/** The volid of a PVE drive string: its first segment, with an optional file=/volume= key. */
export function volidOfDrive(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  const head = value.split(',')[0].trim()
  const m = /^(?:file|volume)=(.*)$/.exec(head)
  const volid = m ? m[1] : head
  return volid || null
}

/**
 * Names of the snapshots whose config still holds `volid` on a drive. unusedN
 * keys are skipped as PVE does: it never copies them into a snapshot, and its
 * in-use check only walks the snapshot's drives.
 */
export function snapshotsReferencingVolume(volid: string, snapshots: SnapshotConfig[]): string[] {
  return snapshots
    .filter(s => s.name !== 'current')
    .filter(s => Object.entries(s.config).some(([k, v]) =>
      isDiskKey(k) && !/^unused\d+$/.test(k) && volidOfDrive(v) === volid))
    .map(s => s.name)
}
