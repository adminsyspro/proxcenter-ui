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
  migrationType?: "cold" | "live"
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

    // Check if ESXi SSH is available (used as fallback if HTTPS download fails)
    const esxiSshAvailable = esxiConn.sshEnabled && (esxiConn.sshKeyEnc || esxiConn.sshPassEnc)

    if (vmConfig.powerState === "poweredOn") {
      if (isLive) {
        await appendLog(jobId, "VM is running — live migration will clone disks on ESXi via vmkfstools, then transfer (minimal downtime)", "info")
      } else {
        // Cold migration: VM must be off
        await appendLog(jobId, "VM is powered on — powering off for offline migration...", "warn")
        await powerOffSourceVm(jobId, soapSession!, config.sourceVmId)
      }
    }

    // Check snapshots (in live mode, existing snapshots are handled later — we remove them before creating ours)
    if (vmConfig.snapshotCount > 0 && !isLive) {
      await appendLog(jobId, `Warning: VM has ${vmConfig.snapshotCount} snapshot(s). Disk data will be from current state.`, "warn")
    }

    // Check disks have datastore info
    for (const disk of vmConfig.disks) {
      if (!disk.datastoreName || !disk.relativePath) {
        throw new Error(`Disk "${disk.label}" has no datastore path: ${disk.fileName}`)
      }
    }

    // Check for vSAN datastores (not supported yet)
    const vsanDisks = vmConfig.disks.filter(d => d.datastoreName.toLowerCase().includes('vsan'))
    if (vsanDisks.length > 0) {
      const dsNames = [...new Set(vsanDisks.map(d => d.datastoreName))].join(', ')
      throw new Error(
        `vSAN datastores are not yet supported for migration (found: ${dsNames}). ` +
        `vSAN uses an object-based storage model that prevents direct disk access via vmkfstools or SSH. ` +
        `Workaround: move the VM to a VMFS or NFS datastore before migrating, ` +
        `or export as OVA from vCenter and import with "qm importovf" on Proxmox.`
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
          if (m) maxDiskNum = Math.max(maxDiskNum, parseInt(m[1]))
        }
      }
      for (const av of allocatedVolumes) {
        const m = av.volumeId.match(/disk-(\d+)/)
        if (m) maxDiskNum = Math.max(maxDiskNum, parseInt(m[1]))
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
        transferredBytes = parseInt(progressResult.output?.trim() || "0", 10) || 0

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
          const exitCode = parseInt(exitCheck.output?.trim() || "1", 10)
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
              const clonedBytes = parseInt(sizeCheck.output?.trim() || "0", 10) || 0
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

            const exitCode = parseInt(exitCheck.output?.trim() || "1", 10)
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
          transferredBytes = parseInt(progressResult.output?.trim() || "0", 10) || 0

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
            const exitCode = parseInt(exitCheck.output?.trim() || "1", 10)
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
        const currentSize = parseInt(sizeResult.output?.trim() || "0", 10) || 0
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
          const exitCode = parseInt(exitCheck.output?.trim() || "1", 10)
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
          const actualSize = parseInt(fileSizeCheck.output?.trim() || "0", 10)
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

        const exitCode = parseInt(exitCheck.output?.trim() || "1", 10)
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
              const clonedBytes = parseInt(sizeCheck.output?.trim() || "0", 10) || 0
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

            const exitCode = parseInt(exitCheck.output?.trim() || "1", 10)
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
          const currentSize = parseInt(sizeResult.output?.trim() || "0", 10) || 0
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
            const exitCode = parseInt(exitCheck.output?.trim() || "1", 10)
            downloadTime = elapsed

            if (exitCode !== 0) {
              // Check if the file was actually downloaded despite non-zero exit (SSH warnings can cause exit 1)
              const fileSizeOnError = await executeSSH(config.targetConnectionId, nodeIp, `stat -c %s "${tmpFile}.vmdk" 2>/dev/null || echo 0`)
              const actualSizeOnError = parseInt(fileSizeOnError.output?.trim() || "0", 10)
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
            const actualSize = parseInt(fileSizeCheck.output?.trim() || "0", 10)
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
            .sort()
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

    if (isLive) {
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
        await soapCreateSnapshot(soapSession!, config.sourceVmId, "proxcenter-live-mig", "ProxCenter live migration — do not delete manually")
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
      await appendLog(jobId, "All disks transferred — powering off source VM (downtime starts now)...", "warn")
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
    } else {
      // ── Offline mode: VM already powered off → transfer disks ──
      for (let i = 0; i < vmConfig.disks.length; i++) {
        await updateJob(jobId, "transferring", { currentDisk: i, progress: Math.round((i / vmConfig.disks.length) * 100) })
        const isVsanDs = vmConfig.disks[i].datastoreName.toLowerCase().includes('vsan')
        if (isVsanDs) {
          throw new Error(`vSAN datastores are not yet supported. Move the VM to a VMFS or NFS datastore before migrating.`)
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

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── STEP 4: Configure VM ──
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
      await appendLog(jobId, "Windows VM detected — using LSI SCSI + e1000 NIC for initial boot compatibility. Install VirtIO drivers from ISO for best performance.", "warn")
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
        `rm -f /tmp/proxcenter-mig-${jobId}-disk*.pid* /tmp/proxcenter-mig-${jobId}-disk*.stats /tmp/proxcenter-mig-${jobId}-disk*.dl.sh /tmp/proxcenter-mig-${jobId}-ctrl*.pid* /tmp/proxcenter-mig-${jobId}-ctrl*.dl.sh /tmp/proxcenter-mig-${jobId}-ctrl*.progress /tmp/proxcenter-mig-${jobId}-ctrl*.stderr`)
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
