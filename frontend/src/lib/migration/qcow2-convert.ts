import { pveFetch } from "@/lib/proxmox/client"

import { waitForPveTask } from "./pve-tasks"
import type { AllocatedVolume } from "./pvesm-alloc"

type PveConn = { baseUrl: string; apiToken: string; insecureDev: boolean; id: string }

/**
 * Timeout for one `move_disk` task. The conversion rewrites every byte of the
 * disk: PVE mirrors the raw volume into a fresh qcow2 volume, then deletes the
 * raw one. On the customer array that motivated this (#587/#606), sequential
 * throughput lands between 359 MiB/s (QD1 worst case) and 1.9 GiB/s, so a
 * multi-TB disk is legitimately *hours* of work — nowhere near waitForPveTask's
 * 5-minute default. 24 h covers a 10+ TB disk on a slow array with margin.
 */
export const MOVE_DISK_TIMEOUT_MS = 24 * 60 * 60 * 1000

/**
 * Does this storage allocate qcow2 volumes by default?
 *
 * That is exactly one storage class today: PVE 9 LVM with
 * `snapshot-as-volume-chain` — the configuration whose snapshots depend on the
 * qcow2 volume chain, and therefore the only one where converting a migrated
 * raw disk buys the operator anything (#595). Everything else is deliberately
 * out: lvmthin/ZFS/Ceph snapshot natively on raw, and file-based storages get
 * their disks imported as qcow2 files in the first place. PVE serialises the
 * flag as 0/1 (sometimes a string), so accept both spellings.
 *
 * This is the server-side re-check of the UI gate: the dialog only shows the
 * option on an lvm storage, but a raw API caller bypasses the dialog.
 */
export function storageDefaultsToQcow2(
  cfg: { type?: string; "snapshot-as-volume-chain"?: number | string | boolean } | null | undefined,
): boolean {
  if (!cfg || cfg.type !== "lvm") return false
  const flag = cfg["snapshot-as-volume-chain"]
  return flag === 1 || flag === "1" || flag === true
}

export interface MigratedDataDisk {
  /** VM config slot the disk is attached to (`scsi0`, `virtio1`, ...). */
  slot: string
  volumeId: string
  /** Virtual size parsed from the config value's `size=` option (0 if absent). */
  sizeBytes: number
}

// Bus slots that can hold a data disk. efidisk0/tpmstate0 deliberately do NOT
// match: PVE creates them itself at `qm create` time and the efidisk is already
// qcow2 on a volume-chain storage (#606: `efidisk0: FC-HDC-01:vm-169-disk-0.qcow2`).
// `unusedN` does not match either — an unused volume is not attached, so a live
// mirror is impossible and it is not a disk this migration handed to the VM.
const DATA_DISK_SLOT_RE = /^(?:scsi|sata|virtio|ide)\d+$/

// `size=32G` in a VM config value. PVE prints the largest exact binary unit,
// or plain bytes when nothing divides evenly.
const PVE_SIZE_UNIT: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4, P: 1024 ** 5 }

function parsePveSize(value: string): number {
  const m = /(?:^|,)size=(\d+)([KMGTP])?(?:,|$)/.exec(value)
  if (!m) return 0
  return Number(m[1]) * (m[2] ? PVE_SIZE_UNIT[m[2]] : 1)
}

/**
 * The attached data disks THIS migration created, resolved against the live VM
 * config. Matching by volume ID (not by remembering slots) means a disk whose
 * attach failed with a warning simply never shows up, and a volume that is
 * already qcow2 — a re-run after a partially completed conversion — is skipped
 * instead of being rewritten a second time. Sorted naturally by slot so scsi10
 * converts after scsi2 and the job log reads in order.
 */
export function migratedDataDisks(
  vmConf: Record<string, unknown> | null | undefined,
  volumes: ReadonlyArray<Pick<AllocatedVolume, "volumeId">>,
): MigratedDataDisk[] {
  const ours = new Set(volumes.map(v => v.volumeId).filter(Boolean))
  const disks: MigratedDataDisk[] = []
  for (const [slot, value] of Object.entries(vmConf || {})) {
    if (!DATA_DISK_SLOT_RE.test(slot) || typeof value !== "string") continue
    const volumeId = value.split(",")[0]
    if (!ours.has(volumeId) || volumeId.endsWith(".qcow2")) continue
    disks.push({ slot, volumeId, sizeBytes: parsePveSize(value) })
  }
  return disks.sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true }))
}

export interface ConvertDisksToQcow2Args {
  /** `config.convertDisksToQcow2` — pass it through, the helper owns the skip log. */
  enabled: boolean
  conn: PveConn
  node: string
  vmid: number | string
  targetStorage: string
  /**
   * The pipeline's cleanup registry (or any list of the volume IDs this
   * migration created). Mutated on success: PVE deletes the raw volume and
   * mirrors into a fresh `.qcow2` name, so the recorded IDs are rewritten to
   * the new ones — a later cleanup must never try to free a name that no
   * longer exists.
   */
  volumes: AllocatedVolume[]
  /** Job-log writer (the pipeline's appendLog bound to its jobId). */
  log: (msg: string, level?: "info" | "success" | "warn" | "error") => Promise<void> | void
  /** Persist the `converting_disks` phase with the given progress (95 → 99). */
  setPhase: (progress: number) => Promise<void> | void
  /** Override for tests; defaults to MOVE_DISK_TIMEOUT_MS. */
  moveTimeoutMs?: number
}

/**
 * Post-migration qcow2 conversion (#595): one `move_disk` per data disk against
 * the same storage with `format=qcow2, delete=1` — exactly the call the web UI
 * "Move disk" makes, i.e. the operation the reporter already runs by hand after
 * every migration to get snapshot-capable disks back. On a running VM PVE
 * performs it as a live drive-mirror, so run it after the disks are attached
 * and after the optional start.
 *
 * CONTRACT: this function can never fail the migration. By the time it runs the
 * VM is migrated, bootable and possibly already serving — a conversion problem
 * must degrade to "the disks are still raw", never to a failed job. Every exit
 * path, including a throwing log callback, resolves.
 */
export async function convertDisksToQcow2(args: ConvertDisksToQcow2Args): Promise<void> {
  try {
    await runConversion(args)
  } catch (err: any) {
    // Never rethrow: the pipeline's next statement is the terminal "completed"
    // write, and nothing that happens here may keep the job from reaching it.
    try {
      await args.log(
        `qcow2 conversion did not complete: ${err?.message || err}. The migration itself succeeded — ` +
        `the VM is migrated and usable, its disks are simply still raw. Convert them manually with ` +
        `"Move disk" (same storage, format qcow2) if you need snapshots.`,
        "warn",
      )
    } catch {
      // Even a failing job-log write must not surface: swallowing it here is
      // what keeps the "cannot fail the migration" contract absolute.
    }
  }
}

async function runConversion(args: ConvertDisksToQcow2Args): Promise<void> {
  const { enabled, conn, node, vmid, targetStorage, volumes, log, setPhase } = args

  // Silently: every pipeline calls this unconditionally, so logging a skip here
  // would add a line about an opt-in feature to the log of every migration that
  // never asked for it. The gates below DO log, because there the operator did
  // ask and needs to know why it did not happen.
  if (!enabled) return

  // Server-side re-check of the UI gate: only a snapshot-as-volume-chain LVM
  // storage defaults to qcow2, and only there does the conversion buy snapshots.
  const storageCfg = await pveFetch<any>(conn, `/storage/${encodeURIComponent(targetStorage)}`)
  if (!storageDefaultsToQcow2(storageCfg)) {
    await log(
      `Skipping qcow2 conversion: storage "${targetStorage}" (${storageCfg?.type || "unknown"}) does not ` +
      `default to qcow2 (requires an LVM storage with snapshot-as-volume-chain). Disks keep their native format.`,
    )
    return
  }

  const vmConf = await pveFetch<Record<string, unknown>>(
    conn, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`,
  )
  const disks = migratedDataDisks(vmConf, volumes)
  if (disks.length === 0) {
    await log(`Skipping qcow2 conversion: no raw data disks from this migration are attached to VM ${vmid}.`)
    return
  }

  // The mirror transiently doubles the disk: source raw volume and target qcow2
  // volume coexist until the copy completes and `delete=1` frees the raw one.
  // Disks convert one at a time, so the requirement is the LARGEST disk, not
  // the sum. `avail` comes from the node's live storage status, not the config.
  const storageStatus = await pveFetch<any>(
    conn, `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(targetStorage)}/status`,
  )
  const avail = Number(storageStatus?.avail ?? 0)
  const largest = Math.max(...disks.map(d => d.sizeBytes))
  if (!Number.isFinite(avail) || avail < largest) {
    const gib = (n: number) => (n / 1024 ** 3).toFixed(1)
    await log(
      `Skipping qcow2 conversion: free space on "${targetStorage}" (${gib(avail)} GiB) is below the largest ` +
      `disk to convert (${gib(largest)} GiB) — the conversion transiently needs a second full copy of the disk. ` +
      `Free up space and convert manually with "Move disk" if you need snapshots.`,
      "warn",
    )
    return
  }

  await setPhase(95)
  await log(
    `Converting ${disks.length} disk(s) to qcow2 on "${targetStorage}" so they can take Proxmox snapshots. ` +
    `This rewrites every byte in the background (hours on multi-TB disks); a running VM stays available.`,
  )

  for (let i = 0; i < disks.length; i++) {
    const disk = disks[i]
    try {
      const upid = await pveFetch<string>(
        conn, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/move_disk`,
        {
          method: "POST",
          body: new URLSearchParams({ disk: disk.slot, storage: targetStorage, format: "qcow2", delete: "1" }),
        },
      )
      if (!upid) throw new Error("move_disk returned no task id")
      await waitForPveTask(conn, node, String(upid), args.moveTimeoutMs ?? MOVE_DISK_TIMEOUT_MS)
    } catch (e: any) {
      // One refusal (feature/space/lock) very likely applies to the remaining
      // disks too — do not hammer the storage for hours per disk. Re-throwing
      // hands the whole batch to the outer never-fails handler.
      throw new Error(`disk ${disk.slot} (${disk.volumeId}): ${e?.message || e}`)
    }

    // The move deleted the raw volume and attached a fresh `.qcow2` one: read
    // the slot back for the authoritative new ID and rewrite the cleanup
    // registry, so no later code path can free a name that no longer exists.
    const confAfter = await pveFetch<Record<string, unknown>>(
      conn, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/config`,
    )
    const newVolumeId = String(confAfter?.[disk.slot] || "").split(",")[0]
    const entry = volumes.find(v => v.volumeId === disk.volumeId)
    if (entry && newVolumeId) {
      entry.volumeId = newVolumeId
      entry.devicePath = "" // the raw LV's device node died with the volume
    }
    await log(`Disk ${disk.slot}: converted to qcow2 → ${newVolumeId || "(new volume)"}`, "success")
    await setPhase(95 + Math.round(((i + 1) / disks.length) * 4))
  }

  await log(`qcow2 conversion complete: ${disks.length} disk(s) now support Proxmox snapshots.`, "success")
}
