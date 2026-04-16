/**
 * ESXi → Proxmox VE migration pipeline
 *
 * Flow:
 * 1. Pre-flight checks (ESXi reachable, PVE reachable, VM config, disk space)
 * 2. Retrieve full VM config from ESXi via SOAP
 * 3. Create empty VM shell on Proxmox via API
 * 4. For each disk:
 *    - Block storage (LVM, ZFS, RBD): pvesm alloc → stream raw data directly to device (no temp files)
 *    - File-based storage (dir, NFS, CIFS): download to storage path → convert → qm disk import
 * 5. Attach disks, configure boot order
 * 6. Optionally start the VM
 *
 * Data flows ESXi → Proxmox directly (not through ProxCenter).
 * ProxCenter orchestrates via SSH commands + PVE API.
 */

import { getTenantPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { isFileBasedStorage } from "@/lib/proxmox/storage"
import { executeSSH } from "@/lib/ssh/exec"
import { soapLogin, soapLogout, soapGetVmConfig, parseVmConfig, buildVmdkDownloadUrl, buildVmdkDescriptorUrl, extractProp, soapCreateSnapshot, soapRemoveAllSnapshots, soapPowerOffVm, soapExportVm, soapWaitForNfcLease, soapNfcLeaseProgress, soapNfcLeaseComplete, soapNfcLeaseAbort } from "@/lib/vmware/soap"
import { mapEsxiToPveConfig, isWindowsVm } from "./configMapper"
import type { SoapSession, EsxiVmConfig, EsxiDiskInfo, NfcLeaseDeviceUrl } from "@/lib/vmware/soap"

type MigrationStatus = "pending" | "preflight" | "creating_vm" | "transferring" | "configuring" | "completed" | "failed" | "cancelled"

interface MigrationConfig {
  sourceConnectionId: string
  sourceVmId: string
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  networkBridge: string
  startAfterMigration: boolean
  migrationType?: "cold" | "live" | "sshfs_boot"
  transferMode?: "https" | "sshfs" | "auto"
}

interface LogEntry {
  ts: string
  msg: string
  level: "info" | "success" | "warn" | "error"
}

let cancelledJobs = new Set<string>()

export function cancelMigrationJob(jobId: string) {
  cancelledJobs.add(jobId)
}

// Per-job tenant-scoped prisma instances (set at pipeline start, used by helpers)
const jobPrisma = new Map<string, any>()

function getPrismaForJob(jobId: string) {
  return jobPrisma.get(jobId)
}

async function updateJob(id: string, status: MigrationStatus, extra: Record<string, any> = {}) {
  const prisma = getPrismaForJob(id)
  const data: any = {
    status,
    currentStep: status,
    ...(status === "completed" ? { completedAt: new Date() } : {}),
    ...extra,
  }
  await prisma.migrationJob.update({ where: { id }, data })
}

async function appendLog(id: string, msg: string, level: LogEntry["level"] = "info") {
  const prisma = getPrismaForJob(id)
  const job = await prisma.migrationJob.findUnique({ where: { id }, select: { logs: true, progress: true } })
  const logs: LogEntry[] = job?.logs ? JSON.parse(job.logs) : []
  logs.push({ ts: new Date().toISOString(), msg, level, progress: job?.progress ?? 0 } as any)
  await prisma.migrationJob.update({ where: { id }, data: { logs: JSON.stringify(logs) } })
}

function isCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId)
}

/** Wait for a PVE task to complete */
async function waitForPveTask(
  conn: { baseUrl: string; apiToken: string; insecureDev: boolean; id: string },
  node: string,
  upid: string,
  timeoutMs = 300000
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`
    )
    if (status?.status === "stopped") {
      if (status.exitstatus === "OK") return
      throw new Error(`PVE task failed: ${status.exitstatus || "unknown error"}`)
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error(`PVE task timed out after ${timeoutMs / 1000}s`)
}

/**
 * Find the IP address of a Proxmox node for SSH access.
 * Tries managed hosts first, then extracts from baseUrl.
 */
async function getNodeIpForMigration(db: any, connectionId: string, nodeName: string, baseUrl: string): Promise<string> {
  // Check managed hosts
  const host = await db.managedHost.findFirst({
    where: { connectionId, node: nodeName, enabled: true },
    select: { ip: true, sshAddress: true },
  })
  if (host?.sshAddress) return host.sshAddress
  if (host?.ip) return host.ip

  // Fallback: extract from baseUrl
  try {
    const url = new URL(baseUrl)
    return url.hostname
  } catch {
    throw new Error(`Cannot determine IP for node ${nodeName}`)
  }
}

/** Power off VM with fallback to manual power off for free ESXi license */
async function powerOffSourceVm(jobId: string, session: SoapSession, vmid: string): Promise<void> {
  try {
    await soapPowerOffVm(session, vmid)
    await appendLog(jobId, "Source VM powered off", "success")
  } catch (e: any) {
    const msg = e?.message || String(e)
    if (msg.includes("InvalidPowerState") || msg.includes("poweredOff")) {
      await appendLog(jobId, "VM was already powered off", "info")
    } else if (msg.includes("license") || msg.includes("prohibits")) {
      await appendLog(jobId, "Cannot power off via API (ESXi license restriction). Please power off the VM manually now.", "warn")
      let powered = true
      for (let attempt = 0; attempt < 24; attempt++) {
        await new Promise(r => setTimeout(r, 5000))
        const xml = await soapGetVmConfig(session, vmid)
        if (extractProp(xml, "runtime.powerState") === "poweredOff") { powered = false; break }
      }
      if (powered) {
        await appendLog(jobId, "VM still running after 120s — proceeding anyway (disk image may be crash-consistent)", "warn")
      } else {
        await appendLog(jobId, "VM powered off manually", "success")
      }
    } else {
      throw e
    }
  }
}

/**
 * Main migration pipeline — runs async after HTTP response
 */
export async function runMigrationPipeline(jobId: string, config: MigrationConfig, tenantId = 'default'): Promise<void> {
  // Register tenant-scoped prisma for this job
  const prisma = getTenantPrisma(tenantId)
  jobPrisma.set(jobId, prisma)

  let soapSession: SoapSession | null = null
  let targetVmid: number | null = null
  let storageTempDir = ''

  try {
    // ── STEP 0: Pre-flight ──
    await updateJob(jobId, "preflight")
    await appendLog(jobId, "Starting pre-flight checks...")

    // Get ESXi connection (include SSH fields for live migration via dd)
    const esxiConn = await prisma.connection.findUnique({
      where: { id: config.sourceConnectionId },
      select: {
        id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true,
        sshEnabled: true, sshPort: true, sshUser: true, sshAuthMethod: true, sshKeyEnc: true, sshPassEnc: true,
      },
    })
    if (!esxiConn || esxiConn.type !== "vmware") {
      throw new Error("ESXi connection not found")
    }

    const creds = decryptSecret(esxiConn.apiTokenEnc)
    const colonIdx = creds.indexOf(":")
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : "root"
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const esxiUrl = esxiConn.baseUrl.replace(/\/$/, "")

    // Get PVE connection
    const pveConn = await getConnectionById(config.targetConnectionId)
    await appendLog(jobId, `Connecting to ESXi host ${esxiUrl}...`)

    // SOAP login
    soapSession = await soapLogin(esxiUrl, username, password, esxiConn.insecureTLS)
    await appendLog(jobId, `Authenticated as ${username}`, "success")

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── STEP 1: Get VM config from ESXi ──
    await appendLog(jobId, `Retrieving VM configuration for "${config.sourceVmId}"...`)
    const vmXml = await soapGetVmConfig(soapSession, config.sourceVmId)
    const vmConfig = parseVmConfig(vmXml)

    await appendLog(
      jobId,
      `VM config: ${vmConfig.numCPU} vCPU, ${(vmConfig.memoryMB / 1024).toFixed(1)} GB RAM, ${vmConfig.disks.length} disk(s), firmware=${vmConfig.firmware}`,
      "success"
    )

    await updateJob(jobId, "preflight", {
      sourceVmName: vmConfig.name,
      totalDisks: vmConfig.disks.length,
      totalBytes: BigInt(vmConfig.disks.reduce((sum, d) => sum + d.capacityBytes, 0)),
    })

    // Handle VM power state based on migration type
    const isLive = config.migrationType === "live"
    const isSshfsBoot = config.migrationType === "sshfs_boot"

    // Check if ESXi SSH is available (used as fallback if HTTPS download fails)
    const esxiSshAvailable = esxiConn.sshEnabled && (esxiConn.sshKeyEnc || esxiConn.sshPassEnc)

    if (isSshfsBoot && !esxiSshAvailable) {
      throw new Error("SSHFS Boot migration requires SSH to be configured on the ESXi connection.")
    }

    if (vmConfig.powerState === "poweredOn") {
      if (isLive) {
        await appendLog(jobId, "VM is running - live migration will clone disks on ESXi via vmkfstools, then transfer (minimal downtime)", "info")
      } else if (isSshfsBoot) {
        await appendLog(jobId, "VM is powered on - powering off for SSHFS Boot migration (VM will boot on Proxmox from remote disks within seconds)...", "warn")
        await powerOffSourceVm(jobId, soapSession!, config.sourceVmId)
      } else {
        // Cold migration: VM must be off
        await appendLog(jobId, "VM is powered on - powering off for offline migration...", "warn")
        await powerOffSourceVm(jobId, soapSession!, config.sourceVmId)
      }
    }

    // Check snapshots (in live mode, existing snapshots are handled later - we remove them before creating ours)
    if (vmConfig.snapshotCount > 0 && !isLive) {
      await appendLog(jobId, `Warning: VM has ${vmConfig.snapshotCount} snapshot(s). Disk data will be from current state.`, "warn")
    }

    // Check disks have datastore info
    for (const disk of vmConfig.disks) {
      if (!disk.datastoreName || !disk.relativePath) {
        throw new Error(`Disk "${disk.label}" has no datastore path: ${disk.fileName}`)
      }
    }

    // Check for vSAN datastores — only supported with SSHFS transfer mode
    const vsanDisks = vmConfig.disks.filter(d => d.datastoreName.toLowerCase().includes('vsan'))
    if (vsanDisks.length > 0 && config.transferMode !== 'sshfs' && config.transferMode !== 'auto') {
      const dsNames = [...new Set(vsanDisks.map(d => d.datastoreName))].join(', ')
      throw new Error(
        `vSAN datastores require SSHFS transfer mode (found: ${dsNames}). ` +
        `SSHFS mounts the ESXi datastore via SSH, which works transparently with vSAN. ` +
        `Please select "SSHFS" or "Auto" transfer mode, or move the VM to a VMFS/NFS datastore.`
      )
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // Verify PVE SSH connectivity
    const nodeIp = await getNodeIpForMigration(prisma, config.targetConnectionId, config.targetNode, pveConn.baseUrl)
    await appendLog(jobId, `Testing SSH to Proxmox node ${config.targetNode} (${nodeIp})...`)
    const sshTest = await executeSSH(config.targetConnectionId, nodeIp, "echo ok")
    if (!sshTest.success) {
      throw new Error(`SSH to Proxmox node failed: ${sshTest.error}`)
    }
    await appendLog(jobId, "SSH connectivity OK", "success")

    // Check sshpass on PVE node (needed when ESXi auth is password-based, for nested SSH)
    const esxiUsesPassword = esxiConn.sshAuthMethod !== "key" && esxiConn.sshPassEnc && !esxiConn.sshKeyEnc
    if (esxiSshAvailable && esxiUsesPassword) {
      const sshpassCheck = await executeSSH(config.targetConnectionId, nodeIp, "which sshpass")
      if (!sshpassCheck.success || !sshpassCheck.output?.trim()) {
        throw new Error("sshpass is not installed on the Proxmox node. Install it with: apt install sshpass")
      }
      await appendLog(jobId, "sshpass available on PVE node", "success")
    }

    // Determine effective transfer mode
    // "sshfs" requires ESXi SSH and sshfs on PVE node
    // "sshfs_boot" always uses SSHFS
    // "https" uses VMware API (no SSHFS needed)
    // "auto" uses SSHFS when available (required for vSAN — HTTPS can't serve vSAN objects)
    const requestedTransferMode = config.transferMode || "sshfs"
    const hasVsanDisks = vmConfig.disks.some(d => d.datastoreName.toLowerCase().includes('vsan'))
    let useSSHFS = false
    if (isSshfsBoot || requestedTransferMode === "sshfs" || (requestedTransferMode === "auto" && esxiSshAvailable)) {
      if (!esxiSshAvailable) {
        throw new Error("SSHFS transfer mode requires SSH to be configured on the ESXi connection. Please enable SSH in the connection settings.")
      }
      useSSHFS = true
    }
    // vSAN requires SSHFS — HTTPS /folder/ endpoint can't serve vSAN object-backed disks reliably
    if (hasVsanDisks && !useSSHFS) {
      throw new Error(
        `vSAN datastores require SSHFS transfer mode but SSH is not available. ` +
        `Please enable SSH on the ESXi connection and select "SSHFS" or "Auto" transfer mode.`
      )
    }

    // Check sshfs binary on PVE node when SSHFS mode is active
    let sshfsMountPath = ''
    if (useSSHFS) {
      const sshfsCheck = await executeSSH(config.targetConnectionId, nodeIp, "which sshfs")
      if (!sshfsCheck.success || !sshfsCheck.output?.trim()) {
        throw new Error("sshfs is not installed on the Proxmox node. Install it with: apt install sshfs")
      }
      sshfsMountPath = `/tmp/proxcenter-sshfs-${jobId}`
      await appendLog(jobId, `Transfer mode: SSHFS (mount ESXi datastore on PVE node)`, "success")
    }
    if (!useSSHFS) {
      await appendLog(jobId, `Transfer mode: HTTPS (download via ESXi API)`, "info")
    }

    // Check target storage
    const storageStatus = await pveFetch<any>(
      pveConn,
      `/nodes/${encodeURIComponent(config.targetNode)}/storage/${encodeURIComponent(config.targetStorage)}/status`
    )
    const freeBytes = (storageStatus?.avail || 0)
    const neededBytes = vmConfig.disks.reduce((sum, d) => sum + d.capacityBytes, 0)
    await appendLog(jobId, `Target storage "${config.targetStorage}": ${(freeBytes / 1073741824).toFixed(1)} GB free, need ${(neededBytes / 1073741824).toFixed(1)} GB`)
    if (freeBytes < neededBytes * 1.1) {
      throw new Error(`Insufficient disk space on "${config.targetStorage}": ${(freeBytes / 1073741824).toFixed(1)} GB free, need ${(neededBytes / 1073741824).toFixed(1)} GB`)
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── STEP 2: Allocate VMID & Create VM shell on Proxmox ──
    await updateJob(jobId, "creating_vm")
    await appendLog(jobId, "Allocating VMID on Proxmox cluster...")

    targetVmid = Number(await pveFetch<number | string>(pveConn, "/cluster/nextid"))
    await updateJob(jobId, "creating_vm", { targetVmid })
    await appendLog(jobId, `Allocated VMID ${targetVmid}`)

    const pveParams = mapEsxiToPveConfig(vmConfig, targetVmid, config.targetStorage, config.networkBridge)
    await appendLog(jobId, `Creating VM: ${pveParams.name} (${pveParams.ostype}, ${pveParams.bios}, ${pveParams.scsihw})...`)

    // Build URLSearchParams for VM creation (without disks — we import them separately)
    const createBody = new URLSearchParams({
      vmid: String(pveParams.vmid),
      name: pveParams.name,
      ostype: pveParams.ostype,
      cores: String(pveParams.cores),
      sockets: String(pveParams.sockets),
      memory: String(pveParams.memory),
      cpu: pveParams.cpu,
      scsihw: pveParams.scsihw,
      bios: pveParams.bios,
      machine: pveParams.machine,
      net0: pveParams.net0,
      agent: pveParams.agent,
      serial0: "socket",
    })
    if (pveParams.efidisk0) {
      createBody.set("efidisk0", pveParams.efidisk0)
    }

    const createResult = await pveFetch<any>(
      pveConn,
      `/nodes/${encodeURIComponent(config.targetNode)}/qemu`,
      { method: "POST", body: createBody }
    )
    if (createResult) {
      await waitForPveTask(pveConn, config.targetNode, String(createResult))
    }
    await appendLog(jobId, `VM ${targetVmid} created on ${config.targetNode}`, "success")

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── STEP 3: Transfer & import disks ──
    await updateJob(jobId, "transferring", { progress: 0 })

    // Determine storage type for import strategy
    const storageConfig = await pveFetch<any>(pveConn, `/storage/${encodeURIComponent(config.targetStorage)}`)
    const storageType = storageConfig?.type || "dir"
    const isFileBased = isFileBasedStorage(storageType)
    const importFormat = isFileBased ? "qcow2" : "raw"

    // Resolve temp directory: use target storage path instead of /tmp
    // For file-based storage, temp files go on the storage itself (plenty of space)
    // For block storage, we stream directly to the device (no temp files needed)
    if (isFileBased) {
      const storagePath = storageConfig?.path || '/var/lib/vz'
      storageTempDir = `${storagePath}/images/${targetVmid}`
      await executeSSH(config.targetConnectionId, nodeIp, `mkdir -p "${storageTempDir}"`)
      await appendLog(jobId, `Temp directory: ${storageTempDir} (on target storage)`)
    }

    // Track allocated block volumes (for cleanup on error)
    const allocatedVolumes: { volumeId: string, devicePath: string, rbdMapped?: boolean }[] = []

    // Allocate a raw volume on block storage and return the device path
    async function allocateBlockVolume(sizeBytes: number): Promise<{ volumeId: string, devicePath: string }> {
      // Find next available disk number by checking VM config + already allocated volumes
      const vmConf = await pveFetch<Record<string, any>>(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`)
      let maxDiskNum = -1
      for (const val of Object.values(vmConf || {})) {
        if (typeof val === 'string') {
          const m = (val as string).match(/vm-\d+-disk-(\d+)/)
          if (m) maxDiskNum = Math.max(maxDiskNum, Number.parseInt(m[1]))
        }
      }
      for (const av of allocatedVolumes) {
        const m = av.volumeId.match(/disk-(\d+)/)
        if (m) maxDiskNum = Math.max(maxDiskNum, Number.parseInt(m[1]))
      }
      const diskNum = maxDiskNum + 1
      const sizeKB = Math.ceil(sizeBytes / 1024)
      const volName = `vm-${targetVmid}-disk-${diskNum}`

      const allocResult = await executeSSH(config.targetConnectionId, nodeIp,
        `pvesm alloc "${config.targetStorage}" ${targetVmid} "${volName}" ${sizeKB} 2>&1`)
      if (!allocResult.success || !allocResult.output?.trim()) {
        throw new Error(`Failed to allocate volume: ${allocResult.error || allocResult.output}`)
      }
      // pvesm alloc output varies: "CephStoragePool:vm-201-disk-0" or "successfully created 'CephStoragePool:vm-201-disk-0'"
      const allocOutput = allocResult.output.trim()
      const quotedMatch = allocOutput.match(/'([^']+)'/)
      const volumeId = quotedMatch ? quotedMatch[1] : allocOutput

      const pathResult = await executeSSH(config.targetConnectionId, nodeIp,
        `pvesm path "${volumeId}" 2>&1`)
      if (!pathResult.success || !pathResult.output?.trim()) {
        throw new Error(`Failed to resolve device path for ${volumeId}: ${pathResult.error}`)
      }
      let devicePath = pathResult.output.trim()

      // RBD/Ceph: pvesm path returns "rbd:pool/image:conf=..." — not a block device
      // We need to rbd map it to get a /dev/rbdN device
      let rbdMapped = false
      if (devicePath.startsWith('rbd:')) {
        const rbdSpec = devicePath.split(':')[1] // "CephStoragePool/vm-201-disk-0"
        if (!rbdSpec) throw new Error(`Cannot parse RBD path: ${devicePath}`)
        const mapResult = await executeSSH(config.targetConnectionId, nodeIp,
          `rbd map "${rbdSpec}" 2>&1`)
        if (!mapResult.success || !mapResult.output?.trim()) {
          throw new Error(`Failed to rbd map ${rbdSpec}: ${mapResult.error || mapResult.output}`)
        }
        devicePath = mapResult.output.trim() // e.g. /dev/rbd0
        rbdMapped = true
        await appendLog(jobId, `RBD mapped ${rbdSpec} → ${devicePath}`)
      }

      const result = { volumeId, devicePath, rbdMapped }
      allocatedVolumes.push(result)
      await appendLog(jobId, `Allocated volume ${volumeId} → ${devicePath}`)
      return result
    }

    // Attach a pre-allocated block volume to a SCSI slot
    async function attachBlockDisk(i: number, volumeId: string) {
      const scsiSlot = `scsi${i}`
      const attachBody = new URLSearchParams({ [scsiSlot]: volumeId })
      try {
        await pveFetch<any>(
          pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
          { method: "PUT", body: attachBody }
        )
        await appendLog(jobId, `Disk ${i + 1} attached as ${scsiSlot} (${volumeId})`, "success")
      } catch (attachErr: any) {
        await appendLog(jobId, `Warning: Could not auto-attach ${scsiSlot}: ${attachErr.message}`, "warn")
      }
    }

    // Helper: stream a disk from ESXi to a pre-allocated block device via HTTPS
    async function streamDiskToBlock(i: number, disk: EsxiDiskInfo, devicePath: string, overrideUrl?: string) {
      const diskSizeGB = (disk.capacityBytes / 1073741824).toFixed(1)
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Streaming "${disk.label}" to block device (${diskSizeGB} GB)...`)

      const soapCookie = soapSession!.cookie
      const safeCookie = soapCookie.replace(/"/g, '')
      const vmdkUrl = overrideUrl || buildVmdkDownloadUrl(esxiUrl, disk)
      await appendLog(jobId, `Download URL: ${vmdkUrl.replace(/\?.*/, '?...')}${overrideUrl ? ' (NFC lease)' : ''}`, "info")

      await updateJob(jobId, "transferring", {
        currentStep: `streaming_disk_${i + 1}`,
        currentDisk: i,
        bytesTransferred: BigInt(0),
        totalBytes: BigInt(disk.capacityBytes),
      })

      const ctrlPrefix = `/tmp/proxcenter-mig-${jobId}-ctrl${i}`
      const pidFile = `${ctrlPrefix}.pid`
      const dlScript = `${ctrlPrefix}.dl.sh`
      const progressFile = `${ctrlPrefix}.progress`

      // Build streaming script: curl pipes directly to dd on block device
      // status=progress makes dd write periodic progress to stderr
      await executeSSH(config.targetConnectionId, nodeIp,
        `cat > "${dlScript}" << 'DLEOF'\ncurl -sk --fail -b '${safeCookie}' '${vmdkUrl}' 2>/dev/null | dd of="${devicePath}" bs=4M status=progress 2>"${progressFile}"\nCURL_EXIT=\${PIPESTATUS[0]}\nDD_EXIT=\${PIPESTATUS[1]}\nif [ \$CURL_EXIT -ne 0 ]; then echo \$CURL_EXIT > "${pidFile}.exit"; else echo \$DD_EXIT > "${pidFile}.exit"; fi\nDLEOF`
      )

      const startDl = await executeSSH(config.targetConnectionId, nodeIp,
        `nohup bash "${dlScript}" > /dev/null 2>&1 & echo $!`)
      if (!startDl.success || !startDl.output?.trim()) {
        throw new Error(`Failed to start streaming: ${startDl.error}`)
      }
      const pid = startDl.output.trim()
      await executeSSH(config.targetConnectionId, nodeIp, `echo ${pid} > "${pidFile}"`)

      const totalBytes = disk.capacityBytes
      let transferredBytes = 0
      let transferSpeed = ""
      const startTime = Date.now()

      while (true) {
        if (isCancelled(jobId)) {
          await executeSSH(config.targetConnectionId, nodeIp, `kill ${pid} 2>/dev/null; rm -f "${pidFile}" "${pidFile}.exit" "${dlScript}" "${progressFile}"`)
          throw new Error("Migration cancelled")
        }
        await new Promise(r => setTimeout(r, 3000))

        const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${pidFile}.exit" 2>/dev/null || echo RUNNING`)
        const isRunning = exitCheck.output?.trim() === "RUNNING"

        // Parse dd progress output: "123456789 bytes (123 MB, ...) copied, ..."
        const progressResult = await executeSSH(config.targetConnectionId, nodeIp,
          `tail -c 200 "${progressFile}" 2>/dev/null | tr '\\r' '\\n' | grep -oP '^\\d+' | tail -1 || echo 0`)
        transferredBytes = Number.parseInt(progressResult.output?.trim() || "0", 10) || 0

        const elapsed = (Date.now() - startTime) / 1000
        const speedBps = elapsed > 0 ? transferredBytes / elapsed : 0
        transferSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`

        const diskProgress = totalBytes > 0 ? Math.min(Math.round((transferredBytes / totalBytes) * 100), 99) : 0
        const overallProgress = Math.round((i / vmConfig.disks.length) * 100 + (diskProgress / vmConfig.disks.length))

        await updateJob(jobId, "transferring", {
          bytesTransferred: BigInt(transferredBytes),
          transferSpeed,
          progress: isLive ? Math.round(overallProgress * 0.7) : overallProgress,
        })

        if (!isRunning) {
          const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
          await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${pidFile}" "${pidFile}.exit" "${dlScript}" "${progressFile}"`)
          if (exitCode !== 0) {
            throw new Error(`Streaming failed: curl/dd exit code ${exitCode}`)
          }
          break
        }
      }

      const elapsed = (Date.now() - startTime) / 1000
      await updateJob(jobId, "transferring", { bytesTransferred: BigInt(transferredBytes), transferSpeed })
      await appendLog(jobId, `Streaming complete: ${(transferredBytes / 1073741824).toFixed(1)} GB in ${elapsed.toFixed(0)}s (${transferSpeed})`, "success")

      // Unmap RBD device if we mapped it
      const allocVol = allocatedVolumes.find(v => v.devicePath === devicePath)
      if (allocVol?.rbdMapped) {
        await executeSSH(config.targetConnectionId, nodeIp, `rbd unmap "${devicePath}" 2>/dev/null`).catch(() => {})
      }
    }

    // Helper: stream a disk from ESXi to a pre-allocated block device via SSH dd pipe
    async function streamDiskViaSshToBlock(i: number, disk: EsxiDiskInfo, devicePath: string, needsClone = false) {
      const diskSizeGB = (disk.capacityBytes / 1073741824).toFixed(1)
      const ctrlPrefix = `/tmp/proxcenter-mig-${jobId}-ctrl${i}`
      const { esxiHost, esxiSshPort, esxiSshUser, setupCmd, sshPrefix, cleanupCmd } = buildEsxiSshPrefix(ctrlPrefix)

      const flatPath = disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
      const vmfsPath = `/vmfs/volumes/${disk.datastoreName}/${flatPath}`
      const cloneName = `.proxcenter-clone-${jobId}-disk${i}`
      const cloneVmdkPath = `/vmfs/volumes/${disk.datastoreName}/${cloneName}.vmdk`
      const cloneFlatPath = `/vmfs/volumes/${disk.datastoreName}/${cloneName}-flat.vmdk`

      let downloadPath = vmfsPath
      let cloneCreated = false

      if (needsClone) {
        // Clone VMDK on ESXi using vmkfstools (works on locked/running VMDKs after snapshot)
        await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Cloning "${disk.label}" on ESXi via vmkfstools (${diskSizeGB} GB)...`)
        await updateJob(jobId, "transferring", {
          currentStep: `cloning_disk_${i + 1}`,
          currentDisk: i,
          bytesTransferred: BigInt(0),
          totalBytes: BigInt(disk.capacityBytes),
        })

        try {
          const descriptorPath = `/vmfs/volumes/${disk.datastoreName}/${disk.relativePath}`
          const cloneTmpPrefix = `/tmp/proxcenter-mig-${jobId}-clone${i}`
          const { esxiHost: clHost, esxiSshPort: clPort, esxiSshUser: clUser, setupCmd: clSetup, sshPrefix: clSshPrefix, cleanupCmd: clCleanup } = buildEsxiSshPrefix(cloneTmpPrefix)
          const cloneScript = `${cloneTmpPrefix}.sh`
          const cloneExitFile = `${cloneTmpPrefix}.exit`
          const cloneErrFile = `${cloneTmpPrefix}.stderr`
          const cloneOutFile = `${cloneTmpPrefix}.out`

          const cloneSshCmd = `${clSshPrefix} -p ${clPort} ${clUser}@${clHost} "vmkfstools -i '${descriptorPath}' '${cloneVmdkPath}' -d thin" >"${cloneOutFile}" 2>"${cloneErrFile}"`

          await executeSSH(config.targetConnectionId, nodeIp,
            `cat > "${cloneScript}" << 'CLEOF'\n${clSetup}\n${cloneSshCmd}\nEXIT_CODE=$?\n${clCleanup}\necho $EXIT_CODE > "${cloneExitFile}"\nCLEOF`
          )

          const startClone = await executeSSH(config.targetConnectionId, nodeIp,
            `nohup bash "${cloneScript}" > /dev/null 2>&1 & echo $!`)
          if (!startClone.success || !startClone.output?.trim()) {
            throw new Error(`Failed to start vmkfstools: ${startClone.error}`)
          }

          const cloneStartTime = Date.now()
          while (true) {
            if (isCancelled(jobId)) throw new Error("Migration cancelled")
            if (Date.now() - cloneStartTime > 3600000) throw new Error("vmkfstools clone timed out (1h)")
            await new Promise(r => setTimeout(r, 5000))

            try {
              const sizeCheck = await executeSSH(config.targetConnectionId, nodeIp,
                `${clSetup} && ${clSshPrefix} -p ${clPort} ${clUser}@${clHost} "stat -c %s '${cloneFlatPath}' 2>/dev/null || echo 0" 2>/dev/null`)
              const clonedBytes = Number.parseInt(sizeCheck.output?.trim() || "0", 10) || 0
              if (clonedBytes > 0) {
                const cloneProgress = Math.min(Math.round((clonedBytes / disk.capacityBytes) * 100), 99)
                const elapsed = (Date.now() - cloneStartTime) / 1000
                const speed = elapsed > 0 ? clonedBytes / elapsed : 0
                const speedStr = speed > 1048576 ? `${(speed / 1048576).toFixed(1)} MB/s` : `${(speed / 1024).toFixed(0)} KB/s`
                await updateJob(jobId, "transferring", {
                  currentStep: `cloning_disk_${i + 1}`,
                  bytesTransferred: BigInt(clonedBytes),
                  totalBytes: BigInt(disk.capacityBytes),
                  transferSpeed: `Cloning: ${speedStr}`,
                  progress: Math.round(cloneProgress * 0.3),
                })
              }
            } catch {}

            const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${cloneExitFile}" 2>/dev/null || echo RUNNING`)
            if (exitCheck.output?.trim() === "RUNNING") continue

            const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
            if (exitCode !== 0) {
              const stderrContent = await executeSSH(config.targetConnectionId, nodeIp, `cat "${cloneErrFile}" 2>/dev/null | head -c 500`)
              const errMsg = stderrContent.output?.trim() || "(no output)"
              await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${cloneScript}" "${cloneExitFile}" "${cloneErrFile}" "${cloneOutFile}" "${cloneTmpPrefix}.esxi-key"`)
              throw new Error(`vmkfstools failed (exit ${exitCode}): ${errMsg}`)
            }

            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${cloneScript}" "${cloneExitFile}" "${cloneErrFile}" "${cloneOutFile}" "${cloneTmpPrefix}.esxi-key"`)
            break
          }

          cloneCreated = true
          downloadPath = cloneFlatPath
          const cloneTime = Math.round((Date.now() - cloneStartTime) / 1000)
          await appendLog(jobId, `Clone created on ESXi datastore (${cloneTime}s)`, "success")
        } catch (cloneErr: any) {
          throw new Error(`vmkfstools clone failed: ${cloneErr.message}`)
        }
      }

      // Stream via SSH dd → dd of=block device
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Streaming "${disk.label}" via SSH to block device (${diskSizeGB} GB)...`)
      await appendLog(jobId, `Source path: ${downloadPath}`, "info")

      await updateJob(jobId, "transferring", {
        currentStep: `streaming_disk_${i + 1}`,
        currentDisk: i,
        bytesTransferred: BigInt(0),
        totalBytes: BigInt(disk.capacityBytes),
      })

      const pidFile = `${ctrlPrefix}.pid`
      const dlScript = `${ctrlPrefix}.dl.sh`
      const progressFile = `${ctrlPrefix}.progress`
      const errFile = `${ctrlPrefix}.stderr`
      const sshCmd = `${sshPrefix} -p ${esxiSshPort} ${esxiSshUser}@${esxiHost} "dd if='${downloadPath}' bs=4M" | dd of="${devicePath}" bs=4M status=progress 2>"${progressFile}"`

      await executeSSH(config.targetConnectionId, nodeIp,
        `cat > "${dlScript}" << 'DLEOF'\n${setupCmd}\n${sshCmd}\nSSH_EXIT=\${PIPESTATUS[0]}\nDD_EXIT=\${PIPESTATUS[1]}\n${cleanupCmd}\nif [ \$SSH_EXIT -ne 0 ]; then echo \$SSH_EXIT > "${pidFile}.exit"; else echo \$DD_EXIT > "${pidFile}.exit"; fi\nDLEOF`
      )

      const startDl = await executeSSH(config.targetConnectionId, nodeIp,
        `nohup bash "${dlScript}" > /dev/null 2>&1 & echo $!`)
      if (!startDl.success || !startDl.output?.trim()) {
        if (cloneCreated) await executeOnEsxi(`vmkfstools -U '${cloneVmdkPath}'`).catch(() => {})
        throw new Error(`Failed to start SSH streaming: ${startDl.error}`)
      }
      const ddPid = startDl.output.trim()
      await executeSSH(config.targetConnectionId, nodeIp, `echo ${ddPid} > "${pidFile}"`)

      const totalBytes = disk.capacityBytes
      let transferredBytes = 0
      let transferSpeed = ""
      const startTime = Date.now()

      try {
        while (true) {
          if (isCancelled(jobId)) {
            await executeSSH(config.targetConnectionId, nodeIp, `kill ${ddPid} 2>/dev/null; rm -f "${pidFile}" "${pidFile}.exit" "${dlScript}" "${progressFile}" "${ctrlPrefix}.esxi-key" "${errFile}"`)
            throw new Error("Migration cancelled")
          }
          await new Promise(r => setTimeout(r, 3000))

          const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${pidFile}.exit" 2>/dev/null || echo RUNNING`)
          const isRunning = exitCheck.output?.trim() === "RUNNING"

          // Parse dd progress output
          const progressResult = await executeSSH(config.targetConnectionId, nodeIp,
            `tail -c 200 "${progressFile}" 2>/dev/null | tr '\\r' '\\n' | grep -oP '^\\d+' | tail -1 || echo 0`)
          transferredBytes = Number.parseInt(progressResult.output?.trim() || "0", 10) || 0

          const elapsed = (Date.now() - startTime) / 1000
          const speedBps = elapsed > 0 ? transferredBytes / elapsed : 0
          transferSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`

          const diskProgress = totalBytes > 0 ? Math.min(Math.round((transferredBytes / totalBytes) * 100), 99) : 0
          const overallProgress = Math.round((i / vmConfig.disks.length) * 100 + (diskProgress / vmConfig.disks.length))

          await updateJob(jobId, "transferring", {
            bytesTransferred: BigInt(transferredBytes),
            transferSpeed,
            progress: Math.round(overallProgress * 0.7),
          })

          if (!isRunning) {
            const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
            const elapsed = (Date.now() - startTime) / 1000

            if (exitCode !== 0) {
              // Check if data was mostly transferred despite non-zero exit (SSH warnings)
              // For block devices, we can't easily check size — trust the dd progress
              if (transferredBytes >= Math.floor(disk.capacityBytes * 0.9)) {
                await appendLog(jobId, `SSH exited with code ${exitCode} but transfer looks complete (${(transferredBytes / 1073741824).toFixed(1)} GB) — continuing`, "warn")
              } else {
                await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${pidFile}" "${pidFile}.exit" "${dlScript}" "${progressFile}" "${ctrlPrefix}.esxi-key" "${errFile}"`)
                throw new Error(`SSH streaming failed (exit ${exitCode})`)
              }
            }

            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${pidFile}" "${pidFile}.exit" "${dlScript}" "${progressFile}" "${ctrlPrefix}.esxi-key" "${errFile}"`)
            break
          }
        }
      } finally {
        if (cloneCreated) {
          await executeOnEsxi(`vmkfstools -U '${cloneVmdkPath}'`).catch((e) => {
            appendLog(jobId, `Warning: failed to cleanup ESXi clone: ${e.message}`, "warn")
          })
        }
      }

      await updateJob(jobId, "transferring", { bytesTransferred: BigInt(transferredBytes), transferSpeed })
      await appendLog(jobId, `SSH streaming complete: ${(transferredBytes / 1073741824).toFixed(1)} GB in ${((Date.now() - startTime) / 1000).toFixed(0)}s (${transferSpeed})`, "success")

      // Unmap RBD device if we mapped it
      const allocVol = allocatedVolumes.find(v => v.devicePath === devicePath)
      if (allocVol?.rbdMapped) {
        await executeSSH(config.targetConnectionId, nodeIp, `rbd unmap "${devicePath}" 2>/dev/null`).catch(() => {})
      }
    }

    // Helper: download a single disk from ESXi via curl on PVE node
    // overrideUrl: used by NFC lease in live mode (datastore browser returns 500 when snapshot active)
    async function downloadDisk(i: number, disk: EsxiDiskInfo, overrideUrl?: string) {
      const diskSizeGB = (disk.capacityBytes / 1073741824).toFixed(1)
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Downloading "${disk.label}" (${diskSizeGB} GB, ${disk.thinProvisioned ? "thin" : "thick"})...`)

      const tmpFile = storageTempDir ? `${storageTempDir}/proxcenter-mig-${jobId}-disk${i}` : `/tmp/proxcenter-mig-${jobId}-disk${i}`
      const soapCookie = soapSession!.cookie

      // Strip double quotes from cookie value to avoid shell quoting issues
      // ESXi returns: vmware_soap_session="abc123" — quotes are decorative, not required
      const safeCookie = soapCookie.replace(/"/g, '')
      const vmdkUrl = overrideUrl || buildVmdkDownloadUrl(esxiUrl, disk)
      await appendLog(jobId, `Download URL: ${vmdkUrl.replace(/\?.*/, '?...')}${overrideUrl ? ' (NFC lease)' : ''}`, "info")

      await updateJob(jobId, "transferring", {
        currentStep: `downloading_disk_${i + 1}`,
        currentDisk: i,
        bytesTransferred: BigInt(0),
        totalBytes: BigInt(disk.capacityBytes),
      })

      const pidFile = `${tmpFile}.pid`
      const statsFile = `${tmpFile}.stats`
      const dlScript = `${tmpFile}.dl.sh`
      // Write download script to avoid shell quoting issues with cookie/URL values
      // Note: no -f flag — we check HTTP code and file size after download
      await executeSSH(config.targetConnectionId, nodeIp,
        `cat > "${dlScript}" << 'DLEOF'\ncurl -sk -b '${safeCookie}' -o "${tmpFile}.vmdk" -w '{"speed":%{speed_download},"size":%{size_download},"time":%{time_total},"http_code":%{http_code}}' '${vmdkUrl}' > "${statsFile}" 2>&1\necho $? > "${pidFile}.exit"\nDLEOF`
      )
      const startDl = await executeSSH(
        config.targetConnectionId, nodeIp,
        `nohup bash "${dlScript}" > /dev/null 2>&1 & echo $!`
      )
      if (!startDl.success || !startDl.output?.trim()) {
        throw new Error(`Failed to start download: ${startDl.error}`)
      }
      const curlPid = startDl.output.trim()
      await executeSSH(config.targetConnectionId, nodeIp, `echo ${curlPid} > "${pidFile}"`)

      const totalBytes = disk.capacityBytes
      let downloadedBytes = 0
      let downloadSpeed = ""
      let downloadTime = 0
      const startTime = Date.now()

      while (true) {
        if (isCancelled(jobId)) {
          await executeSSH(config.targetConnectionId, nodeIp, `kill ${curlPid} 2>/dev/null; rm -f "${tmpFile}.vmdk" "${pidFile}" "${pidFile}.exit" "${statsFile}" "${dlScript}"`)
          throw new Error("Migration cancelled")
        }

        await new Promise(r => setTimeout(r, 3000))

        const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${pidFile}.exit" 2>/dev/null || echo RUNNING`)
        const isRunning = exitCheck.output?.trim() === "RUNNING"

        const sizeResult = await executeSSH(config.targetConnectionId, nodeIp, `stat -c %s "${tmpFile}.vmdk" 2>/dev/null || echo 0`)
        const currentSize = Number.parseInt(sizeResult.output?.trim() || "0", 10) || 0
        downloadedBytes = currentSize

        const elapsed = (Date.now() - startTime) / 1000
        const speedBps = elapsed > 0 ? currentSize / elapsed : 0
        downloadSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`

        const diskProgress = totalBytes > 0 ? Math.min(Math.round((currentSize / totalBytes) * 100), 99) : 0
        const overallProgress = Math.round((i / vmConfig.disks.length) * 100 + (diskProgress / vmConfig.disks.length))

        await updateJob(jobId, "transferring", {
          bytesTransferred: BigInt(currentSize),
          transferSpeed: downloadSpeed,
          progress: isLive ? Math.round(overallProgress * 0.7) : overallProgress,
        })

        if (!isRunning) {
          const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
          if (exitCode !== 0) {
            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vmdk" "${pidFile}" "${pidFile}.exit" "${statsFile}" "${dlScript}"`)
            throw new Error(`Download failed: curl exit code ${exitCode}`)
          }

          const statsContent = await executeSSH(config.targetConnectionId, nodeIp, `cat "${statsFile}" 2>/dev/null`)
          const curlStats = statsContent.output?.match(/\{[^}]+\}/)
          let httpCode = 0
          if (curlStats) {
            try {
              const stats = JSON.parse(curlStats[0])
              downloadedBytes = stats.size || currentSize
              downloadSpeed = stats.speed > 1048576 ? `${(stats.speed / 1048576).toFixed(1)} MB/s` : `${(stats.speed / 1024).toFixed(0)} KB/s`
              downloadTime = stats.time || elapsed
              httpCode = stats.http_code || 0
            } catch {}
          } else {
            downloadTime = elapsed
          }

          // Validate HTTP status code
          if (httpCode >= 400 || httpCode === 0) {
            // Read first bytes of the downloaded file to see error content
            const errorPreview = await executeSSH(config.targetConnectionId, nodeIp, `head -c 500 "${tmpFile}.vmdk" 2>/dev/null | tr '\\n' ' '`)
            const preview = errorPreview.output?.trim().substring(0, 200) || "(empty)"
            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vmdk" "${pidFile}" "${pidFile}.exit" "${statsFile}" "${dlScript}"`)
            throw new Error(`Download failed: HTTP ${httpCode} from ESXi. Response: ${preview}`)
          }

          // Validate downloaded file size (must be at least 1 MB for any real disk)
          const fileSizeCheck = await executeSSH(config.targetConnectionId, nodeIp, `stat -c %s "${tmpFile}.vmdk" 2>/dev/null || echo 0`)
          const actualSize = Number.parseInt(fileSizeCheck.output?.trim() || "0", 10)
          if (actualSize < 1048576) {
            const errorPreview = await executeSSH(config.targetConnectionId, nodeIp, `head -c 500 "${tmpFile}.vmdk" 2>/dev/null | tr '\\n' ' '`)
            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vmdk" "${pidFile}" "${pidFile}.exit" "${statsFile}" "${dlScript}"`)
            throw new Error(`Download produced a ${actualSize}-byte file (expected ~${diskSizeGB} GB, HTTP ${httpCode}). Content: ${errorPreview.output?.trim().substring(0, 200)}`)
          }

          await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${pidFile}" "${pidFile}.exit" "${statsFile}" "${dlScript}"`)
          break
        }
      }

      await updateJob(jobId, "transferring", {
        bytesTransferred: BigInt(downloadedBytes),
        transferSpeed: downloadSpeed,
      })
      await appendLog(jobId, `Download complete: ${(downloadedBytes / 1073741824).toFixed(1)} GB in ${downloadTime.toFixed(0)}s (${downloadSpeed})`, "success")
    }

    // Helper: build ESXi SSH prefix (sshpass + legacy algorithms for ESXi BusyBox SSH)
    // Returns { setupCmd, sshPrefix, cleanupCmd } to be used in shell scripts on PVE node
    function buildEsxiSshPrefix(tmpPrefix: string) {
      const esxiHost = esxiUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "")
      const esxiSshPort = esxiConn.sshPort || 22
      const esxiSshUser = esxiConn.sshUser || "root"
      const esxiPass = esxiConn.sshPassEnc ? decryptSecret(esxiConn.sshPassEnc) : ""
      const esxiSshOpts = `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=15 -o HostKeyAlgorithms=+ssh-rsa,ssh-ed25519 -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group14-sha256 -o PreferredAuthentications=keyboard-interactive,password`

      let setupCmd = ""
      let sshPrefix = ""
      let cleanupCmd = ""

      if (esxiConn.sshAuthMethod === "key" && esxiConn.sshKeyEnc) {
        const esxiKey = decryptSecret(esxiConn.sshKeyEnc)
        const keyFile = `${tmpPrefix}.esxi-key`
        setupCmd = `cat > "${keyFile}" << 'KEYEOF'\n${esxiKey}\nKEYEOF\nchmod 600 "${keyFile}"`
        sshPrefix = `ssh ${esxiSshOpts} -i "${keyFile}"`
        cleanupCmd = `rm -f "${keyFile}"`
      } else if (esxiPass) {
        const safePass = esxiPass.replace(/'/g, "'\\''")
        setupCmd = `export SSHPASS='${safePass}'`
        sshPrefix = `sshpass -e ssh ${esxiSshOpts}`
        cleanupCmd = ""
      }

      return { esxiHost, esxiSshPort, esxiSshUser, esxiSshOpts, setupCmd, sshPrefix, cleanupCmd }
    }

    // Helper: execute a command on ESXi via SSH from PVE node (background + polling, no timeout issues)
    async function executeOnEsxi(command: string, timeoutMs = 3600000): Promise<string> {
      const tmpPrefix = `/tmp/proxcenter-mig-${jobId}-esxicmd`
      const { esxiHost, esxiSshPort, esxiSshUser, setupCmd, sshPrefix, cleanupCmd } = buildEsxiSshPrefix(tmpPrefix)
      const script = `${tmpPrefix}.sh`
      const outFile = `${tmpPrefix}.out`
      const errFile = `${tmpPrefix}.stderr`
      const exitFile = `${tmpPrefix}.exit`

      const sshCmd = `${sshPrefix} -p ${esxiSshPort} ${esxiSshUser}@${esxiHost} "${command.replaceAll('"', '\\"')}" >"${outFile}" 2>"${errFile}"`

      await executeSSH(config.targetConnectionId, nodeIp,
        `cat > "${script}" << 'ESXIEOF'\n${setupCmd}\n${sshCmd}\nEXIT_CODE=$?\n${cleanupCmd}\necho $EXIT_CODE > "${exitFile}"\nESXIEOF`
      )

      // Run in background
      const startResult = await executeSSH(config.targetConnectionId, nodeIp,
        `nohup bash "${script}" > /dev/null 2>&1 & echo $!`
      )
      if (!startResult.success || !startResult.output?.trim()) {
        throw new Error(`Failed to start ESXi command: ${startResult.error}`)
      }
      const pid = startResult.output.trim()

      // Poll for completion
      const startTime = Date.now()
      while (true) {
        if (isCancelled(jobId)) {
          await executeSSH(config.targetConnectionId, nodeIp, `kill ${pid} 2>/dev/null; rm -f "${script}" "${outFile}" "${errFile}" "${exitFile}" "${tmpPrefix}.esxi-key"`)
          throw new Error("Migration cancelled")
        }
        if (Date.now() - startTime > timeoutMs) {
          await executeSSH(config.targetConnectionId, nodeIp, `kill ${pid} 2>/dev/null; rm -f "${script}" "${outFile}" "${errFile}" "${exitFile}" "${tmpPrefix}.esxi-key"`)
          throw new Error(`ESXi command timed out after ${Math.round(timeoutMs / 60000)}m`)
        }

        await new Promise(r => setTimeout(r, 3000))

        const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${exitFile}" 2>/dev/null || echo RUNNING`)
        if (exitCheck.output?.trim() === "RUNNING") continue

        const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
        const outputContent = await executeSSH(config.targetConnectionId, nodeIp, `cat "${outFile}" 2>/dev/null`)
        const output = outputContent.output?.trim() || ""

        if (exitCode !== 0) {
          const stderrContent = await executeSSH(config.targetConnectionId, nodeIp, `cat "${errFile}" 2>/dev/null | head -c 500`)
          await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${script}" "${outFile}" "${errFile}" "${exitFile}" "${tmpPrefix}.esxi-key"`)
          const errMsg = stderrContent.output?.trim() || output
          throw new Error(`ESXi command failed (exit ${exitCode}): ${errMsg}`)
        }

        await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${script}" "${outFile}" "${errFile}" "${exitFile}" "${tmpPrefix}.esxi-key"`)
        return output
      }
    }

    // ── SSHFS helpers ──
    // Mount ESXi datastore on PVE node via SSHFS (SSH filesystem)
    // Works with VMFS, NFS, vSAN — anything accessible under /vmfs/volumes/ on ESXi
    async function mountSshfs(datastoreName: string): Promise<string> {
      const { esxiHost, esxiSshPort, esxiSshUser } = buildEsxiSshPrefix(`/tmp/proxcenter-sshfs-${jobId}`)
      const esxiPass = esxiConn.sshPassEnc ? decryptSecret(esxiConn.sshPassEnc) : ""
      const esxiKey = (esxiConn.sshAuthMethod === "key" && esxiConn.sshKeyEnc) ? decryptSecret(esxiConn.sshKeyEnc) : ""
      const mountPath = sshfsMountPath

      // Ensure fuse allows other users (needed for qemu-img/qm to access mounted files)
      await executeSSH(config.targetConnectionId, nodeIp,
        `grep -q '^user_allow_other' /etc/fuse.conf 2>/dev/null || ` +
        `sed -i 's/^#user_allow_other/user_allow_other/' /etc/fuse.conf 2>/dev/null || ` +
        `echo 'user_allow_other' >> /etc/fuse.conf`
      )

      // SSHFS options — FUSE3 compatible (sshfs 3.x on Debian Trixie/PVE 9)
      // Note: big_writes, large_read, kernel_cache are FUSE2-only and removed in FUSE3
      // ssh_command must be quoted to avoid comma conflicts with sshfs -o parser
      const sshfsBaseOpts = "StrictHostKeyChecking=no,UserKnownHostsFile=/dev/null,allow_other,reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,cache=yes,max_read=1048576,entry_timeout=3600,negative_timeout=3600,attr_timeout=3600"

      // ESXi SSH legacy algorithms — passed via ssh_command to avoid comma parsing issues
      // We write a wrapper script so sshfs ssh_command= points to it (no comma escaping needed)
      const sshWrapperPath = `${mountPath}.ssh-wrapper.sh`
      const sshWrapperContent = `#!/bin/sh\nexec ssh -p ${esxiSshPort} -o HostKeyAlgorithms=+ssh-rsa,ssh-ed25519,ecdsa-sha2-nistp256 -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group14-sha256 -o PreferredAuthentications=keyboard-interactive,password -o Compression=no -o Ciphers=aes128-gcm@openssh.com,aes128-ctr,aes256-ctr -o TCPKeepAlive=yes -o IPQoS=throughput "$@"`

      // Resolve datastore symlink on ESXi — SFTP doesn't follow symlinks for mount root
      // /vmfs/volumes/Datastore is a symlink to /vmfs/volumes/<UUID>, we need the real path
      let remotePath = `/vmfs/volumes/${datastoreName}`
      const { esxiHost: resolveHost, esxiSshPort: resolvePort, esxiSshUser: resolveUser, setupCmd: resolveSetup, sshPrefix: resolveSshPrefix, cleanupCmd: resolveCleanup } = buildEsxiSshPrefix(`/tmp/proxcenter-sshfs-resolve-${jobId}`)
      const safeDsName = datastoreName.replace(/'/g, "'\\''")
      const resolveCmd = `${resolveSetup ? resolveSetup + ' && ' : ''}${resolveSshPrefix} -p ${resolvePort} ${resolveUser}@${resolveHost} "readlink -f '/vmfs/volumes/${safeDsName}'" 2>/dev/null${resolveCleanup ? ' ; ' + resolveCleanup : ''}`
      const resolveResult = await executeSSH(config.targetConnectionId, nodeIp, resolveCmd)
      if (resolveResult.success && resolveResult.output?.trim().startsWith("/vmfs/")) {
        remotePath = resolveResult.output.trim()
        await appendLog(jobId, `Resolved datastore path: ${datastoreName} -> ${remotePath}`, "info")
      } else {
        // readlink failed — try fallback: ls -la to parse symlink target
        await appendLog(jobId, `readlink failed for ${datastoreName}, trying ls -la fallback...`, "warn")
        const fallbackCmd = `${resolveSetup ? resolveSetup + ' && ' : ''}${resolveSshPrefix} -p ${resolvePort} ${resolveUser}@${resolveHost} "ls -la '/vmfs/volumes/${safeDsName}'" 2>/dev/null${resolveCleanup ? ' ; ' + resolveCleanup : ''}`
        const fallbackResult = await executeSSH(config.targetConnectionId, nodeIp, fallbackCmd)
        // ls -la on a symlink: lrwxrwxrwx ... 3Par_DMZ1 -> 6508540b-49183378-c5fe-bc97e1ab7c50
        const arrowMatch = fallbackResult.output?.match(/->\s*(\S+)/)
        if (arrowMatch?.[1]) {
          const resolvedUuid = arrowMatch[1]
          remotePath = resolvedUuid.startsWith("/") ? resolvedUuid : `/vmfs/volumes/${resolvedUuid}`
          await appendLog(jobId, `Resolved datastore via ls fallback: ${datastoreName} -> ${remotePath}`, "info")
        } else {
          // SFTP cannot follow symlinks — this will likely fail, warn clearly
          await appendLog(jobId, `Could not resolve datastore symlink for "${datastoreName}". SSHFS/SFTP cannot follow symlinks — mount will likely fail. If it does, check SSH connectivity from the Proxmox node to the ESXi host.`, "error")
        }
      }
      let mounted = false
      const mountErrors: string[] = []

      if (esxiKey) {
        // Key-based auth
        const keyFile = `${mountPath}.esxi-key`
        await executeSSH(config.targetConnectionId, nodeIp,
          `cat > "${keyFile}" << 'KEYEOF'\n${esxiKey}\nKEYEOF\nchmod 600 "${keyFile}"`
        )
        const sshWrapperKey = `#!/bin/sh\nexec ssh -p ${esxiSshPort} -i ${keyFile} -o HostKeyAlgorithms=+ssh-rsa,ssh-ed25519 -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group14-sha256 -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o Compression=no "$@"`
        await executeSSH(config.targetConnectionId, nodeIp,
          `cat > "${sshWrapperPath}" << 'SSHEOF'\n${sshWrapperKey}\nSSHEOF\nchmod +x "${sshWrapperPath}"`
        )
        // Try with perf options
        const mountCmd = `mkdir -p "${mountPath}" && sshfs -o ${sshfsBaseOpts},ssh_command=${sshWrapperPath} ${esxiSshUser}@${esxiHost}:${remotePath} "${mountPath}" 2>&1`
        const rc = await executeSSH(config.targetConnectionId, nodeIp, mountCmd)
        if (rc.success) mounted = true
        else mountErrors.push(`attempt 1 (key+perf): ${(rc.error || rc.output || '').toString().trim().slice(0, 300)}`)
        if (!mounted) {
          // Fallback: minimal
          const mountCmd2 = `mkdir -p "${mountPath}" && sshfs -o StrictHostKeyChecking=no,UserKnownHostsFile=/dev/null,allow_other,reconnect,ssh_command=${sshWrapperPath} ${esxiSshUser}@${esxiHost}:${remotePath} "${mountPath}" 2>&1`
          const rc2 = await executeSSH(config.targetConnectionId, nodeIp, mountCmd2)
          if (rc2.success) mounted = true
          else mountErrors.push(`attempt 2 (key+minimal): ${(rc2.error || rc2.output || '').toString().trim().slice(0, 300)}`)
        }
      } else if (esxiPass) {
        // Password-based auth via password_stdin + ssh wrapper script
        const safePass = esxiPass.replace(/'/g, "'\\''")
        await executeSSH(config.targetConnectionId, nodeIp,
          `cat > "${sshWrapperPath}" << 'SSHEOF'\n${sshWrapperContent}\nSSHEOF\nchmod +x "${sshWrapperPath}"`
        )
        // Try with perf options + algo wrapper
        const mountCmd = `mkdir -p "${mountPath}" && printf '%s' '${safePass}' | sshfs -o password_stdin,${sshfsBaseOpts},ssh_command=${sshWrapperPath} ${esxiSshUser}@${esxiHost}:${remotePath} "${mountPath}" 2>&1`
        const rc = await executeSSH(config.targetConnectionId, nodeIp, mountCmd)
        if (rc.success) mounted = true
        else mountErrors.push(`attempt 1 (perf+algo): ${(rc.error || rc.output || '').toString().trim().slice(0, 300)}`)
        if (!mounted) {
          // Fallback: no algo wrapper (let ssh negotiate)
          const mountCmd2 = `mkdir -p "${mountPath}" && printf '%s' '${safePass}' | sshfs -o password_stdin,StrictHostKeyChecking=no,UserKnownHostsFile=/dev/null,allow_other,reconnect,ServerAliveInterval=15,cache=yes,entry_timeout=3600,attr_timeout=3600 ${esxiSshUser}@${esxiHost}:${remotePath} "${mountPath}" 2>&1`
          const rc2 = await executeSSH(config.targetConnectionId, nodeIp, mountCmd2)
          if (rc2.success) mounted = true
          else mountErrors.push(`attempt 2 (negotiate): ${(rc2.error || rc2.output || '').toString().trim().slice(0, 300)}`)
        }
        if (!mounted) {
          // Fallback: absolute minimal
          const mountCmd3 = `mkdir -p "${mountPath}" && printf '%s' '${safePass}' | sshfs -o password_stdin,StrictHostKeyChecking=no,UserKnownHostsFile=/dev/null,allow_other,reconnect,cache=yes ${esxiSshUser}@${esxiHost}:${remotePath} "${mountPath}" 2>&1`
          const rc3 = await executeSSH(config.targetConnectionId, nodeIp, mountCmd3)
          if (rc3.success) mounted = true
          else mountErrors.push(`attempt 3 (minimal): ${(rc3.error || rc3.output || '').toString().trim().slice(0, 300)}`)
        }
      }

      if (!mounted) {
        // Cleanup wrapper script
        await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${sshWrapperPath}" "${mountPath}.esxi-key"`).catch(() => {})
        // Surface the actual SSH/sshfs error so the user can diagnose. Common causes:
        //   - "Connection refused": SSH not enabled on the ESXi (vSphere -> Configure -> Services -> SSH)
        //   - "Permission denied": wrong password, or root login disabled
        //   - "subsystem request failed" / "Connection reset": SFTP subsystem disabled on ESXi
        //   - "no matching host key type": ESXi's old SSH algos need the wrapper (already attempted)
        const errSummary = mountErrors.length
          ? mountErrors.join(" | ")
          : "no SSH/sshfs output captured (check authentication method and ESXi SSH availability)"
        throw new Error(
          `Failed to mount ESXi datastore via SSHFS on ${esxiHost}:${esxiSshPort}. ` +
          `Underlying errors: ${errSummary}. ` +
          `Verify: (1) SSH enabled on ESXi (vSphere Client > Configure > Services > SSH > Start), ` +
          `(2) credentials valid (try 'ssh ${esxiSshUser}@${esxiHost}' from the Proxmox node), ` +
          `(3) SFTP subsystem available on ESXi (try 'sftp ${esxiSshUser}@${esxiHost}').`
        )
      }

      // Verify mount by listing files
      const verifyResult = await executeSSH(config.targetConnectionId, nodeIp, `ls "${mountPath}/" | head -5`)
      if (!verifyResult.success || !verifyResult.output?.trim()) {
        await unmountSshfs()
        throw new Error("SSHFS mount succeeded but datastore appears empty. Check ESXi SSH access and datastore name.")
      }

      await appendLog(jobId, `SSHFS mounted: ${esxiHost}:${remotePath} → ${mountPath}`, "success")
      return mountPath
    }

    // Unmount SSHFS and cleanup
    async function unmountSshfs() {
      if (!sshfsMountPath) return
      try {
        await executeSSH(config.targetConnectionId, nodeIp, `fusermount -uz "${sshfsMountPath}" 2>/dev/null; rmdir "${sshfsMountPath}" 2>/dev/null; rm -f "${sshfsMountPath}.esxi-key" "${sshfsMountPath}.ssh-wrapper.sh" 2>/dev/null`)
      } catch {
        // Best effort cleanup
      }
    }

    // Transfer disk via SSHFS for file-based storage (qemu-img convert from mounted VMDK)
    async function transferDiskViaSshfs(i: number, disk: EsxiDiskInfo) {
      const diskSizeGB = (disk.capacityBytes / 1073741824).toFixed(1)
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Converting "${disk.label}" via SSHFS (${diskSizeGB} GB)...`)

      // The flat VMDK is the raw data file; the descriptor .vmdk is a small text file
      // qemu-img needs the flat file for direct raw access
      const flatPath = disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
      const sshfsDiskPath = `${sshfsMountPath}/${flatPath}`
      const tmpFile = storageTempDir ? `${storageTempDir}/proxcenter-mig-${jobId}-disk${i}` : `/tmp/proxcenter-mig-${jobId}-disk${i}`

      // Verify the disk file is accessible via SSHFS
      const checkFile = await executeSSH(config.targetConnectionId, nodeIp, `test -f "${sshfsDiskPath}" && echo EXISTS || echo MISSING`)
      if (checkFile.output?.trim() !== "EXISTS") {
        // -flat.vmdk not found (common on vSAN where data is object-backed)
        // Fall back to VMDK descriptor - qemu-img -f vmdk can read it and follow references
        const altPath = `${sshfsMountPath}/${disk.relativePath}`
        const checkAlt = await executeSSH(config.targetConnectionId, nodeIp, `test -f "${altPath}" && echo EXISTS || echo MISSING`)
        if (checkAlt.output?.trim() === "EXISTS") {
          await appendLog(jobId, `Using VMDK descriptor (vSAN/object storage): qemu-img will read via descriptor`, "info")
          return await sshfsConvertAndImport(i, disk, altPath, tmpFile, "vmdk")
        }
        throw new Error(`Disk file not found via SSHFS: ${sshfsDiskPath} (also tried descriptor: ${altPath})`)
      }

      await sshfsConvertAndImport(i, disk, sshfsDiskPath, tmpFile, "raw")
    }

    // Core convert+import from an SSHFS path for file-based storage
    // inputFormat: "raw" for flat VMDKs (direct raw data), "vmdk" for VMDK descriptors (vSAN/object storage)
    async function sshfsConvertAndImport(i: number, disk: EsxiDiskInfo, sourcePath: string, tmpFile: string, inputFormat: "raw" | "vmdk" = "raw") {
      const diskSizeGB = (disk.capacityBytes / 1073741824).toFixed(1)
      const scsiSlot = `scsi${i}`

      await updateJob(jobId, "transferring", {
        currentStep: `converting_disk_${i + 1}`,
        currentDisk: i,
        bytesTransferred: BigInt(0),
        totalBytes: BigInt(disk.capacityBytes),
      })

      // Convert directly from SSHFS mount to target format
      // qemu-img reads from SSHFS (FUSE) and writes locally — no intermediate download needed
      const ctrlPrefix = `/tmp/proxcenter-mig-${jobId}-sshfs${i}`
      const progressFile = `${ctrlPrefix}.progress`
      const pidFile = `${ctrlPrefix}.pid`
      const exitFile = `${ctrlPrefix}.exit`
      const convertScript = `${ctrlPrefix}.sh`
      const outputFile = `${tmpFile}.${importFormat}`

      // Use qemu-img convert with progress output
      // inputFormat=vmdk: reads VMDK descriptor and follows references (required for vSAN)
      // inputFormat=raw: reads flat VMDK as raw data (standard VMFS)
      await executeSSH(config.targetConnectionId, nodeIp,
        `cat > "${convertScript}" << 'CONVEOF'\nqemu-img convert -p -f ${inputFormat} -O ${importFormat} "${sourcePath}" "${outputFile}" 2>"${progressFile}"\necho $? > "${exitFile}"\nCONVEOF`
      )

      const startConvert = await executeSSH(config.targetConnectionId, nodeIp,
        `nohup bash "${convertScript}" > /dev/null 2>&1 & echo $!`)
      if (!startConvert.success || !startConvert.output?.trim()) {
        throw new Error(`Failed to start qemu-img convert: ${startConvert.error}`)
      }
      const pid = startConvert.output.trim()
      await executeSSH(config.targetConnectionId, nodeIp, `echo ${pid} > "${pidFile}"`)

      const startTime = Date.now()
      while (true) {
        if (isCancelled(jobId)) {
          await executeSSH(config.targetConnectionId, nodeIp, `kill ${pid} 2>/dev/null; rm -f "${convertScript}" "${pidFile}" "${exitFile}" "${progressFile}" "${outputFile}"`)
          throw new Error("Migration cancelled")
        }
        await new Promise(r => setTimeout(r, 3000))

        // Parse qemu-img progress: outputs lines like "(12.34/100%)"
        const progressResult = await executeSSH(config.targetConnectionId, nodeIp,
          `tail -c 100 "${progressFile}" 2>/dev/null | tr '\\r' '\\n' | grep -oP '[\\d.]+(?=/100%)' | tail -1 || echo 0`)
        const pct = Number.parseFloat(progressResult.output?.trim() || "0") || 0
        const estimatedBytes = Math.round((pct / 100) * disk.capacityBytes)

        const elapsed = (Date.now() - startTime) / 1000
        const speedBps = elapsed > 0 ? estimatedBytes / elapsed : 0
        const transferSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`

        const diskProgress = Math.min(Math.round(pct), 99)
        const overallProgress = Math.round((i / vmConfig.disks.length) * 100 + (diskProgress / vmConfig.disks.length))

        await updateJob(jobId, "transferring", {
          bytesTransferred: BigInt(estimatedBytes),
          transferSpeed: `SSHFS: ${transferSpeed}`,
          progress: isLive ? Math.round(overallProgress * 0.7) : overallProgress,
        })

        const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${exitFile}" 2>/dev/null || echo RUNNING`)
        if (exitCheck.output?.trim() !== "RUNNING") {
          const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
          // Capture the FULL stderr from qemu-img BEFORE deleting the progress file.
          // qemu-img writes both progress lines (carriage-return separated) and error
          // messages to stderr; on failure the last lines are usually the actual error.
          // Without this we'd surface the useless "exit 1" generic, hiding the root cause
          // (locked file, bad descriptor, permission denied, broken vmdk chain, etc.).
          let stderrTail = ""
          if (exitCode !== 0) {
            const stderrCapture = await executeSSH(
              config.targetConnectionId,
              nodeIp,
              `tail -c 2000 "${progressFile}" 2>/dev/null | tr '\\r' '\\n' | grep -v '/100%' | tail -10`,
            )
            stderrTail = (stderrCapture.output || "").trim()
          }
          await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${convertScript}" "${pidFile}" "${exitFile}" "${progressFile}"`)
          if (exitCode !== 0) {
            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${outputFile}"`)
            throw new Error(
              `qemu-img convert failed (exit ${exitCode}) on ${sourcePath}. ` +
              `Source format: ${inputFormat}, target format: ${importFormat}. ` +
              (stderrTail
                ? `qemu-img stderr (last lines): ${stderrTail}`
                : `No stderr captured. Common causes: VMDK descriptor references missing -flat file (vSAN object access issue), VMDK locked by running VM (power off and retry), or sparse VMDK with broken extent map.`),
            )
          }
          break
        }
      }

      const elapsed = (Date.now() - startTime) / 1000
      const fileSizeResult = await executeSSH(config.targetConnectionId, nodeIp, `stat -c %s "${outputFile}" 2>/dev/null || echo 0`)
      const outputSize = Number.parseInt(fileSizeResult.output?.trim() || "0", 10)
      const speedBps = elapsed > 0 ? disk.capacityBytes / elapsed : 0
      const transferSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`
      await appendLog(jobId, `Conversion complete: ${diskSizeGB} GB in ${elapsed.toFixed(0)}s (${transferSpeed}), output ${(outputSize / 1073741824).toFixed(1)} GB`, "success")

      // Import into Proxmox storage
      await appendLog(jobId, `Importing disk into storage "${config.targetStorage}"...`)
      await updateJob(jobId, "transferring", { currentStep: `importing_disk_${i + 1}` })

      const importResult = await executeSSHWithTimeout(
        prisma, config.targetConnectionId, nodeIp,
        `qm disk import ${targetVmid} "${outputFile}" ${config.targetStorage} --format ${importFormat} 2>&1`,
        3600000
      )
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${outputFile}"`)

      if (!importResult.success) {
        throw new Error(`Disk import failed: ${importResult.error}`)
      }

      // Parse volume name from import output (same logic as convertAndImportDisk)
      let diskVolume = ""
      const importOutput = importResult.output || ""
      const importMatch = importOutput.match(/Successfully imported disk as '(?:unused\d+:)?(.+?)'/)
      const altMatch = !importMatch && importOutput.match(/unused\d+:\s*successfully imported disk '(.+?)'/i)
      if (importMatch?.[1]) {
        diskVolume = importMatch[1]
      } else if (altMatch?.[1]) {
        diskVolume = altMatch[1]
      } else {
        try {
          const vmConf = await pveFetch<Record<string, any>>(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`)
          const unusedKeys = Object.keys(vmConf).filter(k => k.startsWith("unused")).sort((a, b) => a.localeCompare(b))
          if (unusedKeys.length > 0) diskVolume = vmConf[unusedKeys[unusedKeys.length - 1]] as string
        } catch {}
        if (!diskVolume) diskVolume = `${config.targetStorage}:vm-${targetVmid}-disk-${i}`
      }

      // Attach disk
      const attachBody = new URLSearchParams({ [scsiSlot]: `${diskVolume}${isFileBased ? ",discard=on" : ""}` })
      try {
        await pveFetch<any>(pveConn, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`, { method: "PUT", body: attachBody })
        await appendLog(jobId, `Disk ${i + 1} imported and attached as ${scsiSlot}`, "success")
      } catch (attachErr: any) {
        await appendLog(jobId, `Warning: Could not auto-attach ${scsiSlot}: ${attachErr.message}`, "warn")
      }
    }

    // Stream disk via SSHFS for block storage (dd or qemu-img convert to pre-allocated device)
    async function streamDiskViaSshfsToBlock(i: number, disk: EsxiDiskInfo, devicePath: string) {
      const diskSizeGB = (disk.capacityBytes / 1073741824).toFixed(1)
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Streaming "${disk.label}" via SSHFS to block device (${diskSizeGB} GB)...`)

      const flatPath = disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
      let sshfsDiskPath = `${sshfsMountPath}/${flatPath}`
      let useVmdkDescriptor = false

      // Verify file exists
      const checkFile = await executeSSH(config.targetConnectionId, nodeIp, `test -f "${sshfsDiskPath}" && echo EXISTS || echo MISSING`)
      if (checkFile.output?.trim() !== "EXISTS") {
        // -flat.vmdk not found (common on vSAN where data is object-backed)
        // Fall back to VMDK descriptor - qemu-img can read it and follow references to actual data
        const altPath = `${sshfsMountPath}/${disk.relativePath}`
        const checkAlt = await executeSSH(config.targetConnectionId, nodeIp, `test -f "${altPath}" && echo EXISTS || echo MISSING`)
        if (checkAlt.output?.trim() === "EXISTS") {
          sshfsDiskPath = altPath
          useVmdkDescriptor = true
          await appendLog(jobId, `Using VMDK descriptor (vSAN/object storage): qemu-img convert will read disk data via descriptor`, "info")
        } else {
          throw new Error(`Disk file not found via SSHFS: ${sshfsDiskPath} (also tried descriptor: ${altPath})`)
        }
      }

      await updateJob(jobId, "transferring", {
        currentStep: `streaming_disk_${i + 1}`,
        currentDisk: i,
        bytesTransferred: BigInt(0),
        totalBytes: BigInt(disk.capacityBytes),
      })

      const ctrlPrefix = `/tmp/proxcenter-mig-${jobId}-sshfsblk${i}`
      const progressFile = `${ctrlPrefix}.progress`
      const pidFile = `${ctrlPrefix}.pid`
      const exitFile = `${ctrlPrefix}.exit`
      const transferScript = `${ctrlPrefix}.sh`

      if (useVmdkDescriptor) {
        // vSAN / object storage: use qemu-img convert to read VMDK descriptor and write raw to block device
        // qemu-img understands VMDK format and follows descriptor references to the actual data objects
        await executeSSH(config.targetConnectionId, nodeIp,
          `cat > "${transferScript}" << 'XFEREOF'\nqemu-img convert -p -f vmdk -O raw "${sshfsDiskPath}" "${devicePath}" 2>"${progressFile}"\necho $? > "${exitFile}"\nXFEREOF`
        )
      } else {
        // VMFS / standard: flat VMDK is raw data, dd directly to block device (faster, no conversion overhead)
        await executeSSH(config.targetConnectionId, nodeIp,
          `cat > "${transferScript}" << 'XFEREOF'\ndd if="${sshfsDiskPath}" of="${devicePath}" bs=4M status=progress 2>"${progressFile}"\necho $? > "${exitFile}"\nXFEREOF`
        )
      }

      const startCmd = await executeSSH(config.targetConnectionId, nodeIp,
        `nohup bash "${transferScript}" > /dev/null 2>&1 & echo $!`)
      if (!startCmd.success || !startCmd.output?.trim()) {
        throw new Error(`Failed to start ${useVmdkDescriptor ? 'qemu-img convert' : 'dd'}: ${startCmd.error}`)
      }
      const pid = startCmd.output.trim()
      await executeSSH(config.targetConnectionId, nodeIp, `echo ${pid} > "${pidFile}"`)

      const totalBytes = disk.capacityBytes
      let transferredBytes = 0
      const startTime = Date.now()

      while (true) {
        if (isCancelled(jobId)) {
          await executeSSH(config.targetConnectionId, nodeIp, `kill ${pid} 2>/dev/null; rm -f "${transferScript}" "${pidFile}" "${exitFile}" "${progressFile}"`)
          throw new Error("Migration cancelled")
        }
        await new Promise(r => setTimeout(r, 3000))

        if (useVmdkDescriptor) {
          // Parse qemu-img progress: outputs lines like "(12.34/100%)"
          const progressResult = await executeSSH(config.targetConnectionId, nodeIp,
            `tail -c 100 "${progressFile}" 2>/dev/null | tr '\\r' '\\n' | grep -oP '[\\d.]+(?=/100%)' | tail -1 || echo 0`)
          const pct = Number.parseFloat(progressResult.output?.trim() || "0") || 0
          transferredBytes = Math.round((pct / 100) * totalBytes)
        } else {
          // Parse dd progress: "123456789 bytes ..."
          const progressResult = await executeSSH(config.targetConnectionId, nodeIp,
            `tail -c 200 "${progressFile}" 2>/dev/null | tr '\\r' '\\n' | grep -oP '^\\d+' | tail -1 || echo 0`)
          transferredBytes = Number.parseInt(progressResult.output?.trim() || "0", 10) || 0
        }

        const elapsed = (Date.now() - startTime) / 1000
        const speedBps = elapsed > 0 ? transferredBytes / elapsed : 0
        const transferSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`

        const diskProgress = totalBytes > 0 ? Math.min(Math.round((transferredBytes / totalBytes) * 100), 99) : 0
        const overallProgress = Math.round((i / vmConfig.disks.length) * 100 + (diskProgress / vmConfig.disks.length))

        await updateJob(jobId, "transferring", {
          bytesTransferred: BigInt(transferredBytes),
          transferSpeed: `SSHFS: ${transferSpeed}`,
          progress: isLive ? Math.round(overallProgress * 0.7) : overallProgress,
        })

        const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${exitFile}" 2>/dev/null || echo RUNNING`)
        if (exitCheck.output?.trim() !== "RUNNING") {
          const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
          // Capture stderr tail BEFORE deleting progressFile (same bug as transferDiskViaSshfs).
          let stderrTail = ""
          if (exitCode !== 0) {
            const stderrCapture = await executeSSH(
              config.targetConnectionId,
              nodeIp,
              `tail -c 2000 "${progressFile}" 2>/dev/null | tr '\\r' '\\n' | grep -v '/100%' | tail -10`,
            )
            stderrTail = (stderrCapture.output || "").trim()
          }
          await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${transferScript}" "${pidFile}" "${exitFile}" "${progressFile}"`)
          if (exitCode !== 0) {
            const tool = useVmdkDescriptor ? 'qemu-img convert' : 'dd'
            throw new Error(
              `${tool} failed (exit ${exitCode}) on ${sshfsDiskPath} -> ${devicePath}. ` +
              (stderrTail
                ? `${tool} stderr (last lines): ${stderrTail}`
                : `No stderr captured. For vSAN: descriptor may reference unreachable -flat object. For block storage: target device may be in use or wrong size.`),
            )
          }
          break
        }
      }

      const elapsed = (Date.now() - startTime) / 1000
      const speedBps = elapsed > 0 ? transferredBytes / elapsed : 0
      const transferSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`
      await appendLog(jobId, `SSHFS streaming complete: ${(transferredBytes / 1073741824).toFixed(1)} GB in ${elapsed.toFixed(0)}s (${transferSpeed})`, "success")

      // Unmap RBD device if we mapped it
      const allocVol = allocatedVolumes.find(v => v.devicePath === devicePath)
      if (allocVol?.rbdMapped) {
        await executeSSH(config.targetConnectionId, nodeIp, `rbd unmap "${devicePath}" 2>/dev/null`).catch(() => {})
      }
    }

    // Helper: download a disk from ESXi via vmkfstools clone + SSH dd pipe (for live migration)
    // Flow: 1) vmkfstools -i on ESXi to clone VMDK (works on locked disks via VMFS API)
    //       2) SSH dd to pipe the clone (unlocked) from ESXi to PVE node
    //       3) Cleanup clone on ESXi
    async function downloadDiskViaSsh(i: number, disk: EsxiDiskInfo, needsClone = false) {
      const diskSizeGB = (disk.capacityBytes / 1073741824).toFixed(1)
      const tmpFile = storageTempDir ? `${storageTempDir}/proxcenter-mig-${jobId}-disk${i}` : `/tmp/proxcenter-mig-${jobId}-disk${i}`
      const { esxiHost, esxiSshPort, esxiSshUser, setupCmd, sshPrefix, cleanupCmd } = buildEsxiSshPrefix(tmpFile)

      // Build the VMFS path
      const flatPath = disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
      const vmfsPath = `/vmfs/volumes/${disk.datastoreName}/${flatPath}`
      // Clone path on ESXi datastore (temporary, cleaned up after download)
      const cloneName = `.proxcenter-clone-${jobId}-disk${i}`
      const cloneVmdkPath = `/vmfs/volumes/${disk.datastoreName}/${cloneName}.vmdk`
      const cloneFlatPath = `/vmfs/volumes/${disk.datastoreName}/${cloneName}-flat.vmdk`

      let downloadPath = vmfsPath
      let cloneCreated = false

      if (needsClone) {
        // Step 1: Clone VMDK on ESXi using vmkfstools (works on locked/running VMDKs after snapshot)
        await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Cloning "${disk.label}" on ESXi via vmkfstools (${diskSizeGB} GB)...`)
        await updateJob(jobId, "transferring", {
          currentStep: `cloning_disk_${i + 1}`,
          currentDisk: i,
          bytesTransferred: BigInt(0),
          totalBytes: BigInt(disk.capacityBytes),
        })

        try {
          const descriptorPath = `/vmfs/volumes/${disk.datastoreName}/${disk.relativePath}`

          // Run vmkfstools clone in background on ESXi (via PVE → ESXi SSH)
          const cloneTmpPrefix = `/tmp/proxcenter-mig-${jobId}-clone${i}`
          const { esxiHost: clHost, esxiSshPort: clPort, esxiSshUser: clUser, setupCmd: clSetup, sshPrefix: clSshPrefix, cleanupCmd: clCleanup } = buildEsxiSshPrefix(cloneTmpPrefix)
          const cloneScript = `${cloneTmpPrefix}.sh`
          const cloneExitFile = `${cloneTmpPrefix}.exit`
          const cloneErrFile = `${cloneTmpPrefix}.stderr`
          const cloneOutFile = `${cloneTmpPrefix}.out`

          const cloneSshCmd = `${clSshPrefix} -p ${clPort} ${clUser}@${clHost} "vmkfstools -i '${descriptorPath}' '${cloneVmdkPath}' -d thin" >"${cloneOutFile}" 2>"${cloneErrFile}"`

          await executeSSH(config.targetConnectionId, nodeIp,
            `cat > "${cloneScript}" << 'CLEOF'\n${clSetup}\n${cloneSshCmd}\nEXIT_CODE=$?\n${clCleanup}\necho $EXIT_CODE > "${cloneExitFile}"\nCLEOF`
          )

          const startClone = await executeSSH(config.targetConnectionId, nodeIp,
            `nohup bash "${cloneScript}" > /dev/null 2>&1 & echo $!`
          )
          if (!startClone.success || !startClone.output?.trim()) {
            throw new Error(`Failed to start vmkfstools: ${startClone.error}`)
          }

          // Poll for clone completion with progress tracking via clone file size on ESXi
          const cloneStartTime = Date.now()
          while (true) {
            if (isCancelled(jobId)) throw new Error("Migration cancelled")
            if (Date.now() - cloneStartTime > 3600000) throw new Error("vmkfstools clone timed out (1h)")

            await new Promise(r => setTimeout(r, 5000))

            // Check clone file size on ESXi for progress (via nested SSH with sshpass setup)
            try {
              const sizeCheck = await executeSSH(config.targetConnectionId, nodeIp,
                `${clSetup} && ${clSshPrefix} -p ${clPort} ${clUser}@${clHost} "stat -c %s '${cloneFlatPath}' 2>/dev/null || echo 0" 2>/dev/null`
              )
              const clonedBytes = Number.parseInt(sizeCheck.output?.trim() || "0", 10) || 0
              if (clonedBytes > 0) {
                const cloneProgress = Math.min(Math.round((clonedBytes / disk.capacityBytes) * 100), 99)
                const elapsed = (Date.now() - cloneStartTime) / 1000
                const speed = elapsed > 0 ? clonedBytes / elapsed : 0
                const speedStr = speed > 1048576 ? `${(speed / 1048576).toFixed(1)} MB/s` : `${(speed / 1024).toFixed(0)} KB/s`
                await updateJob(jobId, "transferring", {
                  currentStep: `cloning_disk_${i + 1}`,
                  bytesTransferred: BigInt(clonedBytes),
                  totalBytes: BigInt(disk.capacityBytes),
                  transferSpeed: `Cloning: ${speedStr}`,
                  progress: Math.round(cloneProgress * 0.3),
                })
              }
            } catch {
              // Progress check failed — non-critical, continue polling
            }

            const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${cloneExitFile}" 2>/dev/null || echo RUNNING`)
            if (exitCheck.output?.trim() === "RUNNING") continue

            const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
            if (exitCode !== 0) {
              const stderrContent = await executeSSH(config.targetConnectionId, nodeIp, `cat "${cloneErrFile}" 2>/dev/null | head -c 500`)
              const errMsg = stderrContent.output?.trim() || "(no output)"
              await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${cloneScript}" "${cloneExitFile}" "${cloneErrFile}" "${cloneOutFile}" "${cloneTmpPrefix}.esxi-key"`)
              throw new Error(`vmkfstools failed (exit ${exitCode}): ${errMsg}`)
            }

            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${cloneScript}" "${cloneExitFile}" "${cloneErrFile}" "${cloneOutFile}" "${cloneTmpPrefix}.esxi-key"`)
            break
          }

          cloneCreated = true
          downloadPath = cloneFlatPath
          const cloneTime = Math.round((Date.now() - cloneStartTime) / 1000)
          await appendLog(jobId, `Clone created on ESXi datastore (${cloneTime}s)`, "success")
        } catch (cloneErr: any) {
          throw new Error(`vmkfstools clone failed: ${cloneErr.message}`)
        }
      }

      // Step 2: Download via SSH dd pipe (clone is unlocked, or VM is off so original is unlocked)
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Downloading "${disk.label}" via SSH dd (${diskSizeGB} GB)...`)
      await appendLog(jobId, `Source path: ${downloadPath}`, "info")

      await updateJob(jobId, "transferring", {
        currentStep: `downloading_disk_${i + 1}`,
        currentDisk: i,
        bytesTransferred: BigInt(0),
        totalBytes: BigInt(disk.capacityBytes),
      })

      const pidFile = `${tmpFile}.pid`
      const dlScript = `${tmpFile}.dl.sh`
      const errFile = `${tmpFile}.stderr`
      const sshCmd = `${sshPrefix} -p ${esxiSshPort} ${esxiSshUser}@${esxiHost} "dd if='${downloadPath}' bs=4M" > "${tmpFile}.vmdk" 2>"${errFile}"`

      await executeSSH(config.targetConnectionId, nodeIp,
        `cat > "${dlScript}" << 'DLEOF'\n${setupCmd}\n${sshCmd}\nEXIT_CODE=$?\n${cleanupCmd}\necho $EXIT_CODE > "${pidFile}.exit"\nDLEOF`
      )

      const startDl = await executeSSH(
        config.targetConnectionId, nodeIp,
        `nohup bash "${dlScript}" > /dev/null 2>&1 & echo $!`
      )
      if (!startDl.success || !startDl.output?.trim()) {
        if (cloneCreated) await executeOnEsxi(`vmkfstools -U '${cloneVmdkPath}'`).catch(() => {})
        throw new Error(`Failed to start SSH download: ${startDl.error}`)
      }
      const ddPid = startDl.output.trim()
      await executeSSH(config.targetConnectionId, nodeIp, `echo ${ddPid} > "${pidFile}"`)

      const totalBytes = disk.capacityBytes
      let downloadedBytes = 0
      let downloadSpeed = ""
      let downloadTime = 0
      const startTime = Date.now()

      try {
        while (true) {
          if (isCancelled(jobId)) {
            await executeSSH(config.targetConnectionId, nodeIp, `kill ${ddPid} 2>/dev/null; rm -f "${tmpFile}.vmdk" "${pidFile}" "${pidFile}.exit" "${dlScript}" "${tmpFile}.esxi-key" "${errFile}"`)
            throw new Error("Migration cancelled")
          }

          await new Promise(r => setTimeout(r, 3000))

          const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${pidFile}.exit" 2>/dev/null || echo RUNNING`)
          const isRunning = exitCheck.output?.trim() === "RUNNING"

          const sizeResult = await executeSSH(config.targetConnectionId, nodeIp, `stat -c %s "${tmpFile}.vmdk" 2>/dev/null || echo 0`)
          const currentSize = Number.parseInt(sizeResult.output?.trim() || "0", 10) || 0
          downloadedBytes = currentSize

          const elapsed = (Date.now() - startTime) / 1000
          const speedBps = elapsed > 0 ? currentSize / elapsed : 0
          downloadSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`

          const diskProgress = totalBytes > 0 ? Math.min(Math.round((currentSize / totalBytes) * 100), 99) : 0
          const overallProgress = Math.round((i / vmConfig.disks.length) * 100 + (diskProgress / vmConfig.disks.length))

          await updateJob(jobId, "transferring", {
            bytesTransferred: BigInt(currentSize),
            transferSpeed: downloadSpeed,
            progress: Math.round(overallProgress * 0.7),
          })

          if (!isRunning) {
            const exitCode = Number.parseInt(exitCheck.output?.trim() || "1", 10)
            downloadTime = elapsed

            if (exitCode !== 0) {
              // Check if the file was actually downloaded despite non-zero exit (SSH warnings can cause exit 1)
              const fileSizeOnError = await executeSSH(config.targetConnectionId, nodeIp, `stat -c %s "${tmpFile}.vmdk" 2>/dev/null || echo 0`)
              const actualSizeOnError = Number.parseInt(fileSizeOnError.output?.trim() || "0", 10)
              const expectedMin = Math.floor(disk.capacityBytes * 0.9) // Allow 10% tolerance for thin disks

              if (actualSizeOnError >= expectedMin) {
                // File looks complete despite non-zero exit — SSH warning, not a real error
                await appendLog(jobId, `SSH exited with code ${exitCode} but file size looks correct (${(actualSizeOnError / 1073741824).toFixed(1)} GB) — continuing`, "warn")
              } else {
                const stderrContent = await executeSSH(config.targetConnectionId, nodeIp, `cat "${errFile}" 2>/dev/null | head -c 500`)
                const errMsg = stderrContent.output?.trim() || "(no stderr output)"
                await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vmdk" "${pidFile}" "${pidFile}.exit" "${dlScript}" "${tmpFile}.esxi-key" "${errFile}"`)
                throw new Error(`SSH dd download failed (exit ${exitCode}): ${errMsg}`)
              }
            }

            const fileSizeCheck = await executeSSH(config.targetConnectionId, nodeIp, `stat -c %s "${tmpFile}.vmdk" 2>/dev/null || echo 0`)
            const actualSize = Number.parseInt(fileSizeCheck.output?.trim() || "0", 10)
            if (actualSize < 1048576) {
              await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vmdk" "${pidFile}" "${pidFile}.exit" "${dlScript}" "${tmpFile}.esxi-key"`)
              throw new Error(`SSH dd produced a ${actualSize}-byte file (expected ~${diskSizeGB} GB)`)
            }

            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${pidFile}" "${pidFile}.exit" "${dlScript}" "${tmpFile}.esxi-key" "${errFile}"`)
            break
          }
        }
      } finally {
        // Step 3: Always cleanup the clone on ESXi
        if (cloneCreated) {
          await executeOnEsxi(`vmkfstools -U '${cloneVmdkPath}'`).catch((e) => {
            appendLog(jobId, `Warning: failed to cleanup ESXi clone: ${e.message}`, "warn")
          })
        }
      }

      await updateJob(jobId, "transferring", {
        bytesTransferred: BigInt(downloadedBytes),
        transferSpeed: downloadSpeed,
      })
      await appendLog(jobId, `SSH download complete: ${(downloadedBytes / 1073741824).toFixed(1)} GB in ${downloadTime.toFixed(0)}s (${downloadSpeed})`, "success")
    }

    // Helper: convert + import + attach a single disk
    async function convertAndImportDisk(i: number) {
      const tmpFile = storageTempDir ? `${storageTempDir}/proxcenter-mig-${jobId}-disk${i}` : `/tmp/proxcenter-mig-${jobId}-disk${i}`
      const scsiSlot = `scsi${i}`

      // Convert VMDK to target format
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Converting to ${importFormat} format...`)
      await updateJob(jobId, "transferring", { currentStep: `converting_disk_${i + 1}` })

      const convertResult = await executeSSHWithTimeout(
        prisma, config.targetConnectionId, nodeIp,
        `qemu-img convert -f raw -O ${importFormat} "${tmpFile}.vmdk" "${tmpFile}.${importFormat}" 2>&1 && echo CONVERT_OK`,
        14400000
      )
      if (!convertResult.success || !convertResult.output?.includes("CONVERT_OK")) {
        await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vmdk" "${tmpFile}.${importFormat}"`)
        throw new Error(`Conversion failed: ${convertResult.error || convertResult.output}`)
      }
      await appendLog(jobId, `Conversion to ${importFormat} complete`, "success")
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vmdk"`)

      if (isCancelled(jobId)) throw new Error("Migration cancelled")

      // Import disk into Proxmox storage
      await appendLog(jobId, `Importing disk into storage "${config.targetStorage}"...`)
      await updateJob(jobId, "transferring", { currentStep: `importing_disk_${i + 1}` })

      const importResult = await executeSSHWithTimeout(
        prisma, config.targetConnectionId, nodeIp,
        `qm disk import ${targetVmid} "${tmpFile}.${importFormat}" ${config.targetStorage} --format ${importFormat} 2>&1`,
        3600000
      )
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.${importFormat}"`)

      if (!importResult.success) {
        throw new Error(`Disk import failed: ${importResult.error}`)
      }

      // Parse the actual disk volume name from qm disk import output
      let diskVolume = ""
      const importOutput = importResult.output || ""
      // Try standard format: "Successfully imported disk as 'unused0:storage:vm-XXX-disk-N'"
      const importMatch = importOutput.match(/Successfully imported disk as '(?:unused\d+:)?(.+?)'/)
      // Also try alternate format: "unused0: successfully imported disk 'storage:vm-XXX-disk-N'"
      const altMatch = !importMatch && importOutput.match(/unused\d+:\s*successfully imported disk '(.+?)'/i)
      if (importMatch?.[1]) {
        diskVolume = importMatch[1]
      } else if (altMatch?.[1]) {
        diskVolume = altMatch[1]
      } else {
        await appendLog(jobId, `Parsing import output failed (output: ${importOutput.substring(0, 200)}), reading VM config to find unused disk...`, "info")
        try {
          const vmConf = await pveFetch<Record<string, any>>(
            pveConn,
            `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`
          )
          const unusedKeys = Object.keys(vmConf)
            .filter(k => k.startsWith("unused"))
            .sort((a, b) => a.localeCompare(b))
          if (unusedKeys.length > 0) {
            diskVolume = vmConf[unusedKeys[unusedKeys.length - 1]] as string
            await appendLog(jobId, `Found unused disk in VM config: ${diskVolume}`, "info")
          }
        } catch (e: any) {
          await appendLog(jobId, `Failed to read VM config: ${e.message}`, "warn")
        }
        if (!diskVolume) {
          diskVolume = `${config.targetStorage}:vm-${targetVmid}-disk-${i}`
          await appendLog(jobId, `Using guessed volume name: ${diskVolume}`, "warn")
        }
      }

      // Attach disk to SCSI slot via PVE API
      const attachBody = new URLSearchParams({
        [scsiSlot]: `${diskVolume}${isFileBased ? ",discard=on" : ""}`,
      })
      try {
        await pveFetch<any>(
          pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
          { method: "PUT", body: attachBody }
        )
        await appendLog(jobId, `Disk ${i + 1} imported and attached as ${scsiSlot}`, "success")
      } catch (attachErr: any) {
        await appendLog(jobId, `Warning: Could not auto-attach ${scsiSlot}: ${attachErr.message}`, "warn")
      }
    }

    // Mount SSHFS if transfer mode requires it
    // All disks on the same datastore share one mount; multiple datastores need separate mounts
    const sshfsMountedDatastores = new Map<string, string>() // datastoreName → mountPath
    if (useSSHFS) {
      const datastores = [...new Set(vmConfig.disks.map(d => d.datastoreName))]
      for (const ds of datastores) {
        const baseMountPath = sshfsMountPath
        // For multi-datastore VMs, append datastore name to mount path
        if (datastores.length > 1) {
          sshfsMountPath = `${baseMountPath}-${ds.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        }
        const mountPath = await mountSshfs(ds)
        sshfsMountedDatastores.set(ds, mountPath)
        if (datastores.length > 1) {
          sshfsMountPath = baseMountPath // restore
        }
      }
    }

    try {

    if (isSshfsBoot) {
      // ── SSHFS Boot mode: near-zero downtime ──
      // Flow: stop VMware VM → boot Proxmox VM from SSHFS-mounted VMDKs → drive-mirror to local storage
      // Downtime = VMware stop + Proxmox boot (seconds). Disk copy runs in background while VM is live.

      await appendLog(jobId, "=== SSHFS BOOT: Near-zero downtime migration ===", "info")

      // ── Phase 1: Deploy temp SSH key to ESXi (QEMU libssh requires key auth) ──
      const esxiHost = new URL(esxiUrl).hostname
      const esxiSshPort = esxiConn.sshPort || 22
      const esxiSshUser = esxiConn.sshUser || "root"
      const esxiPass = esxiConn.sshPassEnc ? decryptSecret(esxiConn.sshPassEnc) : ""
      const esxiKeyRaw = (esxiConn.sshAuthMethod === "key" && esxiConn.sshKeyEnc) ? decryptSecret(esxiConn.sshKeyEnc) : ""

      const tmpKeyPath = `/tmp/proxcenter-sshfsboot-${jobId}-key`
      let qemuSshKeyPath = ""
      let useSshfsForBoot = false
      let ndbSocketPaths: string[] = []

      if (esxiKeyRaw) {
        // Already have a key - just write it to PVE node
        await executeSSH(config.targetConnectionId, nodeIp,
          `cat > "${tmpKeyPath}" << 'KEYEOF'\n${esxiKeyRaw}\nKEYEOF\nchmod 600 "${tmpKeyPath}"`)
        qemuSshKeyPath = tmpKeyPath
        await appendLog(jobId, "Using existing SSH key for QEMU SSH driver", "info")
      } else if (esxiPass) {
        // Generate a temp key and deploy to ESXi
        await appendLog(jobId, "Deploying temporary SSH key to ESXi...", "info")

        // Generate RSA key on PVE node (best ESXi compatibility)
        const genResult = await executeSSH(config.targetConnectionId, nodeIp,
          `ssh-keygen -t rsa -b 4096 -f "${tmpKeyPath}" -N '' -q -C 'proxcenter-sshfsboot-${jobId}' 2>&1 && echo KEYGEN_OK`)
        if (!genResult.success || !genResult.output?.includes("KEYGEN_OK")) {
          throw new Error(`Failed to generate SSH key: ${genResult.error || genResult.output}`)
        }

        // Read public key
        const pubKeyResult = await executeSSH(config.targetConnectionId, nodeIp, `cat "${tmpKeyPath}.pub"`)
        const pubKey = pubKeyResult.output?.trim()
        if (!pubKey) throw new Error("Failed to read generated SSH public key")

        // Deploy to ESXi via nested SSH (using sshpass for password auth)
        // ESXi stores keys in /etc/ssh/keys-<user>/authorized_keys
        const safeEsxiPass = esxiPass.replace(/'/g, "'\\''")
        const esxiSshOpts = `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=15 -o HostKeyAlgorithms=+ssh-rsa,ssh-ed25519 -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group14-sha256 -o PreferredAuthentications=keyboard-interactive,password`

        const deployCmd = `export SSHPASS='${safeEsxiPass}' && sshpass -e ssh ${esxiSshOpts} -p ${esxiSshPort} ${esxiSshUser}@${esxiHost} "mkdir -p /etc/ssh/keys-${esxiSshUser} 2>/dev/null; echo '${pubKey}' >> /etc/ssh/keys-${esxiSshUser}/authorized_keys; echo DEPLOYED" 2>&1`
        const deployResult = await executeSSH(config.targetConnectionId, nodeIp, deployCmd)

        if (!deployResult.output?.includes("DEPLOYED")) {
          // Fallback: try ~/.ssh/authorized_keys
          const deployCmd2 = `export SSHPASS='${safeEsxiPass}' && sshpass -e ssh ${esxiSshOpts} -p ${esxiSshPort} ${esxiSshUser}@${esxiHost} "mkdir -p ~/.ssh 2>/dev/null; chmod 700 ~/.ssh; echo '${pubKey}' >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; echo DEPLOYED" 2>&1`
          const deployResult2 = await executeSSH(config.targetConnectionId, nodeIp, deployCmd2)

          if (!deployResult2.output?.includes("DEPLOYED")) {
            await appendLog(jobId, "SSH key deployment to ESXi failed - will use SSHFS/FUSE fallback for boot", "warn")
          }
        }

        // Verify key-based login works
        const verifyResult = await executeSSH(config.targetConnectionId, nodeIp,
          `ssh -i "${tmpKeyPath}" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 -o HostKeyAlgorithms=+ssh-rsa,ssh-ed25519 -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group14-sha256 -o PubkeyAcceptedAlgorithms=+ssh-rsa,ssh-ed25519 -p ${esxiSshPort} ${esxiSshUser}@${esxiHost} 'echo KEYOK' 2>&1`)

        if (verifyResult.output?.includes("KEYOK")) {
          qemuSshKeyPath = tmpKeyPath
          await appendLog(jobId, "SSH key deployed and verified", "success")
        } else {
          await appendLog(jobId, "SSH key verification failed - will use SSHFS/FUSE fallback for boot", "warn")
        }
      }

      // ── Phase 2: Test QEMU SSH driver connectivity ──
      let bootMethod: "qemu-ssh" | "sshfs" | "nbd" | null = null
      const diskBus = vmConfig.disks[0]?.controllerType?.toLowerCase()?.includes("scsi") ? "scsi" : "sata"
      const firstDisk = vmConfig.disks[0]

      // Detect vSAN: -flat.vmdk doesn't exist as a separate POSIX file on vSAN
      // We need to check via SSHFS whether the flat file or the descriptor should be used
      const firstFlatPath = firstDisk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
      const firstDescriptorPath = firstDisk.relativePath
      let useVmdkFormat = false // true when we must use VMDK descriptor instead of flat raw

      // Check if -flat.vmdk exists (won't on vSAN)
      if (useSSHFS) {
        const firstMountPath = sshfsMountedDatastores.get(firstDisk.datastoreName) || sshfsMountPath
        const flatCheck = await executeSSH(config.targetConnectionId, nodeIp,
          `test -f "${firstMountPath}/${firstFlatPath}" && echo EXISTS || echo MISSING`)
        if (flatCheck.output?.trim() !== "EXISTS") {
          const descCheck = await executeSSH(config.targetConnectionId, nodeIp,
            `test -f "${firstMountPath}/${firstDescriptorPath}" && echo EXISTS || echo MISSING`)
          if (descCheck.output?.trim() === "EXISTS") {
            useVmdkFormat = true
            await appendLog(jobId, "vSAN detected: -flat.vmdk not found, using VMDK descriptor with format=vmdk", "info")
          }
        }
      }

      // Resolve disk path and format based on vSAN detection
      const bootDiskFile = useVmdkFormat ? firstDescriptorPath : firstFlatPath
      const bootDiskFormat = useVmdkFormat ? "vmdk" : "raw"
      const firstEsxiPath = `/vmfs/volumes/${firstDisk.datastoreName}/${bootDiskFile}`

      if (qemuSshKeyPath) {
        await appendLog(jobId, "Testing QEMU SSH driver connectivity...", "info")
        const qemuTestResult = await executeSSH(config.targetConnectionId, nodeIp,
          `timeout 15 qemu-img info 'json:{"file.driver":"ssh","file.host":"${esxiHost}","file.port":${esxiSshPort},"file.path":"${firstEsxiPath}","file.user":"${esxiSshUser}","file.host-key-check.mode":"none","file.identity-file":"${qemuSshKeyPath}"}' 2>&1`)

        if (qemuTestResult.output?.includes("virtual size") || qemuTestResult.output?.includes("file format")) {
          bootMethod = "qemu-ssh"
          await appendLog(jobId, `QEMU SSH driver: connection OK (format=${bootDiskFormat})`, "success")
        } else {
          await appendLog(jobId, `QEMU SSH driver test failed: ${qemuTestResult.output?.substring(0, 200)}`, "warn")
        }
      }

      // Fallback: SSHFS/FUSE - QEMU reads from local FUSE mount path
      if (!bootMethod) {
        await appendLog(jobId, "Trying SSHFS/FUSE boot (QEMU reads from SSHFS mount)...", "info")
        const firstMountPath = sshfsMountedDatastores.get(firstDisk.datastoreName) || sshfsMountPath
        const firstFusePath = `${firstMountPath}/${bootDiskFile}`

        const fuseTestResult = await executeSSH(config.targetConnectionId, nodeIp,
          `timeout 10 qemu-img info ${useVmdkFormat ? "-f vmdk " : ""}'${firstFusePath}' 2>&1`)
        if (fuseTestResult.output?.includes("virtual size") || fuseTestResult.output?.includes("file format")) {
          useSshfsForBoot = true

          // AppArmor: QEMU on Proxmox is restricted - allow reading from FUSE mount
          await appendLog(jobId, "Setting AppArmor complain mode for FUSE access...", "info")
          await executeSSH(config.targetConnectionId, nodeIp,
            `aa-complain /etc/apparmor.d/usr.bin.kvm 2>/dev/null; ` +
            `if [ -f /etc/apparmor.d/local/usr.bin.kvm ]; then ` +
            `echo '${firstMountPath}/** rk,' >> /etc/apparmor.d/local/usr.bin.kvm 2>/dev/null; ` +
            `echo '/tmp/proxcenter-sshfs-*/** rk,' >> /etc/apparmor.d/local/usr.bin.kvm 2>/dev/null; ` +
            `apparmor_parser -r /etc/apparmor.d/usr.bin.kvm 2>/dev/null; fi`)

          bootMethod = "sshfs"
          await appendLog(jobId, "SSHFS/FUSE boot: QEMU can read mounted VMDKs", "success")
        } else {
          await appendLog(jobId, `SSHFS/FUSE test failed: ${fuseTestResult.output?.substring(0, 200)}`, "warn")
        }
      }

      // Fallback: NBD bridge - qemu-nbd serves SSHFS file via Unix socket, QEMU connects to NBD
      if (!bootMethod) {
        await appendLog(jobId, "Trying NBD bridge (qemu-nbd serves SSHFS files via Unix socket)...", "info")
        const nbdModResult = await executeSSH(config.targetConnectionId, nodeIp, "modprobe nbd max_part=0 2>/dev/null; which qemu-nbd 2>/dev/null")
        if (nbdModResult.success && nbdModResult.output?.trim()) {
          let nbdOk = true
          for (let di = 0; di < vmConfig.disks.length; di++) {
            const disk = vmConfig.disks[di]
            const diskFile = useVmdkFormat ? disk.relativePath : disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
            const mp = sshfsMountedDatastores.get(disk.datastoreName) || sshfsMountPath
            const fusePath = `${mp}/${diskFile}`
            const sockPath = `/tmp/proxcenter-nbd-${jobId}-${di}.sock`

            await executeSSH(config.targetConnectionId, nodeIp,
              `fuser -k "${sockPath}" 2>/dev/null; rm -f "${sockPath}"`)

            const nbdStart = await executeSSH(config.targetConnectionId, nodeIp,
              `qemu-nbd --fork --persistent --socket="${sockPath}" --format=${bootDiskFormat} --cache=writeback --aio=threads '${fusePath}' 2>&1`)

            await new Promise(r => setTimeout(r, 1000))
            const sockCheck = await executeSSH(config.targetConnectionId, nodeIp, `test -S "${sockPath}" && echo EXISTS`)
            if (nbdStart.success && sockCheck.output?.includes("EXISTS")) {
              ndbSocketPaths.push(sockPath)
              await appendLog(jobId, `NBD disk ${di}: ${sockPath} serving ${fusePath}`, "info")
            } else {
              await appendLog(jobId, `NBD disk ${di}: failed to start - ${nbdStart.output?.substring(0, 150)}`, "warn")
              nbdOk = false
              break
            }
          }
          if (nbdOk && ndbSocketPaths.length === vmConfig.disks.length) {
            bootMethod = "nbd"
            await appendLog(jobId, "NBD bridge ready", "success")
          }
        }
      }

      if (!bootMethod) {
        // All boot methods failed - fall back to regular SSHFS offline copy
        await appendLog(jobId, "All remote boot methods failed - falling back to offline SSHFS copy", "warn")
        // Clean up temp key
        await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpKeyPath}" "${tmpKeyPath}.pub"`)
        // Re-use the SSHFS offline transfer code path
        for (let i = 0; i < vmConfig.disks.length; i++) {
          await updateJob(jobId, "transferring", { currentDisk: i, progress: Math.round((i / vmConfig.disks.length) * 100) })
          const diskDs = vmConfig.disks[i].datastoreName
          if (sshfsMountedDatastores.has(diskDs)) sshfsMountPath = sshfsMountedDatastores.get(diskDs)!
          if (isFileBased) {
            await transferDiskViaSshfs(i, vmConfig.disks[i])
          } else {
            const vol = await allocateBlockVolume(vmConfig.disks[i].capacityBytes)
            await streamDiskViaSshfsToBlock(i, vmConfig.disks[i], vol.devicePath)
            if (isCancelled(jobId)) throw new Error("Migration cancelled")
            await attachBlockDisk(i, vol.volumeId)
          }
          await updateJob(jobId, "transferring", { currentDisk: i + 1, progress: Math.round(((i + 1) / vmConfig.disks.length) * 100) })
        }
      } else {
        // ── Phase 3: Allocate local target volumes for drive-mirror ──
        await appendLog(jobId, `Boot method: ${bootMethod} - allocating local target volumes (${isFileBased ? 'file-based' : 'block'})...`, "info")
        const localVolumes: { volumeId: string, devicePath: string, isFileVol?: boolean }[] = []

        for (let di = 0; di < vmConfig.disks.length; di++) {
          const diskSizeBytes = vmConfig.disks[di].capacityBytes
          if (isFileBased) {
            // File-based storage (dir, NFS, CIFS): create a raw image file for drive-mirror target
            const storagePath = storageConfig?.path || '/var/lib/vz'
            const imgDir = `${storagePath}/images/${targetVmid}`
            await executeSSH(config.targetConnectionId, nodeIp, `mkdir -p "${imgDir}"`)
            const imgPath = `${imgDir}/vm-${targetVmid}-disk-${di}.raw`
            const sizeGB = Math.ceil(diskSizeBytes / 1073741824)
            const createResult = await executeSSH(config.targetConnectionId, nodeIp,
              `qemu-img create -f raw "${imgPath}" ${sizeGB}G 2>&1`)
            if (!createResult.success) {
              throw new Error(`Failed to create disk image: ${createResult.error || createResult.output}`)
            }
            localVolumes.push({ volumeId: `${config.targetStorage}:${targetVmid}/vm-${targetVmid}-disk-${di}.raw`, devicePath: imgPath, isFileVol: true })
            await appendLog(jobId, `Disk ${di}: ${imgPath} (${sizeGB} GB raw image)`, "info")
          } else {
            // Block storage (LVM, ZFS, RBD): pre-allocate volume
            const vol = await allocateBlockVolume(diskSizeBytes)
            localVolumes.push(vol)
            await appendLog(jobId, `Disk ${di}: ${vol.volumeId} -> ${vol.devicePath} (${(diskSizeBytes / 1073741824).toFixed(1)} GB)`, "info")
          }
        }

        // ── Phase 4: Write QEMU args to VM config ──
        // Build -drive and -device args for each disk pointing to the remote source
        const confPath = `/etc/pve/qemu-server/${targetVmid}.conf`
        const sshKeyOpt = qemuSshKeyPath ? `,file.identity-file=${qemuSshKeyPath}` : ""

        // Determine SCSI controller if needed
        let scsiControllerArgs = ""
        if (diskBus === "scsi") {
          // Read scsihw from VM config
          const scsihwResult = await executeSSH(config.targetConnectionId, nodeIp,
            `grep '^scsihw:' "${confPath}" 2>/dev/null`)
          const scsihwType = scsihwResult.output?.trim().split(":")[1]?.trim() || "virtio-scsi-pci"
          const scsiDeviceMap: Record<string, string> = {
            "pvscsi": "pvscsi",
            "virtio-scsi-pci": "virtio-scsi-pci",
            "virtio-scsi-single": "virtio-scsi-pci",
            "lsi": "lsi53c895a",
            "lsi53c810": "lsi53c810",
            "megasas": "megasas",
          }
          scsiControllerArgs = `-device ${scsiDeviceMap[scsihwType] || "virtio-scsi-pci"},id=scsihw0 `
        }

        const argsParts: string[] = []
        for (let di = 0; di < vmConfig.disks.length; di++) {
          const disk = vmConfig.disks[di]
          const diskFile = useVmdkFormat ? disk.relativePath : disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
          const driveId = `sshfs-disk${di}`

          let driveSpec = ""
          if (bootMethod === "qemu-ssh") {
            const esxiPath = `/vmfs/volumes/${disk.datastoreName}/${diskFile}`
            driveSpec = `file.driver=ssh,file.host=${esxiHost},file.port=${esxiSshPort},file.path=${esxiPath},file.user=${esxiSshUser},file.host-key-check.mode=none${sshKeyOpt},format=${bootDiskFormat},if=none,id=${driveId},cache=writeback,aio=threads`
          } else if (bootMethod === "sshfs") {
            const mp = sshfsMountedDatastores.get(disk.datastoreName) || sshfsMountPath
            const fusePath = `${mp}/${diskFile}`
            driveSpec = `file=${fusePath},format=${bootDiskFormat},if=none,id=${driveId},cache=writeback,aio=threads,detect-zeroes=on`
          } else if (bootMethod === "nbd") {
            const sockPath = ndbSocketPaths[di]
            // NBD exports raw blocks regardless of source format (qemu-nbd handles conversion)
            driveSpec = `file.driver=nbd,file.path=${sockPath},format=raw,if=none,id=${driveId},cache=writeback,aio=threads`
          }

          // Device spec matching the disk controller
          let deviceSpec: string
          if (diskBus === "scsi") {
            deviceSpec = `scsi-hd,bus=scsihw0.0,scsi-id=${di},lun=0,drive=${driveId},bootindex=${di}`
          } else {
            deviceSpec = `ide-hd,drive=${driveId},bus=ide.${Math.floor(di / 2)},unit=${di % 2},bootindex=${di}`
          }

          argsParts.push(`-drive ${driveSpec}`)
          argsParts.push(`-device ${deviceSpec}`)
        }

        const fullArgs = scsiControllerArgs + argsParts.join(" ")

        // Remove existing disk lines and add custom args
        for (let di = 0; di < vmConfig.disks.length; di++) {
          await executeSSH(config.targetConnectionId, nodeIp,
            `sed -i '/^scsi${di}:/d; /^sata${di}:/d; /^ide${di}:/d; /^virtio${di}:/d' "${confPath}"`)
        }
        await executeSSH(config.targetConnectionId, nodeIp,
          `sed -i '/^args:/d; /^boot:/d' "${confPath}"`)

        // Write args line (escape single quotes)
        const escapedArgs = fullArgs.replace(/'/g, "'\\''")
        await executeSSH(config.targetConnectionId, nodeIp,
          `echo 'args: ${escapedArgs}' >> "${confPath}"`)

        // Ensure key is readable by QEMU process
        if (qemuSshKeyPath) {
          await executeSSH(config.targetConnectionId, nodeIp, `chmod 644 "${qemuSshKeyPath}" 2>/dev/null`)
        }

        await appendLog(jobId, `VM config written with ${bootMethod} drive args`, "success")

        // ── Phase 5: Start VM (downtime ends when VM boots) ──
        const downtimeStart = Date.now()
        await appendLog(jobId, `Starting VM ${targetVmid} (${bootMethod} backend + cache=writeback)...`, "info")

        await pveFetch<any>(
          pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/start`,
          { method: "POST" }
        )

        // Wait for VM to be running
        await new Promise(r => setTimeout(r, 8000))
        const vmStatus = await pveFetch<any>(
          pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/current`
        )

        if (vmStatus?.status !== "running") {
          // Check QEMU logs for error
          const logResult = await executeSSH(config.targetConnectionId, nodeIp,
            `tail -20 /var/log/pve/qemu-server/${targetVmid}.log 2>/dev/null | grep -i 'error\\|failed\\|abort' | tail -3`)
          const qemuLog = logResult.output?.trim() || "(no error in logs)"
          await appendLog(jobId, `VM failed to start (status: ${vmStatus?.status}). QEMU log: ${qemuLog}`, "error")

          // Try NBD fallback if we were on SSHFS
          if (bootMethod === "sshfs" && ndbSocketPaths.length === 0) {
            await appendLog(jobId, "Retrying with NBD bridge fallback...", "warn")
            // Set up NBD
            await executeSSH(config.targetConnectionId, nodeIp, "modprobe nbd max_part=0 2>/dev/null")
            let nbdFallbackOk = true
            const nbdFallbackParts: string[] = []
            for (let di = 0; di < vmConfig.disks.length; di++) {
              const disk = vmConfig.disks[di]
              const diskP = useVmdkFormat ? disk.relativePath : disk.relativePath.replace(/\.vmdk$/, "-flat.vmdk")
              const mp = sshfsMountedDatastores.get(disk.datastoreName) || sshfsMountPath
              const fusePath = `${mp}/${diskP}`
              const sockPath = `/tmp/proxcenter-nbd-${jobId}-${di}.sock`

              await executeSSH(config.targetConnectionId, nodeIp, `fuser -k "${sockPath}" 2>/dev/null; rm -f "${sockPath}"`)
              const nbdStartResult = await executeSSH(config.targetConnectionId, nodeIp,
                `qemu-nbd --fork --persistent --socket="${sockPath}" --format=${bootDiskFormat} --cache=writeback --aio=threads '${fusePath}' 2>&1`)
              await new Promise(r => setTimeout(r, 1000))
              const sockExists = await executeSSH(config.targetConnectionId, nodeIp, `test -S "${sockPath}" && echo EXISTS`)
              if (nbdStartResult.success && sockExists.output?.includes("EXISTS")) {
                ndbSocketPaths.push(sockPath)
                const driveId = `nbd-disk${di}`
                const driveSpec = `file.driver=nbd,file.path=${sockPath},format=raw,if=none,id=${driveId},cache=writeback,aio=threads`
                const deviceSpec = diskBus === "scsi"
                  ? `scsi-hd,bus=scsihw0.0,scsi-id=${di},lun=0,drive=${driveId},bootindex=${di}`
                  : `ide-hd,drive=${driveId},bus=ide.${Math.floor(di / 2)},unit=${di % 2},bootindex=${di}`
                nbdFallbackParts.push(`-drive ${driveSpec}`)
                nbdFallbackParts.push(`-device ${deviceSpec}`)
              } else {
                nbdFallbackOk = false
                break
              }
            }

            if (nbdFallbackOk && nbdFallbackParts.length > 0) {
              const nbdArgs = scsiControllerArgs + nbdFallbackParts.join(" ")
              const nbdEscaped = nbdArgs.replace(/'/g, "'\\''")
              await executeSSH(config.targetConnectionId, nodeIp,
                `sed -i '/^args:/d' "${confPath}" && echo 'args: ${nbdEscaped}' >> "${confPath}"`)
              bootMethod = "nbd"
              await pveFetch<any>(pveConn,
                `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/start`,
                { method: "POST" })
              await new Promise(r => setTimeout(r, 8000))
              const vmStatus2 = await pveFetch<any>(pveConn,
                `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/current`)
              if (vmStatus2?.status === "running") {
                await appendLog(jobId, `VM ${targetVmid} STARTED via NBD bridge - DOWNTIME ENDS`, "success")
              } else {
                throw new Error("VM failed to start with all boot methods (SSHFS + NBD). Check QEMU logs on the Proxmox node.")
              }
            } else {
              throw new Error("VM failed to start and NBD fallback also failed. Check QEMU logs on the Proxmox node.")
            }
          } else {
            throw new Error(`VM failed to start via ${bootMethod}. Check QEMU logs: tail /var/log/pve/qemu-server/${targetVmid}.log`)
          }
        } else {
          const downtimeSec = Math.round((Date.now() - downtimeStart) / 1000)
          await appendLog(jobId, `VM ${targetVmid} STARTED via ${bootMethod} - DOWNTIME ENDS (${downtimeSec}s)`, "success")
          await appendLog(jobId, `VM is running on ${bootMethod}-backed storage with writeback cache`, "info")
        }

        // ── Phase 6: drive-mirror to copy data from remote to local volumes ──
        await appendLog(jobId, "Starting live storage migration (drive-mirror)...", "info")
        await updateJob(jobId, "transferring", { progress: 5, currentStep: "drive_mirror" })

        // Helper: send HMP command to running QEMU VM via Proxmox monitor API
        // Send HMP command to QEMU via "qm monitor" over SSH (API monitor endpoint is root-only)
        async function qmMonitorCmd(command: string): Promise<{ success: boolean, output: string }> {
          const safeCmd = command.replace(/'/g, "'\\''")
          const result = await executeSSH(config.targetConnectionId, nodeIp,
            `echo '${safeCmd}' | qm monitor ${targetVmid} 2>&1`)
          if (!result.success) {
            return { success: false, output: result.error || "" }
          }
          // qm monitor outputs "Entering QEMU Monitor...\n<output>\n" — strip the header
          const output = (result.output || "").replace(/^Entering.*?Monitor[^\n]*\n?/i, "").trim()
          return { success: true, output }
        }

        // Start drive-mirror for each disk
        const mirrors: { driveId: string, diskTotal: number, diskIndex: number }[] = []

        for (let di = 0; di < vmConfig.disks.length; di++) {
          const driveId = bootMethod === "nbd" ? `nbd-disk${di}` : `sshfs-disk${di}`
          const targetPath = localVolumes[di].devicePath
          const diskTotal = vmConfig.disks[di].capacityBytes

          await appendLog(jobId, `drive-mirror: ${driveId} -> ${targetPath} (${(diskTotal / 1073741824).toFixed(1)} GB)`, "info")

          // Verify drive exists in QEMU block graph
          const blockInfo = await qmMonitorCmd("info block")
          if (!blockInfo.output.includes(driveId)) {
            const drives = blockInfo.output.split("\n").filter(l => l.includes(":") && !l.includes("Removable")).map(l => l.trim().split(":")[0])
            await appendLog(jobId, `drive '${driveId}' not found. Available: ${drives.slice(0, 10).join(", ")}`, "warn")
            throw new Error(`Drive ${driveId} not found in QEMU block graph`)
          }

          // Start drive-mirror: -n = reuse existing target, -f = skip size check
          let mirrorStarted = false
          for (const cmd of [`drive_mirror -n -f ${driveId} ${targetPath} raw`, `drive_mirror -n ${driveId} ${targetPath} raw`]) {
            await appendLog(jobId, `drive-mirror cmd: ${cmd}`, "info")
            const mirrorResult = await qmMonitorCmd(cmd)
            await appendLog(jobId, `drive-mirror response: ${mirrorResult.output.substring(0, 200)}`, "info")
            if (mirrorResult.success && !mirrorResult.output.toLowerCase().includes("error")) {
              // Set speed to unlimited
              await qmMonitorCmd(`block_job_set_speed ${driveId} 0`)
              // Verify job started
              await new Promise(r => setTimeout(r, 1500))
              const jobsCheck = await qmMonitorCmd("info block-jobs")
              await appendLog(jobId, `block-jobs: ${jobsCheck.output.substring(0, 200)}`, "info")
              if (jobsCheck.output.includes(driveId)) {
                mirrorStarted = true
                mirrors.push({ driveId, diskTotal, diskIndex: di })
                await appendLog(jobId, `drive-mirror started: ${driveId}`, "success")
                break
              }
              // Wait a bit more
              await new Promise(r => setTimeout(r, 3000))
              const jobsCheck2 = await qmMonitorCmd("info block-jobs")
              if (jobsCheck2.output.includes(driveId)) {
                mirrorStarted = true
                mirrors.push({ driveId, diskTotal, diskIndex: di })
                await appendLog(jobId, `drive-mirror started (delayed): ${driveId}`, "success")
                break
              }
            } else {
              await appendLog(jobId, `drive-mirror attempt failed: ${mirrorResult.output.substring(0, 200)}`, "warn")
            }
          }

          if (!mirrorStarted) {
            throw new Error(`drive-mirror failed to start for ${driveId}. This can happen if QEMU cannot write to the target device.`)
          }
        }

        // ── Phase 7: Poll drive-mirror progress until all mirrors are ready ──
        const MIRROR_TIMEOUT = 7200000 // 2h
        const PAUSE_PIVOT_AFTER_MS = 60000 // 60s at 100% before pause-pivot
        const readyDrives = new Set<string>()
        const at100Since = new Map<string, number>() // driveId -> timestamp
        const mirrorStart = Date.now()
        let lastProgressLog = 0

        while (Date.now() - mirrorStart < MIRROR_TIMEOUT) {
          if (isCancelled(jobId)) {
            for (const m of mirrors) await qmMonitorCmd(`block_job_cancel ${m.driveId}`)
            throw new Error("Migration cancelled")
          }
          await new Promise(r => setTimeout(r, 2000))

          const jobsResult = await qmMonitorCmd("info block-jobs")
          if (!jobsResult.success) continue

          let allNear100 = true

          for (const mirror of mirrors) {
            if (readyDrives.has(mirror.driveId)) continue

            // Check if drive is no longer in block-jobs (completed or errored)
            if (!jobsResult.output.includes(mirror.driveId)) {
              const elapsed = Date.now() - mirrorStart
              if (elapsed < 10000) { allNear100 = false; continue }
              readyDrives.add(mirror.driveId)
              continue
            }

            // Check if this drive is "ready" (mirror synced, waiting for pivot)
            const readyMatch = new RegExp(`${mirror.driveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*ready`, "i")
            if (readyMatch.test(jobsResult.output)) {
              readyDrives.add(mirror.driveId)
              continue
            }

            // Parse progress: "Completed 123456789 of 987654321 bytes"
            const progressMatch = jobsResult.output.match(
              new RegExp(`${mirror.driveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?Completed\\s+(\\d+)\\s+of\\s+(\\d+)`)
            )
            if (progressMatch) {
              const done = Number.parseInt(progressMatch[1], 10)
              const total = Number.parseInt(progressMatch[2], 10)
              if (total > 0 && done >= total * 0.995) {
                if (!at100Since.has(mirror.driveId)) at100Since.set(mirror.driveId, Date.now())
              } else {
                at100Since.delete(mirror.driveId)
                allNear100 = false
              }
            } else {
              allNear100 = false
            }
          }

          // Update overall progress
          const totalBytes = mirrors.reduce((s, m) => s + m.diskTotal, 0)
          let totalDone = 0
          for (const mirror of mirrors) {
            if (readyDrives.has(mirror.driveId)) {
              totalDone += mirror.diskTotal
            } else {
              const pm = jobsResult.output.match(
                new RegExp(`${mirror.driveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?Completed\\s+(\\d+)`)
              )
              if (pm) totalDone += Number.parseInt(pm[1], 10)
            }
          }
          const overallPct = totalBytes > 0 ? Math.min(Math.round((totalDone / totalBytes) * 95), 95) : 0
          const elapsed = (Date.now() - mirrorStart) / 1000
          const speedBps = elapsed > 0 ? totalDone / elapsed : 0
          const speedStr = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`

          await updateJob(jobId, "transferring", {
            bytesTransferred: BigInt(totalDone),
            totalBytes: BigInt(totalBytes),
            transferSpeed: `Mirror: ${speedStr}`,
            progress: overallPct,
          })

          // Log progress every 10s
          if (Date.now() - lastProgressLog >= 10000) {
            for (const mirror of mirrors) {
              if (readyDrives.has(mirror.driveId)) continue
              const pm = jobsResult.output.match(
                new RegExp(`${mirror.driveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*?Completed\\s+(\\d+)\\s+of\\s+(\\d+)`)
              )
              if (pm) {
                const done = Number.parseInt(pm[1], 10)
                const total = Number.parseInt(pm[2], 10)
                const pct = total > 0 ? (done * 100 / total).toFixed(1) : "0"
                const spd = elapsed > 0 ? done / (1048576 * elapsed) : 0
                await appendLog(jobId, `disk${mirror.diskIndex}: ${pct}% (${spd.toFixed(0)} MB/s)`, "info")
              }
            }
            lastProgressLog = Date.now()
          }

          // Pause-pivot-resume: FUSE/SSHFS can't track dirty blocks, so mirrors
          // never become "ready". When all disks are at ~100% for PAUSE_PIVOT_AFTER_MS,
          // pause the VM (freeze CPUs), let mirrors catch up, pivot, then resume.
          const driveIdsSet = new Set(mirrors.map(m => m.driveId))
          const notReady = new Set([...driveIdsSet].filter(d => !readyDrives.has(d)))
          if (notReady.size > 0 && allNear100 && at100Since.size > 0) {
            const oldest100 = Math.min(...Array.from(at100Since.values()))
            if (Date.now() - oldest100 > PAUSE_PIVOT_AFTER_MS) {
              await appendLog(jobId, "All disks at 100% but not 'ready' - using pause-pivot-resume...", "info")
              await appendLog(jobId, "Pausing VM for atomic pivot (~1-2s)...", "warn")

              // Step 1: Pause VM (HMP "stop" = freeze CPUs, NOT qm stop!)
              await qmMonitorCmd("stop")
              await new Promise(r => setTimeout(r, 1000))

              // Step 2: Wait for mirrors to catch up (no new I/O since CPUs frozen)
              const readyAfterPause = new Set(readyDrives)
              for (let wait = 0; wait < 10; wait++) {
                await new Promise(r => setTimeout(r, 1000))
                const jobs2 = await qmMonitorCmd("info block-jobs")
                if (jobs2.success) {
                  for (const mirror of mirrors) {
                    if (readyAfterPause.has(mirror.driveId)) continue
                    if (!jobs2.output.includes(mirror.driveId)) {
                      readyAfterPause.add(mirror.driveId)
                    } else {
                      const readyRe = new RegExp(`${mirror.driveId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*ready`, "i")
                      if (readyRe.test(jobs2.output)) readyAfterPause.add(mirror.driveId)
                    }
                  }
                }
                if (readyAfterPause.size >= driveIdsSet.size) break
              }

              // Step 3: Pivot all drives
              let pivotOk = true
              for (const mirror of mirrors) {
                const pivotResult = await qmMonitorCmd(`block_job_complete ${mirror.driveId}`)
                if (!pivotResult.success && pivotResult.output.toLowerCase().includes("not ready")) {
                  await appendLog(jobId, `${mirror.driveId}: pivot failed (not ready) - cancelling`, "warn")
                  await qmMonitorCmd(`block_job_cancel ${mirror.driveId}`)
                  pivotOk = false
                }
              }

              // Step 4: Wait for pivots
              await new Promise(r => setTimeout(r, 2000))
              const jobs3 = await qmMonitorCmd("info block-jobs")
              const remaining = mirrors.filter(m => jobs3.output.includes(m.driveId))
              if (remaining.length > 0) {
                await new Promise(r => setTimeout(r, 5000))
              }

              // Step 5: Resume VM
              await qmMonitorCmd("cont")

              if (pivotOk) {
                const totalGB = mirrors.reduce((s, m) => s + m.diskTotal, 0) / 1073741824
                const mirrorElapsed = Math.round((Date.now() - mirrorStart) / 1000)
                await appendLog(jobId, `Pause-pivot-resume complete! ${totalGB.toFixed(1)} GB in ${mirrorElapsed}s - VM resumed on local storage`, "success")
              } else {
                await appendLog(jobId, "Pivot during pause partially failed - VM resumed but some disks may still be on remote storage", "warn")
              }
              break
            }
          }

          // Check if all drives are ready (normal case - non-FUSE backends)
          if (readyDrives.size >= driveIdsSet.size) {
            // All ready - pivot atomically
            await appendLog(jobId, "All mirrors synced - pivoting to local storage...", "info")
            for (const mirror of mirrors) {
              const pivotResult = await qmMonitorCmd(`block_job_complete ${mirror.driveId}`)
              if (!pivotResult.success) {
                await appendLog(jobId, `Warning: pivot ${mirror.driveId} failed: ${pivotResult.output.substring(0, 150)}`, "warn")
              }
            }
            // Wait for pivots to complete
            await new Promise(r => setTimeout(r, 3000))
            const jobsFinal = await qmMonitorCmd("info block-jobs")
            const remainingFinal = mirrors.filter(m => jobsFinal.output.includes(m.driveId))
            if (remainingFinal.length > 0) await new Promise(r => setTimeout(r, 5000))

            const totalGB = mirrors.reduce((s, m) => s + m.diskTotal, 0) / 1073741824
            const mirrorElapsed = Math.round((Date.now() - mirrorStart) / 1000)
            await appendLog(jobId, `All pivots complete - VM on local storage (${totalGB.toFixed(1)} GB in ${mirrorElapsed}s)`, "success")
            break
          }
        }

        // Check for mirror timeout
        if (Date.now() - mirrorStart >= MIRROR_TIMEOUT) {
          for (const mirror of mirrors) await qmMonitorCmd(`block_job_cancel ${mirror.driveId}`)
          throw new Error("drive-mirror timed out after 2 hours")
        }

        // ── Phase 8: Reconfigure VM with proper local disk lines ──
        await appendLog(jobId, "Reconfiguring VM with local disk references...", "info")

        // Stop VM briefly to reconfigure
        await pveFetch<any>(pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/stop`,
          { method: "POST" })
        // Wait for VM to stop
        for (let wait = 0; wait < 30; wait++) {
          await new Promise(r => setTimeout(r, 2000))
          const st = await pveFetch<any>(pveConn,
            `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/current`)
          if (st?.status === "stopped") break
        }

        // Remove args: line and add proper scsiN:/sataN: disk references
        await executeSSH(config.targetConnectionId, nodeIp,
          `sed -i '/^args:/d' "${confPath}"`)

        for (let di = 0; di < localVolumes.length; di++) {
          const scsiSlot = diskBus === "scsi" ? `scsi${di}` : `sata${di}`
          const diskOpts = isFileBased ? ",discard=on" : ""
          const attachBody = new URLSearchParams({ [scsiSlot]: `${localVolumes[di].volumeId}${diskOpts}` })
          await pveFetch<any>(pveConn,
            `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
            { method: "PUT", body: attachBody })
          await appendLog(jobId, `Disk ${di} attached as ${scsiSlot} (${localVolumes[di].volumeId})`, "success")
        }

        // Set boot order
        await pveFetch<any>(pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
          { method: "PUT", body: new URLSearchParams({ boot: `order=${diskBus === "scsi" ? "scsi0" : "sata0"}` }) })

        // Restart VM — always restart for SSHFS Boot (VM was running before reconfiguration)
        await appendLog(jobId, "Restarting VM with local disks...", "info")
        await pveFetch<any>(pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/start`,
          { method: "POST" })
        await appendLog(jobId, "VM restarted on local storage", "success")

        // ── Phase 9: Cleanup ──
        // Remove deployed SSH key from ESXi
        if (qemuSshKeyPath && !esxiKeyRaw && esxiPass) {
          const pubKeyResult = await executeSSH(config.targetConnectionId, nodeIp, `cat "${tmpKeyPath}.pub" 2>/dev/null`)
          const pubKey = pubKeyResult.output?.trim()
          if (pubKey) {
            const safePub = pubKey.replace(/[/\\&]/g, '\\$&')
            const safeEsxiPass2 = esxiPass.replace(/'/g, "'\\''")
            const esxiSshOpts2 = `-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o HostKeyAlgorithms=+ssh-rsa,ssh-ed25519 -o KexAlgorithms=+diffie-hellman-group14-sha1,diffie-hellman-group14-sha256 -o PreferredAuthentications=keyboard-interactive,password`
            await executeSSH(config.targetConnectionId, nodeIp,
              `export SSHPASS='${safeEsxiPass2}' && sshpass -e ssh ${esxiSshOpts2} -p ${esxiSshPort} ${esxiSshUser}@${esxiHost} "sed -i '/${safePub.substring(0, 40)}/d' /etc/ssh/keys-${esxiSshUser}/authorized_keys ~/.ssh/authorized_keys 2>/dev/null; echo CLEANED" 2>&1`)
          }
        }
        // Remove temp key from PVE node
        await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpKeyPath}" "${tmpKeyPath}.pub"`)
        // Kill NBD servers
        for (const sockPath of ndbSocketPaths) {
          await executeSSH(config.targetConnectionId, nodeIp, `fuser -k "${sockPath}" 2>/dev/null; rm -f "${sockPath}"`)
        }
        // Restore AppArmor
        if (bootMethod === "sshfs") {
          await executeSSH(config.targetConnectionId, nodeIp,
            `aa-enforce /etc/apparmor.d/usr.bin.kvm 2>/dev/null`)
        }

        // Unmap RBD devices
        for (const vol of allocatedVolumes) {
          if (vol.rbdMapped) {
            await executeSSH(config.targetConnectionId, nodeIp, `rbd unmap "${vol.devicePath}" 2>/dev/null`).catch(() => {})
          }
        }

        await appendLog(jobId, "SSHFS Boot migration cleanup complete", "success")
      }

    } else if (isLive) {
      // ── Live mode: vmkfstools clone on ESXi → SSH dd to PVE → power off → convert/import ──
      // ESXi locks -flat.vmdk files (VMFS lock) when VM runs — both HTTPS /folder/ (HTTP 500)
      // and dd (Device or resource busy) fail. vmkfstools -i uses the VMFS API to clone even
      // locked disks. We clone to a temp file on the ESXi datastore, then SSH dd the clone
      // (which is unlocked) to the PVE node. This gives crash-consistent copy with downtime
      // limited to convert + import + boot.

      if (!esxiSshAvailable) {
        throw new Error("Live migration requires SSH to be configured on the ESXi connection. ESXi locks VMDK files while VMs run — SSH is needed to run vmkfstools clone on the host.")
      }

      // Phase 0: Create snapshot — makes base VMDK read-only so vmkfstools can clone it
      await appendLog(jobId, "Creating snapshot on ESXi (base disk becomes read-only)...", "info")
      try {
        await soapCreateSnapshot(soapSession!, config.sourceVmId, "proxcenter-live-mig", "ProxCenter live migration - do not delete manually")
        await appendLog(jobId, "Snapshot created", "success")
      } catch (snapErr: any) {
        throw new Error(`Failed to create ESXi snapshot (required for live migration): ${snapErr.message}`)
      }

      await appendLog(jobId, "Cloning disks on ESXi via vmkfstools (VM stays running)...", "info")

      // Phase 1: Clone + download/stream all disks while VM runs
      try {
        for (let i = 0; i < vmConfig.disks.length; i++) {
          await updateJob(jobId, "transferring", { currentDisk: i })
          if (isFileBased) {
            await downloadDiskViaSsh(i, vmConfig.disks[i], true)
          } else {
            // Block storage: allocate + stream directly to device
            const vol = await allocateBlockVolume(vmConfig.disks[i].capacityBytes)
            await streamDiskViaSshToBlock(i, vmConfig.disks[i], vol.devicePath, true)
          }
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
        }
      } finally {
        // Always remove snapshot after cloning (even on failure)
        await appendLog(jobId, "Removing ESXi snapshot...", "info")
        await soapRemoveAllSnapshots(soapSession!, config.sourceVmId).catch((e: any) => {
          appendLog(jobId, `Warning: failed to remove snapshot: ${e.message}`, "warn")
        })
      }

      // Phase 2: Power off source VM (downtime starts here)
      const downtimeStart = Date.now()
      await appendLog(jobId, "All disks transferred - powering off source VM (downtime starts now)...", "warn")
      await powerOffSourceVm(jobId, soapSession!, config.sourceVmId)

      // Phase 3: Import/attach disks
      if (isFileBased) {
        // File-based: convert + import from storage temp path
        await appendLog(jobId, "Converting and importing disks to Proxmox...")
        for (let i = 0; i < vmConfig.disks.length; i++) {
          const progressBase = 70 + Math.round((i / vmConfig.disks.length) * 25)
          await updateJob(jobId, "transferring", { currentDisk: i, progress: progressBase })
          await convertAndImportDisk(i)
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
        }
      } else {
        // Block storage: data already streamed — just attach volumes
        await appendLog(jobId, "Attaching pre-streamed volumes to VM...")
        for (let i = 0; i < vmConfig.disks.length; i++) {
          const progressBase = 70 + Math.round((i / vmConfig.disks.length) * 25)
          await updateJob(jobId, "transferring", { currentDisk: i, progress: progressBase })
          await attachBlockDisk(i, allocatedVolumes[i].volumeId)
        }
      }

      const downtimeSec = Math.round((Date.now() - downtimeStart) / 1000)
      const downtimeMin = Math.floor(downtimeSec / 60)
      const downtimeRemSec = downtimeSec % 60
      await appendLog(jobId, `Source VM downtime: ${downtimeMin > 0 ? `${downtimeMin}m ${downtimeRemSec}s` : `${downtimeSec}s`}`, "info")
    } else if (useSSHFS) {
      // ── Offline mode with SSHFS: mount ESXi datastore → convert/stream directly ──
      // No download step — qemu-img reads from SSHFS mount, writes to local storage
      for (let i = 0; i < vmConfig.disks.length; i++) {
        await updateJob(jobId, "transferring", { currentDisk: i, progress: Math.round((i / vmConfig.disks.length) * 100) })

        // Set sshfsMountPath to the correct mount for this disk's datastore
        const diskDs = vmConfig.disks[i].datastoreName
        if (sshfsMountedDatastores.has(diskDs)) {
          sshfsMountPath = sshfsMountedDatastores.get(diskDs)!
        }

        if (isFileBased) {
          // File-based storage: qemu-img convert directly from SSHFS mount → qm disk import
          await transferDiskViaSshfs(i, vmConfig.disks[i])
        } else {
          // Block storage: dd from SSHFS mount directly to pre-allocated block device
          const vol = await allocateBlockVolume(vmConfig.disks[i].capacityBytes)
          await streamDiskViaSshfsToBlock(i, vmConfig.disks[i], vol.devicePath)
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          await attachBlockDisk(i, vol.volumeId)
        }
        await updateJob(jobId, "transferring", {
          currentDisk: i + 1,
          progress: Math.round(((i + 1) / vmConfig.disks.length) * 100),
        })
      }
    } else {
      // ── Offline mode with HTTPS: VM already powered off → download → convert → import ──
      for (let i = 0; i < vmConfig.disks.length; i++) {
        await updateJob(jobId, "transferring", { currentDisk: i, progress: Math.round((i / vmConfig.disks.length) * 100) })
        const isVsanDs = vmConfig.disks[i].datastoreName.toLowerCase().includes('vsan')
        if (isVsanDs) {
          throw new Error(`vSAN datastores require SSHFS transfer mode. Please select "SSHFS" or "Auto" transfer mode in the migration settings.`)
        }

        if (isFileBased) {
          // File-based storage: download to storage path → convert → qm disk import
          await downloadDisk(i, vmConfig.disks[i])
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          await convertAndImportDisk(i)
        } else {
          // Block storage: allocate volume → stream directly to device (no temp files)
          const vol = await allocateBlockVolume(vmConfig.disks[i].capacityBytes)
          await streamDiskToBlock(i, vmConfig.disks[i], vol.devicePath)
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          await attachBlockDisk(i, vol.volumeId)
        }
        await updateJob(jobId, "transferring", {
          currentDisk: i + 1,
          progress: Math.round(((i + 1) / vmConfig.disks.length) * 100),
        })
      }
    }

    } finally {
      // Always unmount SSHFS (even on error during transfer)
      if (useSSHFS) {
        const mountPaths = Array.from(sshfsMountedDatastores.values())
        for (let mi = 0; mi < mountPaths.length; mi++) {
          const origMountPath = sshfsMountPath
          sshfsMountPath = mountPaths[mi]
          await unmountSshfs()
          sshfsMountPath = origMountPath
        }
      }
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── STEP 4: Configure VM ──
    // (Skipped for sshfs_boot - disk attachment and boot order handled in Phase 8)
    if (!isSshfsBoot) {
      await updateJob(jobId, "configuring", { progress: 90 })
      await appendLog(jobId, "Configuring VM (boot order, agent)...")

      // Set boot order
      await pveFetch<any>(
        pveConn,
        `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
        { method: "PUT", body: new URLSearchParams({ boot: "order=scsi0" }) }
      )

      // For Windows VMs: add VirtIO ISO hint
      if (isWindowsVm(vmConfig)) {
        await appendLog(jobId, "Windows VM detected - using LSI SCSI + e1000 NIC for initial boot compatibility. Install VirtIO drivers from ISO for best performance.", "warn")
      }

      await appendLog(jobId, "VM configuration complete", "success")

      // ── STEP 5: Optionally start ──
      if (config.startAfterMigration) {
        await appendLog(jobId, "Starting VM on Proxmox...")
        await pveFetch<any>(
          pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/start`,
          { method: "POST" }
        )
        await appendLog(jobId, "VM started", "success")
      }
    }

    // ── DONE ──
    const totalCapacity = vmConfig.disks.reduce((sum, d) => sum + d.capacityBytes, 0)
    await updateJob(jobId, "completed", {
      progress: 100,
      bytesTransferred: BigInt(totalCapacity),
      totalBytes: BigInt(totalCapacity),
    })
    await appendLog(jobId, `Migration completed successfully! VM ${targetVmid} is ready on ${config.targetNode}.`, "success")

    // Audit
    const { audit } = await import("@/lib/audit")
    await audit({
      action: "create",
      category: "migration",
      resourceType: "vm",
      resourceId: String(targetVmid),
      resourceName: vmConfig.name,
      details: {
        source: `ESXi ${esxiConn.name}/${config.sourceVmId}`,
        target: `${config.targetNode}/${config.targetStorage}`,
      },
      status: "success",
    })
  } catch (err: any) {
    const errorMsg = err?.message || String(err)
    await updateJob(jobId, "failed", { error: errorMsg })
    await appendLog(jobId, `Migration failed: ${errorMsg}`, "error")

    // Cleanup: remove temp files on Proxmox node
    try {
      const nodeIp = await getNodeIpForMigration(prisma, config.targetConnectionId, config.targetNode,
        (await getConnectionById(config.targetConnectionId)).baseUrl)
      // Clean temp files on storage path (file-based storage)
      if (storageTempDir) {
        await executeSSH(config.targetConnectionId, nodeIp,
          `rm -f "${storageTempDir}"/proxcenter-mig-${jobId}-disk*.vmdk "${storageTempDir}"/proxcenter-mig-${jobId}-disk*.qcow2 "${storageTempDir}"/proxcenter-mig-${jobId}-disk*.raw`)
      }
      // Clean control files (always in /tmp)
      await executeSSH(config.targetConnectionId, nodeIp,
        `rm -f /tmp/proxcenter-mig-${jobId}-disk*.pid* /tmp/proxcenter-mig-${jobId}-disk*.stats /tmp/proxcenter-mig-${jobId}-disk*.dl.sh /tmp/proxcenter-mig-${jobId}-ctrl*.pid* /tmp/proxcenter-mig-${jobId}-ctrl*.dl.sh /tmp/proxcenter-mig-${jobId}-ctrl*.progress /tmp/proxcenter-mig-${jobId}-ctrl*.stderr /tmp/proxcenter-mig-${jobId}-sshfs*.pid* /tmp/proxcenter-mig-${jobId}-sshfs*.exit /tmp/proxcenter-mig-${jobId}-sshfs*.progress /tmp/proxcenter-mig-${jobId}-sshfs*.sh /tmp/proxcenter-mig-${jobId}-sshfsblk*.pid* /tmp/proxcenter-mig-${jobId}-sshfsblk*.exit /tmp/proxcenter-mig-${jobId}-sshfsblk*.progress /tmp/proxcenter-mig-${jobId}-sshfsblk*.sh`)
      // Unmount SSHFS if still mounted (error path)
      await executeSSH(config.targetConnectionId, nodeIp,
        `fusermount -uz /tmp/proxcenter-sshfs-${jobId} 2>/dev/null; fusermount -uz /tmp/proxcenter-sshfs-${jobId}-* 2>/dev/null; rmdir /tmp/proxcenter-sshfs-${jobId}* 2>/dev/null; rm -f /tmp/proxcenter-sshfs-${jobId}.esxi-key 2>/dev/null`)
    } catch {
      // Best effort cleanup
    }

    // Cleanup: if we created a VM, try to destroy it
    if (targetVmid && config.targetConnectionId) {
      try {
        const pveConn = await getConnectionById(config.targetConnectionId)
        await pveFetch<any>(
          pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}`,
          { method: "DELETE", body: new URLSearchParams({ purge: "1", "destroy-unreferenced-disks": "1" }) }
        )
        await appendLog(jobId, `Cleaned up partial VM ${targetVmid}`, "warn")
      } catch {
        // Cleanup failed — leave for manual intervention
      }
    }
  } finally {
    if (soapSession) {
      await soapLogout(soapSession)
    }
    cancelledJobs.delete(jobId)
    jobPrisma.delete(jobId)
  }
}

/**
 * executeSSH with configurable timeout for long-running operations (disk transfers).
 * The ssh2 library has a 30s default; we need much longer for large disks.
 */
async function executeSSHWithTimeout(
  db: any,
  connectionId: string,
  nodeIp: string,
  command: string,
  timeoutMs: number
): Promise<{ success: boolean; output?: string; error?: string }> {
  const connection = await db.connection.findUnique({
    where: { id: connectionId },
    select: {
      sshEnabled: true, sshPort: true, sshUser: true,
      sshAuthMethod: true, sshKeyEnc: true, sshPassEnc: true, sshUseSudo: true,
    },
  })

  if (!connection?.sshEnabled) {
    return { success: false, error: "SSH not enabled for this connection" }
  }

  const { Client } = await import("ssh2")

  const port = connection.sshPort || 22
  const user = connection.sshUser || "root"

  let key: string | undefined
  let password: string | undefined
  let passphrase: string | undefined

  const authMethod = connection.sshAuthMethod || (connection.sshKeyEnc ? "key" : "password")
  if (authMethod === "key" && connection.sshKeyEnc) {
    key = decryptSecret(connection.sshKeyEnc)
    if (connection.sshPassEnc) try { passphrase = decryptSecret(connection.sshPassEnc) } catch {}
  } else if (connection.sshPassEnc) {
    password = decryptSecret(connection.sshPassEnc)
  }

  const finalCommand = connection.sshUseSudo ? `sudo ${command}` : command

  return new Promise((resolve) => {
    const conn = new Client()
    const timeout = setTimeout(() => {
      conn.end()
      resolve({ success: false, error: `SSH timeout after ${timeoutMs / 1000}s` })
    }, timeoutMs)

    conn.on("ready", () => {
      conn.exec(finalCommand, (err, stream) => {
        if (err) { clearTimeout(timeout); conn.end(); resolve({ success: false, error: err.message }); return }

        let stdout = ""
        let stderr = ""
        stream.on("data", (data: Buffer) => { stdout += data.toString() })
        stream.stderr.on("data", (data: Buffer) => { stderr += data.toString() })
        stream.on("close", (code: number) => {
          clearTimeout(timeout)
          conn.end()
          if (code === 0 || code === null) {
            resolve({ success: true, output: stdout.trim() })
          } else {
            resolve({ success: false, error: stderr.trim() || `Exit code ${code}` })
          }
        })
      })
    })

    conn.on("error", (err) => { clearTimeout(timeout); resolve({ success: false, error: err.message }) })

    const connectConfig: Record<string, unknown> = {
      host: nodeIp, port, username: user, readyTimeout: 30_000,
      keepaliveInterval: 10000, keepaliveCountMax: 999,
    }
    if (key) { connectConfig.privateKey = key; if (passphrase) connectConfig.passphrase = passphrase }
    else if (password) { connectConfig.password = password }

    conn.connect(connectConfig as any)
  })
}
