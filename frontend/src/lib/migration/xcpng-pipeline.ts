/**
 * XCP-ng → Proxmox VE migration pipeline
 *
 * Flow:
 * 1. Pre-flight checks (XO reachable, PVE reachable, VM config, disk space)
 * 2. Retrieve full VM config from XO REST API
 * 3. Create empty VM shell on Proxmox via API
 * 4. For each disk: SSH to Proxmox node → download VDI from XO (raw) → import into storage
 * 5. Attach disks, configure boot order
 * 6. Optionally start the VM
 *
 * Data flows XO → Proxmox directly (not through ProxCenter).
 * ProxCenter orchestrates via SSH commands + PVE API.
 */

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { isFileBasedStorage } from "@/lib/proxmox/storage"
import { executeSSH } from "@/lib/ssh/exec"
import { getXoConnectionInfo, xoGetVmConfig, buildVdiDownloadUrl } from "@/lib/xcpng/client"
import { mapXoToPveConfig, isWindowsXoVm } from "./xcpngConfigMapper"
import type { XoVmConfig, XoDiskInfo } from "@/lib/xcpng/client"

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

export function cancelXcpngMigrationJob(jobId: string) {
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
 */
async function getNodeIp(connectionId: string, nodeName: string, baseUrl: string): Promise<string> {
  const host = await prisma.managedHost.findFirst({
    where: { connectionId, node: nodeName, enabled: true },
    select: { ip: true, sshAddress: true },
  })
  if (host?.sshAddress) return host.sshAddress
  if (host?.ip) return host.ip

  try {
    const url = new URL(baseUrl)
    return url.hostname
  } catch {
    throw new Error(`Cannot determine IP for node ${nodeName}`)
  }
}

/**
 * executeSSH with configurable timeout for long-running operations.
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

/**
 * Main XCP-ng migration pipeline — runs async after HTTP response
 */
export async function runXcpngMigrationPipeline(jobId: string, config: MigrationConfig): Promise<void> {
  let targetVmid: number | null = null

  try {
    // ── STEP 0: Pre-flight ──
    await updateJob(jobId, "preflight")
    await appendLog(jobId, "Starting pre-flight checks...")

    // Get XO connection info
    const xo = await getXoConnectionInfo(config.sourceConnectionId)
    await appendLog(jobId, `Connecting to Xen Orchestra at ${xo.baseUrl}...`)

    // Get XO connection name
    const xoConn = await prisma.connection.findUnique({
      where: { id: config.sourceConnectionId },
      select: { name: true },
    })

    // Get PVE connection
    const pveConn = await getConnectionById(config.targetConnectionId)
    await appendLog(jobId, "XO and PVE connections verified", "success")

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── STEP 1: Get VM config from XO ──
    await appendLog(jobId, `Retrieving VM configuration for "${config.sourceVmId}"...`)
    const vmConfig = await xoGetVmConfig(xo, config.sourceVmId)

    await appendLog(
      jobId,
      `VM config: ${vmConfig.numCPU} vCPU, ${(vmConfig.memoryMB / 1024).toFixed(1)} GB RAM, ${vmConfig.disks.length} disk(s), firmware=${vmConfig.firmware}`,
      "success"
    )

    const totalDiskBytes = vmConfig.disks.reduce((sum, d) => sum + d.sizeBytes, 0)

    await updateJob(jobId, "preflight", {
      sourceVmName: vmConfig.name,
      totalDisks: vmConfig.disks.length,
      totalBytes: BigInt(totalDiskBytes),
    })

    // Handle VM power state based on migration type
    const isWarm = config.migrationType === "near-live" || config.migrationType === "live"

    if (vmConfig.powerState === "Running" || vmConfig.powerState === "running") {
      if (isWarm) {
        await appendLog(jobId, "VM is running — disks will be downloaded while VM is online (near-live migration)", "info")
        await appendLog(jobId, "The VM will be shut down after disk transfer for final cutover", "info")
      } else {
        throw new Error(
          "VM is powered on. Please power off the VM in Xen Orchestra before migration. " +
          "Cold migration requires the VM to be shut down."
        )
      }
    }

    // Check snapshots
    if (vmConfig.snapshotCount > 0) {
      await appendLog(jobId, `Warning: VM has ${vmConfig.snapshotCount} snapshot(s). Only current state will be migrated.`, "warn")
    }

    if (vmConfig.disks.length === 0) {
      throw new Error("VM has no disks to migrate")
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

    // Check target storage space
    const storageStatus = await pveFetch<any>(
      pveConn,
      `/nodes/${encodeURIComponent(config.targetNode)}/storage/${encodeURIComponent(config.targetStorage)}/status`
    )
    const freeBytes = storageStatus?.avail || 0
    await appendLog(jobId, `Target storage "${config.targetStorage}": ${(freeBytes / 1073741824).toFixed(1)} GB free, need ${(totalDiskBytes / 1073741824).toFixed(1)} GB`)
    if (freeBytes < totalDiskBytes * 1.1) {
      throw new Error(`Insufficient disk space on "${config.targetStorage}": ${(freeBytes / 1073741824).toFixed(1)} GB free, need ${(totalDiskBytes / 1073741824).toFixed(1)} GB`)
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── STEP 2: Allocate VMID & Create VM shell on Proxmox ──
    await updateJob(jobId, "creating_vm")
    await appendLog(jobId, "Allocating VMID on Proxmox cluster...")

    targetVmid = Number(await pveFetch<number | string>(pveConn, "/cluster/nextid"))
    await updateJob(jobId, "creating_vm", { targetVmid })
    await appendLog(jobId, `Allocated VMID ${targetVmid}`)

    const pveParams = mapXoToPveConfig(vmConfig, targetVmid, config.targetStorage, config.networkBridge)
    await appendLog(jobId, `Creating VM: ${pveParams.name} (${pveParams.ostype}, ${pveParams.bios}, ${pveParams.scsihw})...`)

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

    // Build XO auth for curl (Basic auth)
    const xoCreds = decryptSecret(
      (await prisma.connection.findUnique({
        where: { id: config.sourceConnectionId },
        select: { apiTokenEnc: true },
      }))!.apiTokenEnc
    )
    const curlAuth = Buffer.from(xoCreds).toString("base64")

    // Helper: download a single VDI from XO via curl on PVE node
    async function downloadDisk(i: number, disk: XoDiskInfo) {
      const diskSizeGB = (disk.sizeBytes / 1073741824).toFixed(1)
      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Downloading "${disk.label}" (${diskSizeGB} GB, VHD format)...`)

      const downloadUrl = buildVdiDownloadUrl(xo.baseUrl, disk.vdiUuid, "vhd")
      const tmpFile = `/tmp/proxcenter-mig-${jobId}-disk${i}`

      await updateJob(jobId, "transferring", {
        currentStep: `downloading_disk_${i + 1}`,
        currentDisk: i,
        bytesTransferred: BigInt(0),
        totalBytes: BigInt(disk.sizeBytes),
      })

      const pidFile = `${tmpFile}.pid`
      const statsFile = `${tmpFile}.stats`
      const startDl = await executeSSH(
        config.targetConnectionId, nodeIp,
        `nohup bash -c 'curl -s -H "Authorization: Basic ${curlAuth}" -o "${tmpFile}.vhd" -w '"'"'{"speed":%{speed_download},"size":%{size_download},"time":%{time_total}}'"'"' "${downloadUrl}" > "${statsFile}" 2>&1; echo $? > "${pidFile}.exit"' > /dev/null 2>&1 & echo $!`
      )
      if (!startDl.success || !startDl.output?.trim()) {
        throw new Error(`Failed to start download: ${startDl.error}`)
      }
      const curlPid = startDl.output.trim()
      await executeSSH(config.targetConnectionId, nodeIp, `echo ${curlPid} > "${pidFile}"`)

      let downloadedBytes = 0
      let downloadSpeed = ""
      let downloadTime = 0
      const startTime = Date.now()

      while (true) {
        if (isCancelled(jobId)) {
          await executeSSH(config.targetConnectionId, nodeIp, `kill ${curlPid} 2>/dev/null; rm -f "${tmpFile}.vhd" "${pidFile}" "${pidFile}.exit" "${statsFile}"`)
          throw new Error("Migration cancelled")
        }

        await new Promise(r => setTimeout(r, 3000))

        const exitCheck = await executeSSH(config.targetConnectionId, nodeIp, `cat "${pidFile}.exit" 2>/dev/null || echo RUNNING`)
        const isRunning = exitCheck.output?.trim() === "RUNNING"

        const sizeResult = await executeSSH(config.targetConnectionId, nodeIp, `stat -c %s "${tmpFile}.vhd" 2>/dev/null || echo 0`)
        const currentSize = parseInt(sizeResult.output?.trim() || "0", 10) || 0
        downloadedBytes = currentSize

        const elapsed = (Date.now() - startTime) / 1000
        const speedBps = elapsed > 0 ? currentSize / elapsed : 0
        downloadSpeed = speedBps > 1048576 ? `${(speedBps / 1048576).toFixed(1)} MB/s` : `${(speedBps / 1024).toFixed(0)} KB/s`

        const diskProgress = disk.sizeBytes > 0 ? Math.min(Math.round((currentSize / disk.sizeBytes) * 100), 99) : 0
        const overallProgress = Math.round((i / vmConfig.disks.length) * 100 + (diskProgress / vmConfig.disks.length))

        await updateJob(jobId, "transferring", {
          bytesTransferred: BigInt(currentSize),
          transferSpeed: downloadSpeed,
          progress: isWarm ? Math.round(overallProgress * 0.7) : overallProgress,
        })

        if (!isRunning) {
          const exitCode = parseInt(exitCheck.output?.trim() || "1", 10)
          if (exitCode !== 0) {
            await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vhd" "${pidFile}" "${pidFile}.exit" "${statsFile}"`)
            throw new Error(`Download failed with exit code ${exitCode}`)
          }

          const statsContent = await executeSSH(config.targetConnectionId, nodeIp, `cat "${statsFile}" 2>/dev/null`)
          const curlStats = statsContent.output?.match(/\{[^}]+\}/)
          if (curlStats) {
            try {
              const stats = JSON.parse(curlStats[0])
              downloadedBytes = stats.size || currentSize
              downloadSpeed = stats.speed > 1048576 ? `${(stats.speed / 1048576).toFixed(1)} MB/s` : `${(stats.speed / 1024).toFixed(0)} KB/s`
              downloadTime = stats.time || elapsed
            } catch {}
          } else {
            downloadTime = elapsed
          }

          await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${pidFile}" "${pidFile}.exit" "${statsFile}"`)
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

      await appendLog(jobId, `[Disk ${i + 1}/${vmConfig.disks.length}] Converting VHD to ${importFormat} format...`)
      await updateJob(jobId, "transferring", { currentStep: `converting_disk_${i + 1}` })

      const convertResult = await executeSSHWithTimeout(
        config.targetConnectionId, nodeIp,
        `qemu-img convert -f vpc -O ${importFormat} "${tmpFile}.vhd" "${tmpFile}.${importFormat}" 2>&1 && echo CONVERT_OK`,
        14400000
      )
      if (!convertResult.success || !convertResult.output?.includes("CONVERT_OK")) {
        await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vhd" "${tmpFile}.${importFormat}"`)
        throw new Error(`Conversion failed: ${convertResult.error || convertResult.output}`)
      }
      await appendLog(jobId, `Conversion to ${importFormat} complete`, "success")
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${tmpFile}.vhd"`)

      if (isCancelled(jobId)) throw new Error("Migration cancelled")

      // Import disk into Proxmox storage
      const importFile = `${tmpFile}.${importFormat}`
      await appendLog(jobId, `Importing disk into storage "${config.targetStorage}"...`)
      await updateJob(jobId, "transferring", { currentStep: `importing_disk_${i + 1}` })

      const importResult = await executeSSHWithTimeout(
        config.targetConnectionId, nodeIp,
        `qm disk import ${targetVmid} "${importFile}" ${config.targetStorage} --format ${importFormat} 2>&1`,
        3600000
      )
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f "${importFile}"`)

      if (!importResult.success) {
        throw new Error(`Disk import failed: ${importResult.error}`)
      }

      // Parse the actual disk volume name from qm disk import output
      let diskVolume = ""
      const importOutput = importResult.output || ""
      const importMatch = importOutput.match(/Successfully imported disk as '(?:unused\d+:)?(.+?)'/)
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
      // ── Near-live mode: download all disks while VM runs, then shut down, then convert/import ──

      // Phase 1: Download all disks (VM still running — no downtime yet)
      for (let i = 0; i < vmConfig.disks.length; i++) {
        await updateJob(jobId, "transferring", { currentDisk: i })
        await downloadDisk(i, vmConfig.disks[i])
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
      }

      // Phase 2: Shut down source VM via XO (downtime starts here)
      await appendLog(jobId, "All disks downloaded — shutting down source VM for cutover...", "warn")
      try {
        const xoFetchInternal = async (path: string, opts: RequestInit = {}) => {
          const fetchOpts: any = {
            ...opts,
            headers: { Authorization: xo.authHeader, "Content-Type": "application/json", ...opts.headers },
            signal: AbortSignal.timeout(30000),
          }
          if (xo.insecureTLS) {
            fetchOpts.dispatcher = new (await import("undici")).Agent({ connect: { rejectUnauthorized: false } })
          }
          return fetch(`${xo.baseUrl}/rest/v0${path}`, fetchOpts)
        }

        // XO REST API: POST /vms/{uuid}/actions/clean_shutdown or hard_shutdown
        const shutRes = await xoFetchInternal(`/vms/${config.sourceVmId}/actions/clean_shutdown`, { method: "POST" })
        if (!shutRes.ok) {
          // Try hard shutdown as fallback
          const hardRes = await xoFetchInternal(`/vms/${config.sourceVmId}/actions/hard_shutdown`, { method: "POST" })
          if (!hardRes.ok) {
            await appendLog(jobId, "Cannot shut down VM via XO API. Please shut down the VM manually now.", "warn")
          }
        }

        // Wait for VM to be halted (poll every 5s, max 120s)
        let halted = false
        for (let attempt = 0; attempt < 24; attempt++) {
          await new Promise(r => setTimeout(r, 5000))
          try {
            const refreshed = await xoGetVmConfig(xo, config.sourceVmId)
            if (refreshed.powerState === "Halted" || refreshed.powerState === "halted") {
              halted = true
              break
            }
          } catch {}
        }

        if (halted) {
          await appendLog(jobId, "Source VM shut down — downtime started", "success")
        } else {
          await appendLog(jobId, "VM did not shut down within 120s — proceeding anyway (disk image may be crash-consistent)", "warn")
        }
      } catch (e: any) {
        await appendLog(jobId, `Shutdown attempt failed: ${e?.message || e}. Proceeding with conversion...`, "warn")
      }

      // Phase 3: Convert and import all disks (downtime continues)
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

    await pveFetch<any>(
      pveConn,
      `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
      { method: "PUT", body: new URLSearchParams({ boot: "order=scsi0" }) }
    )

    if (isWindowsXoVm(vmConfig)) {
      await appendLog(jobId, "Windows VM detected — using LSI SCSI + e1000 NIC for initial boot compatibility. Install VirtIO drivers for best performance.", "warn")
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

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "create",
      category: "migration",
      resourceType: "vm",
      resourceId: String(targetVmid),
      resourceName: vmConfig.name,
      details: {
        source: `XCP-ng ${xoConn?.name || config.sourceConnectionId}/${config.sourceVmId}`,
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
    cancelledJobs.delete(jobId)
  }
}
