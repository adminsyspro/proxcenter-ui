import { pveFetch } from "@/lib/proxmox/client"
import { keepTargetVm, type AllocatedVolume } from "../pvesm-alloc"
import { destroyPveVm, pveSetVmConfig } from "../pve-vm-config"
import { convertDisksToQcow2 } from "../qcow2-convert"
import { scanBlockChecksums } from "./checksum-detector"
import { updateJob, appendLog } from "./job-control"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"
import { executeSSH, shellEscape } from "@/lib/ssh/exec"

/**
 * Attach the copied volumes to the target VM, optionally start it, then run the
 * opt-in qcow2 conversion. The attach is fatal (never boot a VM with unattached
 * disks); the conversion never fails the migration.
 */
export async function attachDisksAndBoot(a: {
  jobId: string; pveConn: any; node: string; vmid: number; diskCount: number
  /** Target slot per disk and the boot slot, both from the hardware mapper (IDE/SATA sources keep their bus). */
  diskSlots: string[]; bootDiskSlot: string
  allocatedVolumes: AllocatedVolume[]; startAfterMigration: boolean; convertDisksToQcow2: boolean; targetStorage: string
}): Promise<void> {
  const { jobId, pveConn, node, vmid, diskCount, diskSlots, bootDiskSlot, allocatedVolumes, startAfterMigration, targetStorage } = a
  await appendLog(jobId, "Attaching target disks…")

  const reconfig = new URLSearchParams()
  const slots: string[] = []
  for (let i = 0; i < diskCount; i++) {
    const slot = diskSlots[i] ?? (i === 0 ? bootDiskSlot : `scsi${i}`)
    slots.push(slot)
    reconfig.set(slot, allocatedVolumes[i].volumeId)
  }
  reconfig.set("boot", `order=${bootDiskSlot}`)
  try {
    await pveSetVmConfig(pveConn, node, vmid, reconfig)
  } catch (e: any) {
    // Attach is fatal at cutover (section 8): do NOT start a VM with unattached disks.
    throw new Error(`FATAL: could not attach target disks at cutover: ${e?.message || e}`)
  }
  for (const v of allocatedVolumes) v.attached = true
  await appendLog(jobId, `Attached ${diskCount} disk(s) as ${slots.join(", ")}; boot order ${bootDiskSlot}`, "success")

  if (startAfterMigration) {
    await pveFetch<any>(pveConn, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`, { method: "POST" })
    await appendLog(jobId, "Target VM started", "success")
  }

  // Post-cutover qcow2 conversion (#595): runs after the disks are attached
  // and after the optional start — on a running VM PVE does move_disk as a
  // live drive-mirror, no extra downtime. The helper gates itself (opt-in,
  // storage default format, free space) and NEVER throws: a conversion
  // problem leaves the disks raw, not the migration failed.
  await convertDisksToQcow2({
    enabled: a.convertDisksToQcow2,
    conn: pveConn, node, vmid,
    targetStorage, volumes: allocatedVolumes,
    log: (m, l) => appendLog(jobId, m, l),
    setPhase: p => updateJob(jobId, "converting_disks", { progress: p }),
  })
}

/**
 * Sampled first-block checksum of one disk, source vs target (defense in depth,
 * never a hard failure). `openReader` exposes the source disk as a block device
 * on the node; the source-specific reader stays with the caller.
 */
export async function verifySampledFirstBlock(a: {
  jobId: string; connectionId: string; nodeIp: SshTarget; diskIndex: number; dev: string
  openReader: () => Promise<{ nbdDev: string; close: () => Promise<void> }>
}): Promise<void> {
  const { jobId, connectionId, nodeIp, diskIndex: i, dev } = a
  try {
    const reader = await a.openReader()
    try {
      const [src, dst] = await Promise.all([
        scanBlockChecksums(connectionId, nodeIp, reader.nbdDev, 256 * 1024 * 1024, 1),
        scanBlockChecksums(connectionId, nodeIp, dev, 256 * 1024 * 1024, 1),
      ])
      if (src[0] && dst[0] && src[0] !== dst[0]) {
        await appendLog(jobId, `Verify: disk ${i} first-block checksum differs (source vs target) — investigate before relying on the copy`, "warn")
      } else {
        await appendLog(jobId, `Verify: disk ${i} sampled block matches`, "success")
      }
    } finally {
      await reader.close().catch(() => {})
    }
  } catch (e: any) {
    await appendLog(jobId, `Verify (sampled) skipped on disk ${i}: ${e?.message || e}`, "warn")
  }
}

/**
 * Failure cleanup for the target VM a warm job created (roadmap#57).
 *
 * Before any copy completes, the VM is an empty shell: leaving it behind blocks
 * the VMID, so a retry with the same target VMID fails until someone removes it
 * by hand. Once a volume holds a completed copy the VM is kept, together with
 * that volume (#612), and the log says so. Never throws.
 */
export async function removeTargetVmOnFailure(a: {
  jobId: string; pveConn: any; node: string; vmid: number; allocatedVolumes: AllocatedVolume[]
}): Promise<void> {
  const { jobId, pveConn, node, vmid, allocatedVolumes } = a
  if (keepTargetVm(allocatedVolumes)) {
    await appendLog(jobId, `Kept target VM ${vmid}: it holds a completed copy of the source disk. Remove it with 'qm destroy ${vmid} --purge --destroy-unreferenced-disks' if you do not want it.`, "warn").catch(() => {})
    return
  }
  try {
    await destroyPveVm(pveConn, node, vmid)
    await appendLog(jobId, `Removed target VM ${vmid} created by this migration`, "warn").catch(() => {})
  } catch (e: any) {
    const msg = e?.message || String(e)
    // PVE answers a missing guest config with a 500: nothing is left behind.
    if (/does not exist/i.test(msg)) return
    await appendLog(jobId, `Could not remove target VM ${vmid}: ${msg}. Remove it with 'qm destroy ${vmid} --purge --destroy-unreferenced-disks' before retrying with the same VMID.`, "warn").catch(() => {})
  }
}

/**
 * Release the kernel RBD mappings the copy used (roadmap#57).
 *
 * The cold pipelines unmap once they have written a disk; warm only did it for a
 * volume it freed after a failure, so every successful warm migration to Ceph,
 * and every volume kept after one (#612), left a `/dev/rbdN` behind on the node.
 * Call it before the attach: on a KRBD storage PVE maps the image itself when
 * the VM starts, and `rbd unmap` refuses a device still in use anyway. Never throws.
 */
export async function unmapTargetVolumes(connectionId: string, nodeIp: SshTarget, allocatedVolumes: AllocatedVolume[]): Promise<void> {
  if (!nodeIp) return
  for (const v of allocatedVolumes) {
    if (!v.rbdMapped || !v.devicePath) continue
    const r = await executeSSH(connectionId, nodeIp, `rbd unmap ${shellEscape(v.devicePath)} 2>/dev/null`).catch(() => null)
    if (r?.success) v.rbdMapped = false
  }
}
