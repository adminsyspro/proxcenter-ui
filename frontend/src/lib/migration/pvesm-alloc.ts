import { executeSSH, shellEscape } from "@/lib/ssh/exec"

export interface AllocateAndResolveResult {
  volumeId: string
  devicePath: string
}

/**
 * A target volume tracked by a migration pipeline so failure cleanup can free it.
 *
 * The slot is reserved (see `reserveVolumeSlot`) BEFORE the allocation runs and
 * filled in as the allocation progresses, so an allocation that creates the volume
 * and then reports a failure still leaves something for cleanup to free.
 */
export interface AllocatedVolume {
  volumeId: string
  devicePath: string
  rbdMapped?: boolean
  attached?: boolean
  /**
   * Set once the volume holds a snapshot-consistent image from a COMPLETED copy
   * pass. From that point the target is bootable and represents hours of transfer,
   * so failure cleanup must never free it (see `volumesToFree` / #612). A volume
   * that failed mid copy never gets this flag and is still freed as before.
   */
  copied?: boolean
}

export interface AllocateBlockVolumeOpts {
  /**
   * The caller's cleanup slot (see `reserveVolumeSlot`), kept in sync by this
   * function so failure cleanup frees exactly what it should:
   *
   *  - set to the volume ID immediately BEFORE each `pvesm alloc` attempt, because
   *    the command can create the volume and STILL report a failure. A volume that
   *    was never registered is never freed, and it then collides with every later
   *    attempt on the same VMID (#587).
   *  - cleared again when an attempt fails on a name collision: that proves the
   *    volume already existed, so it is NOT ours and must never be freed.
   */
  slot?: AllocatedVolume
  /** How many times the disk number may be bumped on a name collision (default 3). */
  maxNameBumps?: number
}

/**
 * Timeout for `pvesm alloc`. A multi-TB allocation is not instant: on PVE 9 LVM with
 * `snapshot-as-volume-chain`, allocating 3.1 TB took 47 s on a customer's FC array
 * (#587) because PVE formats the logical volume as qcow2, and thick-provisioning
 * plugins can take minutes. executeSSH's 30 s default cut the channel while the
 * volume was being created server-side, which is how orphans appear.
 */
export const PVESM_ALLOC_TIMEOUT_MS = 10 * 60_000

/**
 * Timeout for the `pvesm free` calls that clean up orphan volumes. On an LVM storage
 * with `saferemove`, PVE zeroes the volume before removing it, which is throughput
 * bound (~1.8 GB/s on FC) — nowhere near the 30 s default.
 */
export const PVESM_FREE_TIMEOUT_MS = 5 * 60_000

const DEFAULT_MAX_NAME_BUMPS = 3

/**
 * Does this pvesm failure mean "that volume name is already taken"?
 *
 * Each plugin words it differently: LVM `Logical Volume "x" already exists`, ZFS
 * `dataset already exists`, RBD `create error: (17) File exists`.
 */
function isNameCollision(message: string): boolean {
  return /(?:already|file) exists/i.test(message)
}

/** `vm-250-disk-2` → `vm-250-disk-3`; null when the name has no disk number to bump. */
function bumpDiskNumber(volName: string): string | null {
  // Anchored suffix match, no leading `.*`: linear on the input, no backtracking.
  const m = /-disk-(\d+)$/.exec(volName)
  if (!m) return null
  return `${volName.slice(0, m.index)}-disk-${Number(m[1]) + 1}`
}

/**
 * Reserve the cleanup slot for the disk we are about to allocate.
 *
 * Pipelines index this array by disk position (`allocatedVolumes[i].volumeId` is
 * what gets attached to the VM), so there is exactly one slot per disk: reserve it
 * up front and mutate it, never push a second entry for a retried allocation.
 */
export function reserveVolumeSlot(allocatedVolumes: AllocatedVolume[]): AllocatedVolume {
  const slot: AllocatedVolume = { volumeId: "", devicePath: "" }
  allocatedVolumes.push(slot)
  return slot
}

/**
 * The volumes failure cleanup must free: registered, not attached to the VM, and
 * not holding a completed copy.
 *
 * Skips slots whose allocation never started (no volume ID yet) so cleanup never
 * frees a name we did not create, and skips attached volumes, which are in
 * `qm config` already and get removed together with the VM. It also skips volumes
 * marked `copied`: disks are attached only at the very end of a cutover, so
 * between the end of the first full copy pass and that attach the target holds a
 * bootable, snapshot-consistent image that is NOT attached yet. Freeing it on a
 * late failure or cancellation deletes hours of finished transfer (3.4 TB on a
 * customer cluster, #612). Cleanup reports those through `volumesToKeep` instead.
 *
 * Both filters live in this module on purpose: the pipelines must never
 * re-implement the keep/free rule (and CI fails on duplicated pipeline code).
 */
export function volumesToFree(allocatedVolumes: AllocatedVolume[]): AllocatedVolume[] {
  return allocatedVolumes.filter(v => v.volumeId && !v.attached && !v.copied)
}

/**
 * The volumes failure cleanup deliberately leaves behind: registered, holding a
 * completed copy, and not attached to the VM (an attached volume lives on with
 * the VM, nothing was abandoned). Companion of `volumesToFree`, so cleanup can
 * log exactly which volumes it kept and the operator knows what to remove
 * manually if the copy is not wanted (#612).
 */
export function volumesToKeep(allocatedVolumes: AllocatedVolume[]): AllocatedVolume[] {
  return allocatedVolumes.filter(v => v.volumeId && v.copied && !v.attached)
}

/**
 * Name for the next data disk of `targetVmid` on the target storage.
 *
 * Numbering starts after the highest `vm-<vmid>-disk-<n>` already referenced by the
 * VM config — an OVMF shell owns `disk-0` for its EFI vars before any data disk
 * exists — and after everything allocated so far in this run. It takes the highest
 * number rather than a count, so a gap in the sequence can never hand back a name
 * that is already taken.
 */
export function nextFreeDiskName(
  vmConf: Record<string, unknown> | null | undefined,
  allocatedVolumes: AllocatedVolume[],
  targetVmid: number | string,
): string {
  let maxDiskNum = -1
  const bump = (value: string) => {
    const m = value.match(/vm-\d+-disk-(\d+)/)
    if (m) maxDiskNum = Math.max(maxDiskNum, Number.parseInt(m[1], 10))
  }
  for (const value of Object.values(vmConf || {})) {
    if (typeof value === "string") bump(value)
  }
  for (const v of allocatedVolumes) {
    if (v.volumeId) bump(v.volumeId)
  }
  return `vm-${targetVmid}-disk-${maxDiskNum + 1}`
}

export interface AllocateAndMapArgs {
  connectionId: string
  nodeIp: string
  targetStorage: string
  targetVmid: number | string
  volName: string
  sizeKB: number
  /**
   * The pipeline's cleanup registry. A slot is reserved in it before the allocation
   * runs, so exactly one entry exists per disk and failure cleanup can free a volume
   * created by an allocation that then failed (#587).
   */
  allocatedVolumes?: AllocatedVolume[]
  /** Progress logger for the RBD mapping and the resulting volume. */
  onLog?: (message: string) => Promise<void> | void
}

/**
 * Allocate a raw block volume, map it if the storage is Ceph, and register it for
 * failure cleanup — the whole "get me a writable block device for this disk" step
 * that the warm, cold, XCP-ng and v2v pipelines each used to carry a copy of.
 */
export async function allocateAndMapBlockVolume(args: AllocateAndMapArgs): Promise<AllocatedVolume> {
  const { connectionId, nodeIp, targetStorage, targetVmid, volName, sizeKB, onLog } = args
  const slot = args.allocatedVolumes ? reserveVolumeSlot(args.allocatedVolumes) : { volumeId: "", devicePath: "" }

  const alloc = await allocateBlockVolumeAndResolvePath(
    connectionId, nodeIp, targetStorage, targetVmid, volName, sizeKB, { slot },
  )

  // RBD/Ceph — two path formats depending on the storage's `krbd` option:
  //  - krbd 0 (librbd): pvesm path returns "rbd:pool/image:conf=..." — not a block
  //    device; map via `rbd map <pool>/<image>` → /dev/rbdN.
  //  - krbd 1 (KRBD):   pvesm path returns "/dev/rbd-pve/<fsid>/<pool>/<image>" — the
  //    symlink only exists after `rbd device map <pool>/<image>`; devicePath stays put.
  let devicePath = alloc.devicePath
  let rbdMapped = false
  const krbdMatch = devicePath.match(/^\/dev\/rbd-pve\/[^/]+\/([^/]+)\/([^/]+)$/)

  if (devicePath.startsWith("rbd:")) {
    const rbdSpec = devicePath.split(":")[1]
    if (!rbdSpec) throw new Error(`Cannot parse RBD path: ${devicePath}`)
    const mapped = await executeSSH(connectionId, nodeIp, `rbd map ${shellEscape(rbdSpec)} 2>&1`)
    if (!mapped.success || !mapped.output?.trim()) {
      throw new Error(`Failed to rbd map ${rbdSpec}: ${(mapped.output || mapped.error || "").trim()}`)
    }
    devicePath = mapped.output.trim()
    rbdMapped = true
    await onLog?.(`RBD mapped ${rbdSpec} → ${devicePath}`)
  } else if (krbdMatch) {
    const rbdSpec = `${krbdMatch[1]}/${krbdMatch[2]}`
    const mapped = await executeSSH(connectionId, nodeIp, `rbd device map ${shellEscape(rbdSpec)} 2>&1`)
    if (!mapped.success) {
      throw new Error(`Failed to rbd device map ${rbdSpec}: ${(mapped.output || mapped.error || "").trim()}`)
    }
    rbdMapped = true
    await onLog?.(`RBD (KRBD) mapped ${rbdSpec} → ${devicePath}`)
  }

  // Every plugin must land on an absolute device path. Anything else means the
  // pipeline would stream guest data into something that is not the target volume.
  if (!devicePath.startsWith("/")) {
    throw new Error(`Invalid device path for ${alloc.volumeId}: "${devicePath}" (expected an absolute path)`)
  }

  // The volume ID from pvesm's own output is authoritative: a name collision may
  // have bumped the disk number.
  slot.volumeId = alloc.volumeId
  slot.devicePath = devicePath
  slot.rbdMapped = rbdMapped
  await onLog?.(`Allocated volume ${alloc.volumeId} → ${devicePath}`)
  return slot
}

/**
 * Allocate a raw block volume on PVE and return its device path.
 *
 * Wraps `pvesm alloc` + `pvesm path` and handles the output formats every
 * storage plugin emits, including LVM on iSCSI multipath which prints the
 * resulting block device path (`'/dev/<vg>/<lv>'`) instead of the volume ID
 * (`'<storage>:<volname>'`). Feeding the device path back into `pvesm path`
 * fails (it expects `STORAGE:VOLNAME`), so we detect that case and skip the
 * second SSH call entirely.
 *
 * `--format raw` is explicit on purpose. Every migration pipeline writes raw guest
 * blocks into the returned device and allocates the volume under a name with no
 * `.qcow2` suffix, so Proxmox treats it as raw afterwards. Left to the storage
 * default, a PVE 9 LVM storage with `snapshot-as-volume-chain` allocates qcow2
 * instead: it spends ~37 s of a 3.1 TB allocation writing a qcow2 header that the
 * first copy pass overwrites anyway, and current PVE rejects the name/format
 * mismatch outright (#587).
 *
 * Caller is responsible for cleanup via `pvesm free <volumeId>` on error — pass
 * `opts.slot` so a volume created by a *failed* allocation is freed too.
 */
export async function allocateBlockVolumeAndResolvePath(
  connectionId: string,
  nodeIp: string,
  targetStorage: string,
  targetVmid: number | string,
  volName: string,
  sizeKB: number,
  opts: AllocateBlockVolumeOpts = {},
): Promise<AllocateAndResolveResult> {
  const maxNameBumps = opts.maxNameBumps ?? DEFAULT_MAX_NAME_BUMPS
  let name = volName
  let allocOutput = ""

  for (let attempt = 0; ; attempt++) {
    if (opts.slot) opts.slot.volumeId = `${targetStorage}:${name}`

    const allocResult = await executeSSH(
      connectionId,
      nodeIp,
      `pvesm alloc ${shellEscape(targetStorage)} ${targetVmid} ${shellEscape(name)} ${sizeKB} --format raw 2>&1`,
      PVESM_ALLOC_TIMEOUT_MS,
    )

    if (allocResult.success && allocResult.output?.trim()) {
      allocOutput = allocResult.output.trim()
      break
    }

    // The command merges stderr into stdout (2>&1), so the real pvesm message is in
    // `output` while `error` is only the exit code — and that code says nothing:
    // pvesm is Perl, `die` exits with the current errno, and PVE's cluster lock
    // helper leaves EEXIST (17) behind on every call, which is why "Exit code 17"
    // surfaced on failures that had nothing to do with an existing volume (#587).
    const message = (allocResult.output || allocResult.error || "no output from pvesm alloc").trim()

    // A name collision is recoverable: a leftover volume from an earlier attempt (or
    // a race with a concurrent job) owns the name, so move to the next disk number
    // instead of failing the whole migration. It also proves this attempt created
    // nothing, so drop the registration — cleanup must never free a volume that was
    // already there, it belongs to whoever left it behind.
    const collision = isNameCollision(message)
    if (collision && opts.slot) opts.slot.volumeId = ""

    const nextName = collision && attempt < maxNameBumps ? bumpDiskNumber(name) : null
    if (!nextName) throw new Error(`Failed to allocate volume: ${message}`)
    name = nextName
  }

  // pvesm alloc output varies by plugin:
  //   - dir/NFS: "successfully created 'storage:vmid/vm-vmid-disk-N.raw'"
  //   - LVM:     "successfully created 'storage:vm-vmid-disk-N'"
  //   - Ceph:    "successfully created 'storage:vm-vmid-disk-N'"
  //   - LVM on iSCSI multipath: prints '/dev/<vg>/<lv>' between quotes
  //     instead of the volume ID — calling `pvesm path` on that fails.
  const quotedMatch = allocOutput.match(/'([^']+)'/)
  const captured = quotedMatch ? quotedMatch[1] : allocOutput

  if (captured.startsWith("/dev/")) {
    return {
      volumeId: `${targetStorage}:${name}`,
      devicePath: captured,
    }
  }

  const volumeId = captured
  const pathResult = await executeSSH(
    connectionId,
    nodeIp,
    `pvesm path ${shellEscape(volumeId)} 2>&1`,
  )

  if (!pathResult.success || !pathResult.output?.trim()) {
    const message = (pathResult.output || pathResult.error || "no output from pvesm path").trim()
    throw new Error(`Failed to resolve device path for ${volumeId}: ${message}`)
  }

  return { volumeId, devicePath: pathResult.output.trim() }
}
