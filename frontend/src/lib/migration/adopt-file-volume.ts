import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { nextFreeDiskName, type AllocatedVolume } from "./pvesm-alloc"

/**
 * Turning an already-converted image into a PVE volume WITHOUT re-copying it (#292).
 *
 * Every cold pipeline used to finish a file-based migration with `qm disk import`,
 * which is a full `qemu-img convert` of the disk into a freshly allocated volume.
 * When the converted image already sits on the target storage's own filesystem
 * (and the in-house pipelines write it straight into `<storage path>/images/<vmid>/`),
 * that copy reads and writes the whole disk a second time for nothing: a 1 TB VM
 * pays a second full pass and needs room for two copies at once.
 *
 * A rename is enough. The file is already in the right format on the right
 * filesystem, so moving it to the canonical `vm-<vmid>-disk-<N>.<fmt>` name inside
 * the storage's `images/<vmid>` directory makes it a volume PVE recognises, at
 * O(1) cost, and the caller then attaches the volid through the VM config API
 * exactly as it attached the imported one.
 *
 * The whole point of this module is that no pipeline re-implements the guard rails:
 * same-filesystem check, never clobbering an existing file, and the free disk index
 * (an OVMF shell already owns `disk-0` for its EFI vars). Adoption is best effort by
 * design: anything unexpected returns null instead of throwing, so the caller falls
 * back to `qm disk import` and the migration still completes.
 */
export interface AdoptFileVolumeArgs {
  connectionId: string
  nodeIp: string
  /** Absolute path of the converted image on the target node. */
  sourcePath: string
  /** PVE storage ID the volume must belong to. */
  targetStorage: string
  /** The storage's own volume directory for this VM: `<storage path>/images/<vmid>`. */
  imagesDir: string
  targetVmid: number | string
  /** Format the volume must have on the target storage. */
  format: "qcow2" | "raw"
  /**
   * Real format of `sourcePath`, when it differs from the format the volume must
   * have. A rename cannot convert, so a mismatch disables adoption and the caller
   * gets a real `qm disk import`, which does convert. Defaults to `format`.
   */
  sourceFormat?: "qcow2" | "raw"
  /** VM config, read for the disk numbers already taken (efidisk0, tpmstate0, ...). */
  vmConf?: Record<string, unknown> | null
  /** Volumes already created by this run, so two disks never claim one name. */
  taken?: AllocatedVolume[]
  onLog?: (message: string) => Promise<void> | void
}

export interface AdoptedFileVolume {
  /** `<storage>:<vmid>/vm-<vmid>-disk-<N>.<fmt>`, the volid to attach. */
  volumeId: string
  /** Absolute path of the volume on the node. */
  volumePath: string
  /** `vm-<vmid>-disk-<N>`, without the extension. */
  volumeName: string
}

/** 60 s: the move itself is a rename, the budget covers a slow SSH round trip. */
const ADOPT_TIMEOUT_MS = 60_000

/**
 * Rename an already-converted image into a PVE volume of `targetStorage`.
 *
 * Returns the volid to attach, or null when the file cannot be adopted safely
 * (different filesystem, destination already there, move refused). A null is not
 * an error: the caller must fall back to `qm disk import`.
 */
export async function adoptFileVolume(args: AdoptFileVolumeArgs): Promise<AdoptedFileVolume | null> {
  const { connectionId, nodeIp, sourcePath, targetStorage, imagesDir, targetVmid, format } = args

  const sourceFormat = args.sourceFormat ?? format
  if (sourceFormat !== format) {
    // Renaming a raw image to `.qcow2` would hand PVE a volume whose header does
    // not match its extension, i.e. a VM that cannot boot. The import converts.
    await args.onLog?.(
      `${sourcePath} is ${sourceFormat} and the volume must be ${format}; a rename cannot convert, importing instead`,
    )
    return null
  }

  const volumeName = nextFreeDiskName(args.vmConf, args.taken ?? [], targetVmid)
  const volumePath = `${imagesDir}/${volumeName}.${format}`

  // One command, so the checks and the move cannot be interleaved with anything
  // else, and so a single SSH round trip decides the outcome:
  //  - `stat -c %d` on both sides: a rename across filesystems is a full copy that
  //    `mv` would perform silently, which is exactly what this module exists to
  //    avoid. Different device => refuse and let the caller import instead.
  //  - `[ ! -e ]` + `mv -n`: never clobber a volume PVE (or an operator) already
  //    owns, belt and braces since the name comes from the VM config we read
  //    earlier and a concurrent allocation could have taken it since.
  const cmd =
    `mkdir -p ${shellEscape(imagesDir)} && ` +
    `[ "$(stat -c %d ${shellEscape(sourcePath)})" = "$(stat -c %d ${shellEscape(imagesDir)})" ] && ` +
    `[ ! -e ${shellEscape(volumePath)} ] && ` +
    `mv -n ${shellEscape(sourcePath)} ${shellEscape(volumePath)} && echo ADOPT_OK`

  const moved = await executeSSH(connectionId, nodeIp, `${cmd} 2>&1`, ADOPT_TIMEOUT_MS)

  if (!moved.success || !(moved.output || "").includes("ADOPT_OK")) {
    const reason = (moved.output || moved.error || "no output").trim()
    await args.onLog?.(
      `Cannot adopt ${sourcePath} as a volume of "${targetStorage}" (${reason}); falling back to qm disk import`,
    )
    return null
  }

  const volumeId = `${targetStorage}:${targetVmid}/${volumeName}.${format}`
  await args.onLog?.(`Adopted ${volumePath} as ${volumeId} (rename, no disk copy)`)

  return { volumeId, volumePath, volumeName }
}

/**
 * Timeout for the `qm disk import` fallback. The command streams the whole disk
 * into PVE storage and routinely runs 5 to 30 minutes on multi-GB disks, so the
 * 30 s executeSSH default would cut the channel mid-import.
 */
const IMPORT_TIMEOUT_MS = 14_400_000

/** The two shapes `qm disk import` uses to report the volume it created. */
const IMPORT_VOLID_PATTERNS = [
  /Successfully imported disk as '(?:unused\d+:)?(.+?)'/,
  /unused\d+:\s*successfully imported disk '(.+?)'/i,
]

export interface ImportOrAdoptArgs extends AdoptFileVolumeArgs {
  /**
   * Last-resort volid resolution when `qm disk import` succeeds but its output
   * cannot be parsed: read the VM config and hand back its highest `unusedN`.
   * Optional, because it needs the PVE client the caller already holds.
   */
  resolveUnusedVolume?: () => Promise<string>
}

export interface ImportedFileVolume {
  /** The volid to attach to the VM. */
  volumeId: string
  /** True when the image became a volume by rename, false when it was copied. */
  adopted: boolean
}

/**
 * Make `sourcePath` a volume of `targetStorage`, by rename when the file already
 * lives on that storage's filesystem, by `qm disk import` otherwise (#292).
 *
 * Either way the source file is consumed: adoption moves it, the import copies it
 * and this function deletes the leftover, so no caller has to remember which of
 * the two happened.
 */
export async function importOrAdoptFileVolume(args: ImportOrAdoptArgs): Promise<ImportedFileVolume> {
  const { connectionId, nodeIp, sourcePath, targetStorage, targetVmid, format } = args

  const adopted = await adoptFileVolume(args)
  if (adopted) return { volumeId: adopted.volumeId, adopted: true }

  const imported = await executeSSH(
    connectionId, nodeIp,
    `qm disk import ${targetVmid} ${shellEscape(sourcePath)} ${shellEscape(targetStorage)} --format ${format} 2>&1`,
    IMPORT_TIMEOUT_MS,
  )

  if (!imported.success) {
    // The command runs with `2>&1`, so PVE's real message is on stdout and `error`
    // only carries a meaningless exit code. Reading `error` first would hide the
    // diagnosis behind "Exit code 255".
    throw new Error(
      `Disk import failed for ${sourcePath}: ${(imported.output || imported.error || "no output").trim()}`,
    )
  }

  // The image is inside the storage now, so the staging copy is dead weight: on a
  // file-based target it is sitting on the very storage the VM will run from.
  await executeSSH(connectionId, nodeIp, `rm -f ${shellEscape(sourcePath)}`)

  const output = imported.output || ""
  for (const pattern of IMPORT_VOLID_PATTERNS) {
    const match = pattern.exec(output)
    if (match?.[1]) return { volumeId: match[1], adopted: false }
  }

  // PVE changed the wording again. The volume exists, so find it rather than fail
  // the migration: the VM config lists it as `unusedN` until we attach it.
  await args.onLog?.(`Could not parse the import output, reading the VM config to find the imported disk`)
  const resolved = (await args.resolveUnusedVolume?.()) || ""
  if (resolved) return { volumeId: resolved, adopted: false }

  // Last resort: the name `qm disk import` allocates is the first free disk index,
  // which is what nextFreeDiskName just computed for the adoption attempt.
  const guessed = nextFreeDiskName(args.vmConf, args.taken ?? [], targetVmid)
  await args.onLog?.(`Falling back to the expected volume name ${targetStorage}:${targetVmid}/${guessed}.${format}`)
  return { volumeId: `${targetStorage}:${targetVmid}/${guessed}.${format}`, adopted: false }
}
