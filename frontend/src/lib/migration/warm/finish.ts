import { pveFetch } from "@/lib/proxmox/client"
import type { AllocatedVolume } from "../pvesm-alloc"
import { pveSetVmConfig } from "../pve-vm-config"
import { convertDisksToQcow2 } from "../qcow2-convert"
import { scanBlockChecksums } from "./checksum-detector"
import { updateJob, appendLog } from "./job-control"

/**
 * Attach the copied volumes to the target VM, optionally start it, then run the
 * opt-in qcow2 conversion. The attach is fatal (never boot a VM with unattached
 * disks); the conversion never fails the migration.
 */
export async function attachDisksAndBoot(a: {
  jobId: string; pveConn: any; node: string; vmid: number; diskCount: number; bootDiskSlot: string
  allocatedVolumes: AllocatedVolume[]; startAfterMigration: boolean; convertDisksToQcow2: boolean; targetStorage: string
}): Promise<void> {
  const { jobId, pveConn, node, vmid, diskCount, bootDiskSlot, allocatedVolumes, startAfterMigration, targetStorage } = a
  await appendLog(jobId, "Attaching target disks…")

  const reconfig = new URLSearchParams()
  const slots: string[] = []
  for (let i = 0; i < diskCount; i++) {
    const slot = i === 0 ? bootDiskSlot : `scsi${i}`
    slots.push(slot)
    reconfig.set(slot, allocatedVolumes[i].volumeId)
  }
  reconfig.set("boot", `order=${slots[0]}`)
  try {
    await pveSetVmConfig(pveConn, node, vmid, reconfig)
  } catch (e: any) {
    // Attach is fatal at cutover (section 8): do NOT start a VM with unattached disks.
    throw new Error(`FATAL: could not attach target disks at cutover: ${e?.message || e}`)
  }
  for (const v of allocatedVolumes) v.attached = true
  await appendLog(jobId, `Attached ${diskCount} disk(s); boot order ${slots[0]}`, "success")

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
  jobId: string; connectionId: string; nodeIp: string; diskIndex: number; dev: string
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
