/**
 * Locate a Hyper-V VM's disk files on the mounted SMB share before virt-v2v
 * runs. The dialog derives `/mnt/hyperv/...` paths from what the host reports,
 * but the share may point elsewhere than expected (older connections mapped
 * the basename only, users move disks, shares get re-created). So each path is
 * checked on the node and, when missing, searched by file name under the
 * mount. Ambiguity is an error: silently picking one of two same-named VHDX
 * files would migrate the wrong VM.
 */

import { HYPERV_MOUNT_ROOT, hypervDiskBasename } from "@/lib/hyperv/diskPaths"
import { shellEscape } from "@/lib/ssh/exec"

export interface HypervDiskExecResult {
  success: boolean
  output?: string
}

export type HypervDiskExec = (command: string) => Promise<HypervDiskExecResult>

export interface HypervDiskResolution {
  /** Paths to hand to virt-v2v, same order as the input. */
  paths: string[]
  /** One line per path that had to be relocated, for the job log. */
  notes: string[]
}

const DISK_GLOB = String.raw`\( -iname "*.vhdx" -o -iname "*.vhd" -o -iname "*.avhdx" \)`

/**
 * The orchestrator allowlist admits `find /mnt/hyperv ` by prefix, so the
 * mount root goes on the command line bare when it is a plain path; quoting it
 * would push every scan onto the ssh2 fallback.
 */
function findRoot(mountRoot: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(mountRoot) ? mountRoot : shellEscape(mountRoot)
}

function lines(output: string | undefined): string[] {
  return (output || "").split("\n").map(l => l.trim()).filter(l => l.startsWith("/"))
}

export async function resolveHypervDiskPaths(
  requested: string[],
  exec: HypervDiskExec,
  mountRoot: string = HYPERV_MOUNT_ROOT,
): Promise<HypervDiskResolution> {
  const paths: string[] = []
  const notes: string[] = []

  for (const requestedPath of requested) {
    const exists = await exec(`test -f ${shellEscape(requestedPath)} && echo yes || echo no`)
    if (exists.output?.trim() === "yes") {
      paths.push(requestedPath)
      continue
    }

    const fileName = hypervDiskBasename(requestedPath)
    const found = await exec(
      `find ${findRoot(mountRoot)} -type f -iname ${shellEscape(fileName)} 2>/dev/null || true`,
    )
    const candidates = lines(found.output)

    if (candidates.length === 1) {
      paths.push(candidates[0])
      notes.push(`${requestedPath} not found, using ${candidates[0]}`)
      continue
    }

    if (candidates.length > 1) {
      throw new Error(
        `Several files named ${fileName} exist on the Hyper-V share (${candidates.join(", ")}). ` +
        `Enter the exact path of the disk to migrate in the VHDX Disk Paths field.`,
      )
    }

    const inventory = await exec(
      `find ${findRoot(mountRoot)} -type f ${DISK_GLOB} 2>/dev/null | head -40 || true`,
    )
    const available = lines(inventory.output)
    const hint = available.length > 0
      ? `Disk files visible on the share: ${available.join(", ")}`
      : `No VHDX/VHD file is visible on the share at all: check that the SMB share exposes the folder holding the VM disks.`
    throw new Error(`Disk file not found on the Hyper-V share: ${requestedPath} (${fileName} is nowhere under ${mountRoot}). ${hint}`)
  }

  return { paths, notes }
}
