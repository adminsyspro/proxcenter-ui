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
 * Offline reads the datastore as files: on vSAN there is no `-flat.vmdk`
 * POSIX file, only a descriptor pointing at `vsan://` URIs that neither qemu-img
 * nor the HTTPS datastore endpoint resolves, and `vmkfstools -i` answers
 * "Function not implemented". That is genuinely impossible over a direct ESXi
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
 * Whether a vSAN-backed source blocks the run on a DIRECT ESXi connection.
 *
 * `vsanBlocksMigrationType` states the rule; this states who it applies to, and
 * that distinction is the whole reason it exists as its own function. A vCenter
 * (and likewise Hyper-V or Nutanix) source is exempt: virt-v2v reaches those
 * disks through the NFC export, which is vSAN aware. Everything else reads the
 * datastore as files and cannot.
 *
 * Found during the #292 recette on 2026-08-24: the migrate button tested the
 * rule only in the branch a direct-ESXi *Linux* guest falls through, so a
 * Windows guest, which the API routes to virt-v2v over `-i vmx -it ssh` and
 * which cannot read a vSAN object either, sailed past the red alert with an
 * enabled button. The rule now sits above that branch, and here so it can be
 * asserted without rendering the dialog.
 */
export function vsanBlocksDirectEsxiRun(
  hasVsanDisks: boolean,
  migType: string,
  isV2vManagedSource: boolean,
): boolean {
  return !isV2vManagedSource && vsanBlocksMigrationType(hasVsanDisks, migType)
}

/**
 * Temp space a cold virt-v2v run must find on the temp storage, in bytes.
 *
 * The old rule always demanded twice the source's committed space, because the
 * source download AND the converted image both landed on the temp storage.
 * Since #292 a file-based target has the conversion written straight onto
 * itself, so only the download still needs temp room. Keeping the doubled
 * requirement would go on refusing exactly the migrations the change was made
 * to unlock: a 1 TB VM onto NFS asked for 2 TB of temp space.
 *
 * Unknown storage type keeps the conservative factor: the dialog would rather
 * ask for space that turns out unnecessary than start a run that fills the
 * filesystem halfway through a disk.
 */
export function requiredTempBytes(committedBytes: number, targetStorageType?: string): number {
  const directWrite = !!targetStorageType && isFileBasedStorage(targetStorageType)
  return Math.max(0, committedBytes) * (directWrite ? 1 : 2)
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

/**
 * Budgets the slider offers, in seconds.
 *
 * A linear axis from 30 s to 24 h would spend its whole width on values nobody
 * picks, so the control walks a curated scale instead: fine where the decision
 * actually happens (under ten minutes), coarse beyond, and still reaching the
 * API's ceiling for the rare run that wants it.
 */
export const DOWNTIME_BUDGET_PRESETS = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600, 43200, 86400] as const

/** Pipeline default, and where the slider starts. */
export const DOWNTIME_BUDGET_DEFAULT_SEC = 300

/** Slider position for a budget, snapped to the nearest offered value. */
export function downtimeBudgetIndex(seconds: number): number {
  let best = 0
  for (let i = 1; i < DOWNTIME_BUDGET_PRESETS.length; i++) {
    if (Math.abs(DOWNTIME_BUDGET_PRESETS[i] - seconds) < Math.abs(DOWNTIME_BUDGET_PRESETS[best] - seconds)) best = i
  }
  return best
}

/**
 * Render a budget the way an operator reads a maintenance window: seconds while
 * they still mean something, then minutes, then hours.
 *
 * Never a fraction. The slider only ever produces values that divide cleanly,
 * but the field next to it takes any number of seconds, and 620 s must read as
 * "10 min 20 s" rather than "10.333333333333334 min".
 */
export function formatDowntimeBudget(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} s`

  if (total < 3600) {
    const minutes = Math.floor(total / 60)
    const rest = total % 60

    return rest ? `${minutes} min ${rest} s` : `${minutes} min`
  }

  const hours = Math.floor(total / 3600)
  const restMinutes = Math.round((total % 3600) / 60)

  return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`
}
