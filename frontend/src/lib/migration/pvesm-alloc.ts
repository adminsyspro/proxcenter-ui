import { executeSSH, shellEscape } from "@/lib/ssh/exec"

export interface AllocateAndResolveResult {
  volumeId: string
  devicePath: string
}

/**
 * Allocate a block volume on PVE and return its device path.
 *
 * Wraps `pvesm alloc` + `pvesm path` and handles the output formats every
 * storage plugin emits, including LVM on iSCSI multipath which prints the
 * resulting block device path (`'/dev/<vg>/<lv>'`) instead of the volume ID
 * (`'<storage>:<volname>'`). Feeding the device path back into `pvesm path`
 * fails (it expects `STORAGE:VOLNAME`), so we detect that case and skip the
 * second SSH call entirely.
 *
 * Caller is responsible for cleanup via `pvesm free <volumeId>` on error.
 */
export async function allocateBlockVolumeAndResolvePath(
  connectionId: string,
  nodeIp: string,
  targetStorage: string,
  targetVmid: number | string,
  volName: string,
  sizeKB: number,
): Promise<AllocateAndResolveResult> {
  const allocResult = await executeSSH(
    connectionId,
    nodeIp,
    `pvesm alloc ${shellEscape(targetStorage)} ${targetVmid} ${shellEscape(volName)} ${sizeKB} 2>&1`,
  )

  if (!allocResult.success || !allocResult.output?.trim()) {
    throw new Error(`Failed to allocate volume: ${allocResult.error || allocResult.output}`)
  }

  const allocOutput = allocResult.output.trim()

  // pvesm alloc output varies by plugin:
  //   - dir/NFS: "successfully created 'storage:vmid/vm-vmid-disk-N.qcow2'"
  //   - LVM:     "successfully created 'storage:vm-vmid-disk-N'"
  //   - Ceph:    "successfully created 'storage:vm-vmid-disk-N'"
  //   - LVM on iSCSI multipath: prints '/dev/<vg>/<lv>' between quotes
  //     instead of the volume ID — calling `pvesm path` on that fails.
  const quotedMatch = allocOutput.match(/'([^']+)'/)
  const captured = quotedMatch ? quotedMatch[1] : allocOutput

  if (captured.startsWith("/dev/")) {
    return {
      volumeId: `${targetStorage}:${volName}`,
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
    throw new Error(`Failed to resolve device path for ${volumeId}: ${pathResult.error}`)
  }

  return { volumeId, devicePath: pathResult.output.trim() }
}
