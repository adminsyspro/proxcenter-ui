/**
 * Pre-flight rules the migrate dialog enforces before it lets a run start.
 *
 * Kept out of the dialog so the rule has one home and can be asserted without
 * rendering a 3000-line component.
 */
import { isFileBasedStorage } from '@/lib/proxmox/storage'

/**
 * Whether a vSAN-backed source blocks the selected migration type.
 *
 * Offline and Live read the datastore as files: on vSAN there is no `-flat.vmdk`
 * POSIX file, only a descriptor pointing at `vsan://` URIs that neither qemu-img
 * nor the HTTPS datastore endpoint resolves, and `vmkfstools -i` answers
 * "Function not implemented". Both are genuinely impossible over a direct ESXi
 * connection.
 *
 * Warm is not: it reads through VDDK, the disk API, which serves vSAN objects on
 * that same direct connection. Verified end to end on 2026-08-15 (full copy,
 * delta passes, verify, cutover) against a `vsanDatastore` source with no
 * vCenter involved. Before that, the dialog blocked every type and the API was
 * the only way through.
 */
export function vsanBlocksMigrationType(hasVsanDisks: boolean, migType: string): boolean {
  return hasVsanDisks && migType !== 'warm'
}

/**
 * Whether the selected target storage rules out a warm migration.
 *
 * Warm patches the target by byte offset (`dd seek`), which is only meaningful
 * on a raw block device; a dir/NFS/CephFS target holds qcow2 files that the same
 * write would silently corrupt. The engine refuses it at planning time, but only
 * once the job exists, so without this check the operator picks a file-based
 * storage, launches, and reads the refusal in a failed job.
 *
 * Unknown type (storage list still loading) blocks nothing: the engine backstop
 * still covers it, and disabling the button on missing data would look broken.
 */
export function warmNeedsBlockStorage(migType: string, storageType?: string): boolean {
  return migType === 'warm' && !!storageType && isFileBasedStorage(storageType)
}

/** Bounds the API enforces on `downtimeBudgetSec` (api/v1/migrations). */
export const DOWNTIME_BUDGET_MIN_SEC = 30
export const DOWNTIME_BUDGET_MAX_SEC = 86400

/**
 * Whether the typed downtime budget is one the API would accept.
 *
 * Empty is valid and means "use the pipeline default", so clearing the field
 * behaves like never touching it rather than snapping back to a number the
 * operator did not choose. Anything else must be a whole number of seconds
 * inside the API's own range, checked here so a rejected value is caught while
 * it can still be corrected instead of after a job exists.
 */
export function isDowntimeBudgetValid(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed === '') return true
  if (!/^\d+$/.test(trimmed)) return false
  const n = Number(trimmed)
  return n >= DOWNTIME_BUDGET_MIN_SEC && n <= DOWNTIME_BUDGET_MAX_SEC
}
