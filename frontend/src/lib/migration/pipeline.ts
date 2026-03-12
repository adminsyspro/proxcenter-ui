/**
 * ESXi → Proxmox VE migration pipeline
 *
 * Flow:
 * 1. Pre-flight checks (ESXi reachable, PVE reachable, VM config, disk space)
 * 2. Retrieve full VM config from ESXi via SOAP
 * 3. Create empty VM shell on Proxmox via API
 * 4. For each disk: SSH to Proxmox node → download VMDK from ESXi → convert → import
 * 5. Attach disks, configure boot order
 * 6. Optionally start the VM
 *
 * Data flows ESXi → Proxmox directly (not through ProxCenter).
 * ProxCenter orchestrates via SSH commands + PVE API.
 */

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { isFileBasedStorage } from "@/lib/proxmox/storage"
import { executeSSH } from "@/lib/ssh/exec"
import { soapLogin, soapLogout, soapGetVmConfig, parseVmConfig, buildVmdkDownloadUrl, buildVmdkDescriptorUrl, extractProp, soapCreateSnapshot, soapRemoveAllSnapshots, soapPowerOffVm } from "@/lib/vmware/soap"
import { mapEsxiToPveConfig, isWindowsVm } from "./configMapper"
import type { SoapSession, EsxiVmConfig, EsxiDiskInfo } from "@/lib/vmware/soap"

type MigrationStatus = "pending" | "preflight" | "creating_vm" | "transferring" | "configuring" | "completed" | "failed" | "cancelled"

interface MigrationConfig {
  sourceConnectionId: string
  sourceVmId: string
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  networkBridge: string
  startAfterMigration: boolean
  migrationType?: "cold" | "near-live" | "live"
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

async function updateJob(id: string, status: MigrationStatus, extra: Record<string, any> = {}) {
  const data: any = {
    status,
    currentStep: status,
    ...(status === "completed" ? { completedAt: new Date() } : {}),
    ...extra,
  }
  await prisma.migrationJob.update({ where: { id }, data })
}

async function appendLog(id: string, msg: string, level: LogEntry["level"] = "info") {
  const job = await prisma.migrationJob.findUnique({ where: { id }, select: { logs: true } })
  const logs: LogEntry[] = job?.logs ? JSON.parse(job.logs) : []
  logs.push({ ts: new Date().toISOString(), msg, level })
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
async function getNodeIp(connectionId: string, nodeName: string, baseUrl: string): Promise<string> {
  // Check managed hosts
  const host = await prisma.managedHost.findFirst({
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
export async function runMigrationPipeline(jobId: string, config: MigrationConfig): Promise<void> {
  let soapSession: SoapSession | null = null
  let targetVmid: number | null = null

  try {
    // ── STEP 0: Pre-flight ──
    await updateJob(jobId, "preflight")
    await appendLog(jobId, "Starting pre-flight checks...")

    // Get ESXi connection
    const esxiConn = await prisma.connection.findUnique({
      where: { id: config.sourceConnectionId },
      select: { id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
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
    const isWarm = config.migrationType === "near-live" || config.migrationType === "live"

    if (vmConfig.powerState === "poweredOn") {
      if (isWarm) {
        await appendLog(jobId, "VM is running — disks will be downloaded while VM is online (near-live migration)", "info")
        await appendLog(jobId, "The VM will be powered off after disk transfer for final cutover", "info")
      } else {
        await appendLog(jobId, "VM is powered on — attempting to power off for cold migration...", "warn")
        try {
          await soapSession && await import("@/lib/vmware/soap").then(m => m.soapPowerOffVm(soapSession!, config.sourceVmId))
          await appendLog(jobId, "VM powered off", "success")
        } catch (e: any) {
          const msg = e?.message || String(e)
          if (msg.includes("license") || msg.includes("prohibits")) {
            throw new Error("VM is powered on and ESXi license does not allow API power operations. Please power off the VM manually in the ESXi interface before retrying.")
          }
          throw e
        }
      }
    }

    // Check snapshots
    if (vmConfig.snapshotCount > 0) {
      await appendLog(jobId, `Warning: VM has ${vmConfig.snapshotCount} snapshot(s). Disk data will be from current state.`, "warn")
    }

    // Check disks have datastore info
    for (const disk of vmConfig.disks) {
      if (!disk.datastoreName || !disk.relativePath) {
        throw new Error(`Disk "${disk.label}" has no datastore path: ${disk.fileName}`)
      }
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // Verify PVE SSH connectivity
    const nodeIp = await getNodeIp(config.targetConnectionId, config.targetNode, pveConn.baseUrl)
    await appendLog(jobId, `Testing SSH to Proxmox node ${config.targetNode} (${nodeIp})...`)
    const sshTest = await executeSSH(config.targetConnectionId, nodeIp, "echo ok")
    if (!sshTest.success) {
      throw new Error(`SSH to Proxmox node failed: ${sshTest.error}`)
    }
    await appendLog(jobId, "SSH connectivity OK", "success")

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

    // Helper: download a single disk from ESXi via curl on PVE node
    async function downloadDisk(i: number, disk: EsxiDiskInfo) {
      const diskSizeGB = (disk.capacityBytes / 1073741824).toFixed(1)
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Downloading "${disk.label}" (${diskSizeGB} GB, ${disk.thinProvisioned ? "thin" : "thick"})...`)

      // Try flat VMDK first (standard split format), then descriptor (monolithic thick)
      const flatUrl = buildVmdkDownloadUrl(esxiUrl, disk)
      const descriptorUrl = buildVmdkDescriptorUrl(esxiUrl, disk)
      const tmpFile = `/tmp/proxcenter-mig-${jobId}-disk${i}`
      const soapCookie = soapSession!.cookie

      // Strip double quotes from cookie value to avoid shell quoting issues
      // ESXi returns: vmware_soap_session="abc123" — quotes are decorative, not required
      const safeCookie = soapCookie.replace(/"/g, '')
      const vmdkUrl = flatUrl
      await appendLog(jobId, `Download URL: ${vmdkUrl.replace(/\?.*/, '?...')}`, "info")

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
          progress: isWarm ? Math.round(overallProgress * 0.7) : overallProgress,
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

    // Helper: convert + import + attach a single disk
    async function convertAndImportDisk(i: number) {
      const tmpFile = `/tmp/proxcenter-mig-${jobId}-disk${i}`
      const scsiSlot = `scsi${i}`

      // Convert VMDK to target format
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Converting to ${importFormat} format...`)
      await updateJob(jobId, "transferring", { currentStep: `converting_disk_${i + 1}` })

      const convertResult = await executeSSHWithTimeout(
        config.targetConnectionId, nodeIp,
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
        config.targetConnectionId, nodeIp,
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

    if (isWarm) {
      // ── Near-live mode: snapshot → download (VM still runs) → power off → convert/import ──

      // Phase 1: Create snapshot so base disks become read-only and downloadable
      await appendLog(jobId, "Creating temporary snapshot to enable disk download while VM runs...", "info")
      let snapshotCreated = false
      try {
        await soapCreateSnapshot(soapSession!, config.sourceVmId, "proxcenter-migration", "Temporary snapshot for ProxCenter migration")
        snapshotCreated = true
        await appendLog(jobId, "Snapshot created — base disks now accessible", "success")
      } catch (snapErr: any) {
        const msg = snapErr?.message || String(snapErr)
        if (msg.includes("license") || msg.includes("prohibits") || msg.includes("restricted")) {
          await appendLog(jobId, "ESXi free license does not support snapshots — near-live migration unavailable. Falling back to cold migration (VM must be powered off first).", "warn")
          await powerOffSourceVm(jobId, soapSession!, config.sourceVmId)
        } else {
          throw snapErr
        }
      }

      // Phase 2: Download all disks (VM still running — no downtime yet, unless we powered off above)
      for (let i = 0; i < vmConfig.disks.length; i++) {
        await updateJob(jobId, "transferring", { currentDisk: i })
        await downloadDisk(i, vmConfig.disks[i])
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
      }

      // Phase 3: Remove snapshot (if created) + power off source VM (downtime starts here)
      if (snapshotCreated) {
        await appendLog(jobId, "All disks downloaded — cleaning up snapshot and powering off source VM...", "warn")
        try {
          await soapRemoveAllSnapshots(soapSession!, config.sourceVmId)
          await appendLog(jobId, "Migration snapshot removed", "info")
        } catch {
          await appendLog(jobId, "Warning: could not remove migration snapshot — please remove it manually", "warn")
        }

        // Power off for final cutover
        await powerOffSourceVm(jobId, soapSession!, config.sourceVmId)
      } else {
        await appendLog(jobId, "All disks downloaded.", "info")
      }

      // Phase 4: Convert and import all disks (downtime continues)
      await appendLog(jobId, "Converting and importing disks to Proxmox (downtime phase)...")
      for (let i = 0; i < vmConfig.disks.length; i++) {
        const progressBase = 70 + Math.round((i / vmConfig.disks.length) * 25)
        await updateJob(jobId, "transferring", { currentDisk: i, progress: progressBase })
        await convertAndImportDisk(i)
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
      }
    } else {
      // ── Cold mode: sequential download → convert → import per disk ──
      for (let i = 0; i < vmConfig.disks.length; i++) {
        await updateJob(jobId, "transferring", { currentDisk: i, progress: Math.round((i / vmConfig.disks.length) * 100) })
        await downloadDisk(i, vmConfig.disks[i])
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
        await convertAndImportDisk(i)
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
    await updateJob(jobId, "completed", { progress: 100 })
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
  }
}

/**
 * executeSSH with configurable timeout for long-running operations (disk transfers).
 * The ssh2 library has a 30s default; we need much longer for large disks.
 */
async function executeSSHWithTimeout(
  connectionId: string,
  nodeIp: string,
  command: string,
  timeoutMs: number
): Promise<{ success: boolean; output?: string; error?: string }> {
  const connection = await prisma.connection.findUnique({
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
