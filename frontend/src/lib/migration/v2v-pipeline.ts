/**
 * virt-v2v migration pipeline (vCenter / Hyper-V / Nutanix -> Proxmox VE)
 *
 * Flow:
 * 1. Preflight checks (SSH, virt-v2v installed)
 * 2. Prepare credentials (password file on target node)
 * 3. Create VM shell on Proxmox via API
 * 4. Execute virt-v2v on the target node (converts + downloads to /tmp)
 * 5. Parse output XML to configure the VM
 * 6. Import converted disks into Proxmox storage
 * 7. Cleanup temp files, optionally start VM
 *
 * virt-v2v runs ON the Proxmox node itself (it connects to the source hypervisor).
 * ProxCenter orchestrates via SSH commands + PVE API.
 */

import { getTenantPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { isFileBasedStorage } from "@/lib/proxmox/storage"
import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { parseV2vLine, calculateOverallProgress } from "./v2v-progress"
import { parseV2vXml, buildPveCreateParams } from "./v2vConfigMapper"
import type { V2vVmConfig } from "./v2vConfigMapper"

type MigrationStatus = "pending" | "preflight" | "creating_vm" | "transferring" | "configuring" | "completed" | "failed" | "cancelled"

export interface V2vMigrationConfig {
  sourceConnectionId: string
  sourceVmId: string
  sourceVmName: string
  sourceType: "vcenter" | "hyperv" | "nutanix"
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  networkBridge: string
  startAfterMigration: boolean
  vcenterDatacenter?: string
  vcenterHost?: string
  diskPaths?: string[]  // For Nutanix/Hyper-V disk-based mode
  tempStorage?: string  // Custom temp directory for virt-v2v output (default: /tmp)
}

interface LogEntry {
  ts: string
  msg: string
  level: "info" | "success" | "warn" | "error"
}

let cancelledJobs = new Set<string>()
const jobPrisma = new Map<string, any>()

function getPrismaForJob(jobId: string) {
  return jobPrisma.get(jobId)
}

export function cancelV2vMigrationJob(jobId: string) {
  cancelledJobs.add(jobId)
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
 * Build the virt-v2v command string based on source type and config.
 */
function buildV2vCommand(
  jobId: string,
  config: V2vMigrationConfig,
  username: string,
  host: string,
): string {
  const tempBase = config.tempStorage || '/tmp'
  const outputDir = `${tempBase}/v2v-${jobId}`
  const pwFile = `${tempBase}/v2v-pwfile-${jobId}`
  const vmNameEsc = shellEscape(config.sourceVmName)

  let v2vCmd: string
  const v2vOpts = `--block-driver virtio-scsi -o local -os ${shellEscape(outputDir)} --machine-readable 2>&1`

  switch (config.sourceType) {
    case "vcenter": {
      // vpx://user@host/Datacenter/host/ESXiHost?no_verify=1
      const dc = config.vcenterDatacenter ? shellEscape(config.vcenterDatacenter) : "''"
      const esxiHost = config.vcenterHost ? shellEscape(config.vcenterHost) : "''"
      const userEsc = shellEscape(username)
      const hostEsc = shellEscape(host)
      const uri = `vpx://${userEsc}@${hostEsc}/${dc}/host/${esxiHost}?no_verify=1`
      v2vCmd = `virt-v2v -ic ${shellEscape(uri)} -ip ${shellEscape(pwFile)} ${vmNameEsc} ${v2vOpts}`
      break
    }
    case "hyperv": {
      if (config.diskPaths && config.diskPaths.length > 0) {
        // Disk-based mode: no credentials needed
        const diskArgs = config.diskPaths.map(p => shellEscape(p)).join(" ")
        v2vCmd = `virt-v2v -i disk ${diskArgs} ${v2vOpts}`
      } else {
        // Network mode: connect to Hyper-V host
        const userEsc = shellEscape(username)
        const hostEsc = shellEscape(host)
        const uri = `hyperv://${userEsc}@${hostEsc}`
        v2vCmd = `virt-v2v -ic ${shellEscape(uri)} -ip ${shellEscape(pwFile)} ${vmNameEsc} ${v2vOpts}`
      }
      break
    }
    case "nutanix": {
      if (!config.diskPaths || config.diskPaths.length === 0) {
        throw new Error("Nutanix migrations require diskPaths to be specified")
      }
      const diskArgs = config.diskPaths.map(p => shellEscape(p)).join(" ")
      v2vCmd = `virt-v2v -i disk ${diskArgs} ${v2vOpts}`
      break
    }
    default:
      throw new Error(`Unsupported source type: ${config.sourceType}`)
  }

  return `mkdir -p ${shellEscape(outputDir)} && ${v2vCmd}`
}

/**
 * Parse virt-v2v output lines and update job progress.
 */
async function processV2vOutput(jobId: string, output: string, progressOffset: number = 0, progressScale: number = 100): Promise<void> {
  const lines = output.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const progress = parseV2vLine(trimmed)
    if (progress) {
      const v2vPct = calculateOverallProgress(progress)
      // Scale to the allocated progress range: offset + (v2vPct / 100) * scale
      const globalPct = Math.round(progressOffset + (v2vPct / 100) * progressScale)
      await updateJob(jobId, "transferring", { progress: Math.min(globalPct, 100) })
    }
  }
}

/**
 * Main virt-v2v migration pipeline
 */
export async function runV2vMigrationPipeline(
  jobId: string,
  config: V2vMigrationConfig,
  tenantId: string
): Promise<void> {
  // Register tenant-scoped prisma for this job
  const prisma = getTenantPrisma(tenantId)
  jobPrisma.set(jobId, prisma)

  let targetVmid: number | null = null
  const tempBase = config.tempStorage || '/tmp'
  const outputDir = `${tempBase}/v2v-${jobId}`
  const pwFile = `${tempBase}/v2v-pwfile-${jobId}`
  let nutanixImageUuids: string[] = []  // Track Nutanix images for cleanup
  let hypervMounted = false  // Track CIFS mount for cleanup

  try {
    // ── PHASE 1: Preflight ──
    await updateJob(jobId, "preflight")
    await appendLog(jobId, "Starting virt-v2v pre-flight checks...")

    // Get PVE connection
    const pveConn = await getConnectionById(config.targetConnectionId)
    const nodeIp = await getNodeIp(pveConn, config.targetNode)
    await appendLog(jobId, `Target node: ${config.targetNode} (${nodeIp})`)

    // Verify virt-v2v is installed
    const v2vCheck = await executeSSH(config.targetConnectionId, nodeIp, "which virt-v2v")
    if (!v2vCheck.success || !v2vCheck.output?.trim()) {
      throw new Error("virt-v2v is not installed on the target node. Install it with: apt-get install virt-v2v")
    }
    await appendLog(jobId, "virt-v2v is available on target node", "success")

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 1.5: Auto-mount Hyper-V SMB share ──
    if (config.sourceType === "hyperv") {
      const sourceConn = await prisma.connection.findUnique({
        where: { id: config.sourceConnectionId },
        select: { baseUrl: true, apiTokenEnc: true, hypervShareName: true },
      })
      if (sourceConn?.apiTokenEnc) {
        const creds = decryptSecret(sourceConn.apiTokenEnc)
        const colonIdx = creds.indexOf(":")
        const smbUser = colonIdx > 0 ? creds.substring(0, colonIdx) : "Administrator"
        const smbPass = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
        const smbHost = (sourceConn.baseUrl || "").replace(/^https?:\/\//, "").replace(/:\d+\/?$/, "").replace(/\/.*$/, "")
        const shareName = (sourceConn as any).hypervShareName || "VMs"

        // Check if already mounted
        const mountCheck = await executeSSH(config.targetConnectionId, nodeIp, "mountpoint -q /mnt/hyperv && echo mounted || echo not_mounted")
        if (mountCheck.output?.trim() !== "mounted") {
          await appendLog(jobId, `Mounting Hyper-V SMB share //${smbHost}/${shareName}...`)

          // Ensure cifs-utils is installed
          const cifsCheck = await executeSSH(config.targetConnectionId, nodeIp, "which mount.cifs")
          if (!cifsCheck.success || !cifsCheck.output?.trim()) {
            await appendLog(jobId, "Installing cifs-utils...")
            await executeSSH(config.targetConnectionId, nodeIp, "apt-get update -qq && apt-get install -y cifs-utils")
          }

          // Mount the share
          const mountCmd = `mkdir -p /mnt/hyperv && mount -t cifs //${shellEscape(smbHost)}/${shellEscape(shareName)} /mnt/hyperv -o username=${shellEscape(smbUser)},password=${shellEscape(smbPass)},file_mode=0777,dir_mode=0777`
          const mountResult = await executeSSH(config.targetConnectionId, nodeIp, mountCmd)
          if (!mountResult.success) {
            throw new Error(`Failed to mount Hyper-V share: ${mountResult.error || mountResult.output}`)
          }
          hypervMounted = true
          await appendLog(jobId, "Hyper-V SMB share mounted at /mnt/hyperv", "success")
        } else {
          await appendLog(jobId, "Hyper-V SMB share already mounted at /mnt/hyperv")
        }

        // Auto-detect disk paths if not provided
        if (!config.diskPaths || config.diskPaths.length === 0) {
          const vmName = config.sourceVmName.replace(/[^a-zA-Z0-9._-]/g, "*")
          const findResult = await executeSSH(config.targetConnectionId, nodeIp,
            `find /mnt/hyperv -iname "*${vmName}*" \\( -iname "*.vhdx" -o -iname "*.vhd" \\) 2>/dev/null || true`)
          const detected = (findResult.output || "").split("\n").map(l => l.trim()).filter(l => l && l.startsWith("/"))
          if (detected.length > 0) {
            config.diskPaths = detected
            await appendLog(jobId, `Auto-detected ${detected.length} disk(s): ${detected.join(", ")}`)
          } else {
            throw new Error("No VHDX/VHD files found for this VM in /mnt/hyperv/. Ensure the Hyper-V SMB share contains the VM disks.")
          }
        }
      }
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 2: Prepare credentials ──
    let username = ""
    let host = ""

    const needsCredentials = config.sourceType === "vcenter" ||
      (config.sourceType === "hyperv" && (!config.diskPaths || config.diskPaths.length === 0))

    if (needsCredentials) {
      await appendLog(jobId, "Preparing source connection credentials...")

      const sourceConn = await prisma.connection.findUnique({
        where: { id: config.sourceConnectionId },
        select: { baseUrl: true, apiTokenEnc: true },
      })
      if (!sourceConn?.apiTokenEnc) {
        throw new Error("Source connection credentials not found")
      }

      const creds = decryptSecret(sourceConn.apiTokenEnc)
      const colonIdx = creds.indexOf(":")
      username = colonIdx > 0 ? creds.substring(0, colonIdx) : "root"
      const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds

      // Extract host from baseUrl (strip protocol and port)
      try {
        const url = new URL(sourceConn.baseUrl)
        host = url.hostname
      } catch {
        // Fallback: strip protocol manually
        host = sourceConn.baseUrl
          .replace(/^https?:\/\//, "")
          .replace(/:\d+\/?$/, "")
          .replace(/\/.*$/, "")
      }

      // Write password file on the target node
      const writeCmd = `printf '%s' ${shellEscape(password)} > ${shellEscape(pwFile)} && chmod 600 ${shellEscape(pwFile)}`
      const writeResult = await executeSSH(config.targetConnectionId, nodeIp, writeCmd)
      if (!writeResult.success) {
        throw new Error(`Failed to write password file: ${writeResult.error}`)
      }
      await appendLog(jobId, "Credentials prepared on target node", "success")
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 2.5: Nutanix disk download ──
    // If sourceType is nutanix and no diskPaths provided, download disks from Prism API
    if (config.sourceType === "nutanix" && (!config.diskPaths || config.diskPaths.length === 0)) {
      await appendLog(jobId, "Downloading disks from Nutanix Prism Central...")

      const sourceConn = await prisma.connection.findUnique({
        where: { id: config.sourceConnectionId },
        select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true },
      })
      if (!sourceConn?.apiTokenEnc) {
        throw new Error("Nutanix source connection credentials not found")
      }

      const creds = decryptSecret(sourceConn.apiTokenEnc)
      const colonIdx = creds.indexOf(":")
      const ntxUser = colonIdx > 0 ? creds.substring(0, colonIdx) : "admin"
      const ntxPass = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds

      const { NutanixClient } = await import("@/lib/nutanix/client")
      const ntxClient = new NutanixClient({
        baseUrl: sourceConn.baseUrl,
        username: ntxUser,
        password: ntxPass,
        insecureTLS: sourceConn.insecureTLS,
      })

      // List disks for this VM
      const disks = await ntxClient.listDisks(config.sourceVmId)
      if (disks.length === 0) {
        throw new Error("No disks found on Nutanix VM")
      }
      await appendLog(jobId, `Found ${disks.length} disk(s) to download: ${disks.map(d => `${d.uuid} (${d.volumeGroupUuid ? 'VG' : 'direct'}, ${(d.sizeBytes / 1073741824).toFixed(1)} GB)`).join(', ')}`)

      // Prepare download directory on target node
      const downloadDir = `${tempBase}/nutanix-${jobId}`
      await executeSSH(config.targetConnectionId, nodeIp, `mkdir -p ${shellEscape(downloadDir)}`)

      const diskPaths: string[] = []

      for (let i = 0; i < disks.length; i++) {
        const disk = disks[i]
        if (isCancelled(jobId)) throw new Error("Migration cancelled")

        const imageName = `proxcenter-mig-${jobId}-disk${i}`
        await appendLog(jobId, `Creating image from disk ${i} (${(disk.sizeBytes / 1073741824).toFixed(1)} GB)...`)

        // Create image from disk via Prism API
        const { imageUuid, taskUuid } = await ntxClient.createDiskImage(
          config.sourceVmId,
          disk.uuid,
          imageName,
          !!disk.volumeGroupUuid
        )
        nutanixImageUuids.push(imageUuid)

        // Wait for image creation task to complete
        if (taskUuid) {
          await appendLog(jobId, `Waiting for image creation task ${taskUuid}...`)
          await ntxClient.waitForTask(taskUuid)
        }
        await appendLog(jobId, `Image created: ${imageUuid}`, "success")

        // Download the image to the target Proxmox node via curl
        const downloadUrl = ntxClient.getDiskDownloadUrl(imageUuid)
        const authHeader = ntxClient.getAuthHeader()
        const diskPath = `${downloadDir}/disk-${i}.raw`
        const insecureFlag = sourceConn.insecureTLS ? "-k" : ""

        // Launch curl in background via nohup
        // Credentials stored in a curl config file (chmod 600), deleted after download
        const pidFile = `${downloadDir}/curl-${i}.pid`
        const curlCfg = `${downloadDir}/.curlcfg-${i}`
        await appendLog(jobId, `Downloading disk ${i} to ${diskPath} (${(disk.sizeBytes / 1073741824).toFixed(1)} GB)...`)

        // Write curl config file with auth header (restricted permissions)
        const cfgContent = `header = "Authorization: ${authHeader}"\noutput = "${diskPath}"\nurl = "${downloadUrl}"\nsilent\n${sourceConn.insecureTLS ? "insecure" : ""}`
        const writeCfg = await executeSSH(config.targetConnectionId, nodeIp,
          `printf '%s' ${shellEscape(cfgContent)} > ${shellEscape(curlCfg)} && chmod 600 ${shellEscape(curlCfg)}`)
        if (!writeCfg.success) {
          throw new Error(`Failed to write curl config: ${writeCfg.error}`)
        }

        // Launch curl in background, delete config file after completion
        const launchResult = await executeSSH(config.targetConnectionId, nodeIp,
          `nohup bash -c "curl -K ${shellEscape(curlCfg)} && rm -f ${shellEscape(curlCfg)} && echo done > ${shellEscape(diskPath)}.complete" > /dev/null 2>&1 & echo $! > ${shellEscape(pidFile)}`)
        if (!launchResult.success) {
          throw new Error(`Failed to start disk ${i} download: ${launchResult.error}`)
        }

        // Poll download progress until complete
        const expectedSize = disk.sizeBytes
        let lastLoggedPct = -1
        let lastSize = 0
        let stallCount = 0
        const maxStallChecks = 60 // 60 * 5s = 5 minutes without progress = stalled
        while (true) {
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          await new Promise(r => setTimeout(r, 5000))

          // Check if download completed
          const completeCheck = await executeSSH(config.targetConnectionId, nodeIp,
            `test -f ${shellEscape(diskPath)}.complete && echo yes || echo no`)
          if (completeCheck.output?.trim() === "yes") break

          // Check file size progress
          const statResult = await executeSSH(config.targetConnectionId, nodeIp,
            `stat -c '%s' ${shellEscape(diskPath)} 2>/dev/null || echo 0`)
          const currentSize = Number(statResult.output?.trim() || "0")

          // Detect stalled download
          if (currentSize === lastSize) {
            stallCount++
            if (stallCount >= maxStallChecks) {
              throw new Error(`Disk ${i} download stalled: no progress for 5 minutes at ${(currentSize / 1073741824).toFixed(1)} GB`)
            }
          } else {
            stallCount = 0
            lastSize = currentSize
          }

          // Log progress and update global progress bar
          // Download phase = first 50% of total progress, split across disks
          if (expectedSize > 0) {
            const diskPct = Math.round((currentSize / expectedSize) * 100)
            if (diskPct > lastLoggedPct + 9) {
              await appendLog(jobId, `Disk ${i} download: ${diskPct}% (${(currentSize / 1073741824).toFixed(1)} GB)`)
              lastLoggedPct = diskPct
            }
            const totalDisks = disks.length
            const perDiskWeight = 50 / totalDisks
            const globalPct = Math.round((i * perDiskWeight) + (diskPct / 100) * perDiskWeight)
            await prisma.migrationJob.update({ where: { id: jobId }, data: { progress: globalPct } })
          }
        }

        // Verify file size
        const statResult = await executeSSH(config.targetConnectionId, nodeIp, `stat -c '%s' ${shellEscape(diskPath)}`)
        if (!statResult.success || !statResult.output?.trim() || statResult.output.trim() === "0") {
          throw new Error(`Downloaded disk file is empty or missing: ${diskPath}`)
        }
        const fileSize = Number(statResult.output.trim())
        await appendLog(jobId, `Disk ${i} downloaded: ${(fileSize / 1073741824).toFixed(1)} GB`, "success")

        // pid and complete files cleaned up with the nutanix download dir at end of pipeline

        diskPaths.push(diskPath)
      }

      // Set diskPaths on config for the virt-v2v step
      config.diskPaths = diskPaths
      await appendLog(jobId, `All ${diskPaths.length} disk(s) downloaded from Nutanix`, "success")
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 3: Create VM shell ──
    await updateJob(jobId, "creating_vm")
    await appendLog(jobId, "Allocating VMID on Proxmox cluster...")

    targetVmid = Number(await pveFetch<number | string>(pveConn, "/cluster/nextid"))
    await updateJob(jobId, "creating_vm", { targetVmid })
    await appendLog(jobId, `Allocated VMID ${targetVmid}`)

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 4: Execute virt-v2v ──
    // Don't reset progress for Nutanix (download phase already at 50%)
    if (config.sourceType !== "nutanix") {
      await updateJob(jobId, "transferring", { progress: 0 })
    }
    await appendLog(jobId, `Starting virt-v2v conversion (source: ${config.sourceType}, VM: "${config.sourceVmName}")...`)

    const v2vCommand = buildV2vCommand(jobId, config, username, host)
    await appendLog(jobId, `Running virt-v2v on ${config.targetNode}...`)

    let v2vResult = await executeSSH(config.targetConnectionId, nodeIp, v2vCommand)

    // Parse progress from output
    const hasDownloadPhase = config.sourceType === "nutanix"
    if (v2vResult.output) {
      await processV2vOutput(jobId, v2vResult.output, hasDownloadPhase ? 50 : 0, hasDownloadPhase ? 50 : 100)
    }

    // NTFS dirty flag recovery: if virt-v2v failed with NTFS errors and we're in disk mode, try ntfsfix
    const isDiskMode = config.diskPaths && config.diskPaths.length > 0
    const isNtfsError = !v2vResult.success && v2vResult.output &&
      /read.only|not cleanly unmounted|ntfs.*dirty|mounted read.only|windows hibernat/i.test(v2vResult.output)

    if (isNtfsError && isDiskMode) {
      await appendLog(jobId, "NTFS dirty flag detected, attempting ntfsfix recovery...", "warn")

      // Check if ntfsfix + qemu-nbd are available
      const toolCheck = await executeSSH(config.targetConnectionId, nodeIp, "which ntfsfix && which qemu-nbd && echo ok")
      if (toolCheck.success && toolCheck.output?.trim().endsWith("ok")) {
        for (const diskPath of config.diskPaths!) {
          await appendLog(jobId, `Running ntfsfix on ${diskPath}...`)
          // Use qemu-nbd to expose disk, find NTFS partition, run ntfsfix
          const ntfsFixCmd = [
            "modprobe nbd max_part=8",
            // Find a free nbd device
            'NBD_DEV=$(for i in $(seq 0 15); do [ ! -e /sys/block/nbd${i}/pid ] && echo /dev/nbd${i} && break; done)',
            '[ -z "$NBD_DEV" ] && echo "no free nbd device" && exit 1',
            `qemu-nbd --connect="$NBD_DEV" ${shellEscape(diskPath)}`,
            "sleep 2",
            // Find NTFS partitions and run ntfsfix on each
            `for PART in $(fdisk -l "$NBD_DEV" 2>/dev/null | grep -i "Microsoft basic data\\|NTFS\\|HPFS" | awk '{print $1}'); do ntfsfix "$PART" 2>&1 || true; done`,
            `qemu-nbd --disconnect="$NBD_DEV"`,
            "sleep 1",
          ].join(" && ")

          const fixResult = await executeSSH(config.targetConnectionId, nodeIp, ntfsFixCmd)
          if (fixResult.success) {
            await appendLog(jobId, `ntfsfix completed on ${diskPath}`, "success")
          } else {
            await appendLog(jobId, `ntfsfix failed on ${diskPath}: ${fixResult.error || fixResult.output}`, "warn")
          }
        }

        // Retry virt-v2v
        await appendLog(jobId, "Retrying virt-v2v after ntfsfix...")
        // Clean output dir from failed attempt
        await executeSSH(config.targetConnectionId, nodeIp, `rm -rf ${shellEscape(outputDir)} && mkdir -p ${shellEscape(outputDir)}`).catch(() => {})

        v2vResult = await executeSSH(config.targetConnectionId, nodeIp, v2vCommand)
        if (v2vResult.output) {
          await processV2vOutput(jobId, v2vResult.output, hasDownloadPhase ? 50 : 0, hasDownloadPhase ? 50 : 100)
        }
      } else {
        await appendLog(jobId, "ntfsfix/qemu-nbd not available on target node. Install ntfs-3g and qemu-utils for NTFS recovery.", "warn")
      }
    }

    // Clean up password file regardless of result
    if (needsCredentials) {
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f ${shellEscape(pwFile)}`).catch(() => {})
    }

    if (!v2vResult.success) {
      throw new Error(`virt-v2v failed: ${v2vResult.error || v2vResult.output?.substring(0, 500)}`)
    }
    await appendLog(jobId, "virt-v2v conversion completed", "success")

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 4.5: Inject virtio-win-guest-tools for Windows VMs ──
    // Detect Windows from virt-v2v output (looks for "Windows" in inspection output)
    const isWindowsVm = v2vResult.output && /windows/i.test(v2vResult.output)

    if (isWindowsVm) {
      await appendLog(jobId, "Windows VM detected, checking for guest tools injection...")

      // Find the converted disk (the main -sda file)
      const findDiskResult = await executeSSH(config.targetConnectionId, nodeIp,
        `find ${shellEscape(outputDir)} -name "*-sda" -type f | head -1`)
      const convertedDisk = findDiskResult.output?.trim()

      if (convertedDisk) {
        // Check virt-customize + virtio-win ISO availability
        const toolsCheck = await executeSSH(config.targetConnectionId, nodeIp,
          `which virt-customize && test -f /usr/share/virtio-win/virtio-win.iso && echo ok`)

        if (toolsCheck.success && toolsCheck.output?.trim().endsWith("ok")) {
          await appendLog(jobId, "Injecting virtio-win-guest-tools.exe for firstboot installation...")

          // Mount ISO, extract guest tools, inject with virt-customize
          const mountDir = `${tempBase}/virtio-mount-${jobId}`
          const injectCmd = [
            `mkdir -p ${shellEscape(mountDir)}`,
            `mount -o loop,ro /usr/share/virtio-win/virtio-win.iso ${shellEscape(mountDir)}`,
            // Check if guest tools exe exists on the ISO
            `test -f ${shellEscape(mountDir)}/virtio-win-guest-tools.exe`,
            // Inject the exe into the disk and schedule silent install at firstboot
            `virt-customize -a ${shellEscape(convertedDisk)}` +
              ` --copy-in ${shellEscape(mountDir)}/virtio-win-guest-tools.exe:/Windows/Temp/` +
              ` --firstboot-command 'C:\\Windows\\Temp\\virtio-win-guest-tools.exe /S /v"/qn REBOOT=ReallySuppress"'`,
            `umount ${shellEscape(mountDir)}`,
            `rmdir ${shellEscape(mountDir)}`,
          ].join(" && ")

          const injectResult = await executeSSH(config.targetConnectionId, nodeIp, injectCmd)
          if (injectResult.success) {
            await appendLog(jobId, "Guest tools injected (will install silently on first boot)", "success")
          } else {
            // Non-blocking: clean up mount and continue
            await executeSSH(config.targetConnectionId, nodeIp, `umount ${shellEscape(mountDir)} 2>/dev/null; rmdir ${shellEscape(mountDir)} 2>/dev/null`).catch(() => {})
            await appendLog(jobId, `Guest tools injection failed (non-blocking): ${injectResult.error || injectResult.output?.substring(0, 200)}`, "warn")
          }
        } else {
          await appendLog(jobId, "virt-customize or virtio-win ISO not available, skipping guest tools injection", "warn")
        }
      }
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 5: Configure VM from XML ──
    await updateJob(jobId, "configuring")
    await appendLog(jobId, "Reading virt-v2v output XML for VM configuration...")

    let vmConfig: V2vVmConfig | null = null

    const xmlResult = await executeSSH(
      config.targetConnectionId, nodeIp,
      `cat ${shellEscape(outputDir)}/*.xml 2>/dev/null`
    )

    if (xmlResult.success && xmlResult.output?.trim() && xmlResult.output.includes("<domain")) {
      try {
        vmConfig = parseV2vXml(xmlResult.output)
        await appendLog(jobId,
          `Parsed VM config: ${vmConfig.name}, ${vmConfig.memory}MB RAM, ${vmConfig.cores} cores, ` +
          `firmware=${vmConfig.firmware}, ${vmConfig.disks.length} disk(s), ${vmConfig.nics.length} NIC(s)`,
          "success"
        )
      } catch (parseErr: any) {
        await appendLog(jobId, `Failed to parse XML: ${parseErr.message}. Using fallback config.`, "warn")
      }
    } else {
      await appendLog(jobId, "No XML output found from virt-v2v. Using fallback config.", "warn")
    }

    // Build PVE creation params
    let createParams: Record<string, any>

    if (vmConfig) {
      // Override name from source VM (virt-v2v may use disk filename as name in -i disk mode)
      vmConfig.name = config.sourceVmName.replace(/[^a-zA-Z0-9.\-]/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").substring(0, 63) || vmConfig.name
      createParams = buildPveCreateParams(vmConfig, targetVmid, config.networkBridge)
    } else {
      // Fallback config
      createParams = {
        vmid: targetVmid,
        name: config.sourceVmName.replace(/[^a-zA-Z0-9.\-]/g, "-").substring(0, 63) || "vm",
        ostype: "l26",
        cores: 2,
        sockets: 1,
        memory: 2048,
        cpu: "x86-64-v2-AES",
        scsihw: "virtio-scsi-single",
        bios: "seabios",
        machine: "q35",
        boot: "order=scsi0",
        agent: "enabled=0",
        net0: `virtio,bridge=${config.networkBridge}`,
      }
    }

    await appendLog(jobId, `Creating VM ${targetVmid}: ${createParams.name} (${createParams.ostype}, ${createParams.bios})...`)

    const createBody = new URLSearchParams()
    for (const [key, value] of Object.entries(createParams)) {
      createBody.set(key, String(value))
    }
    createBody.set("serial0", "socket")

    // Add efidisk0 for EFI VMs
    const isEfi = vmConfig?.firmware === "efi" || createParams.bios === "ovmf"
    if (isEfi) {
      createBody.set("efidisk0", `${config.targetStorage}:1,efitype=4m,pre-enrolled-keys=0`)
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

    // ── PHASE 6: Import disks ──
    await appendLog(jobId, "Listing converted disk files...")

    const lsResult = await executeSSH(
      config.targetConnectionId, nodeIp,
      `ls -1 ${shellEscape(outputDir)} | grep -v '\\.xml$' | sort`
    )

    const diskFiles = (lsResult.output || "")
      .split("\n")
      .map(f => f.trim())
      .filter(f => f.length > 0)

    if (diskFiles.length === 0) {
      throw new Error("virt-v2v produced no disk files. Check virt-v2v output for errors.")
    }

    await appendLog(jobId, `Found ${diskFiles.length} disk file(s): ${diskFiles.join(", ")}`)

    // Determine storage type
    const storageConfig = await pveFetch<any>(
      pveConn,
      `/storage/${encodeURIComponent(config.targetStorage)}`
    )
    const storageType = storageConfig?.type || "dir"
    const isFileBased = isFileBasedStorage(storageType)

    // Track the highest disk number used (EFI VMs may have disk-0 for efidisk0)
    let nextDiskNum = isEfi ? 1 : 0

    for (let i = 0; i < diskFiles.length; i++) {
      const diskFile = diskFiles[i]
      const diskPath = `${outputDir}/${diskFile}`
      const scsiSlot = `scsi${i}`

      await appendLog(jobId, `[Disk ${i + 1}/${diskFiles.length}] Importing ${diskFile}...`)
      await updateJob(jobId, "transferring", {
        currentStep: `importing_disk_${i + 1}`,
        progress: Math.round(70 + (i / diskFiles.length) * 25),
      })

      if (isFileBased) {
        // File-based storage: qm disk import
        const importResult = await executeSSH(
          config.targetConnectionId, nodeIp,
          `qm disk import ${targetVmid} ${shellEscape(diskPath)} ${shellEscape(config.targetStorage)} --format qcow2 2>&1`
        )

        if (!importResult.success) {
          throw new Error(`Disk import failed for ${diskFile}: ${importResult.error || importResult.output}`)
        }

        // Parse disk volume name from qm disk import output
        let diskVolume = ""
        const importOutput = importResult.output || ""
        const importMatch = importOutput.match(/Successfully imported disk as '(?:unused\d+:)?(.+?)'/)
        const altMatch = !importMatch && importOutput.match(/unused\d+:\s*successfully imported disk '(.+?)'/i)

        if (importMatch?.[1]) {
          diskVolume = importMatch[1]
        } else if (altMatch?.[1]) {
          diskVolume = altMatch[1]
        } else {
          // Fallback: read VM config to find unused disk
          await appendLog(jobId, `Parsing import output failed, reading VM config to find unused disk...`, "info")
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
            diskVolume = `${config.targetStorage}:vm-${targetVmid}-disk-${nextDiskNum}`
            await appendLog(jobId, `Using guessed volume name: ${diskVolume}`, "warn")
          }
        }

        // Attach disk via PVE API
        const attachBody = new URLSearchParams({
          [scsiSlot]: `${diskVolume},discard=on`,
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
      } else {
        // Block storage: stat size -> pvesm alloc -> pvesm path -> pv | dd
        const statResult = await executeSSH(
          config.targetConnectionId, nodeIp,
          `stat -c %s ${shellEscape(diskPath)}`
        )
        if (!statResult.success || !statResult.output?.trim()) {
          throw new Error(`Failed to get file size for ${diskFile}: ${statResult.error}`)
        }
        const sizeBytes = parseInt(statResult.output.trim(), 10)
        if (isNaN(sizeBytes) || sizeBytes <= 0) {
          throw new Error(`Invalid file size for ${diskFile}: ${statResult.output}`)
        }
        const sizeKB = Math.ceil(sizeBytes / 1024)

        // Find next available disk number
        const vmConf = await pveFetch<Record<string, any>>(
          pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`
        )
        const existingNums = Object.keys(vmConf)
          .filter(k => k.match(/^(?:scsi|sata|virtio|ide|unused)\d+$/))
          .map(k => {
            const val = String(vmConf[k])
            const m = val.match(/vm-\d+-disk-(\d+)/)
            return m ? parseInt(m[1], 10) : -1
          })
          .filter(n => n >= 0)
        const maxDiskNum = existingNums.length > 0 ? Math.max(...existingNums) : -1
        const diskNum = maxDiskNum + 1
        const volName = `vm-${targetVmid}-disk-${diskNum}`

        // Allocate volume
        const allocResult = await executeSSH(
          config.targetConnectionId, nodeIp,
          `pvesm alloc ${shellEscape(config.targetStorage)} ${targetVmid} ${shellEscape(volName)} ${sizeKB} 2>&1`
        )
        if (!allocResult.success || !allocResult.output?.trim()) {
          throw new Error(`Failed to allocate volume: ${allocResult.error || allocResult.output}`)
        }
        const allocOutput = allocResult.output.trim()
        const quotedMatch = allocOutput.match(/'([^']+)'/)
        const volumeId = quotedMatch ? quotedMatch[1] : allocOutput

        // Get device path
        const pathResult = await executeSSH(
          config.targetConnectionId, nodeIp,
          `pvesm path ${shellEscape(volumeId)} 2>&1`
        )
        if (!pathResult.success || !pathResult.output?.trim()) {
          throw new Error(`Failed to resolve device path for ${volumeId}: ${pathResult.error}`)
        }
        let devicePath = pathResult.output.trim()

        // RBD/Ceph: pvesm path returns "rbd:pool/image:..." - need rbd map
        let rbdMapped = false
        if (devicePath.startsWith("rbd:")) {
          const rbdSpec = devicePath.split(":")[1]
          if (!rbdSpec) throw new Error(`Cannot parse RBD path: ${devicePath}`)
          const mapResult = await executeSSH(
            config.targetConnectionId, nodeIp,
            `rbd map ${shellEscape(rbdSpec)} 2>&1`
          )
          if (!mapResult.success || !mapResult.output?.trim()) {
            throw new Error(`Failed to map RBD device: ${mapResult.error}`)
          }
          devicePath = mapResult.output.trim()
          rbdMapped = true
        }

        // Validate device path starts with /
        if (!devicePath.startsWith("/")) {
          throw new Error(`Invalid device path for ${volumeId}: "${devicePath}" (expected path starting with /)`)
        }

        // Stream data to block device
        await appendLog(jobId, `[Disk ${i + 1}/${diskFiles.length}] Streaming to block device ${devicePath}...`)
        const ddResult = await executeSSH(
          config.targetConnectionId, nodeIp,
          `pv ${shellEscape(diskPath)} | dd of=${shellEscape(devicePath)} bs=4M oflag=direct 2>&1`
        )
        if (!ddResult.success) {
          throw new Error(`Block write failed for ${diskFile}: ${ddResult.error || ddResult.output}`)
        }

        // Unmap RBD if we mapped it
        if (rbdMapped) {
          await executeSSH(config.targetConnectionId, nodeIp, `rbd unmap ${shellEscape(devicePath)}`).catch(() => {})
        }

        // Attach disk via PVE API
        const attachBody = new URLSearchParams({
          [scsiSlot]: volumeId,
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

      nextDiskNum++
    }

    // Set boot order
    await pveFetch<any>(
      pveConn,
      `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
      { method: "PUT", body: new URLSearchParams({ boot: "order=scsi0" }) }
    )
    await appendLog(jobId, "Boot order set to scsi0", "success")

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 7: Finish ──
    await appendLog(jobId, "Cleaning up temporary files...")
    await executeSSH(config.targetConnectionId, nodeIp, `rm -rf ${shellEscape(outputDir)}`).catch(() => {})

    // Unmount Hyper-V share if we mounted it
    if (hypervMounted) {
      await appendLog(jobId, "Unmounting Hyper-V SMB share...")
      await executeSSH(config.targetConnectionId, nodeIp, "umount /mnt/hyperv").catch(() => {})
    }

    if (config.startAfterMigration) {
      await appendLog(jobId, "Starting VM on Proxmox...")
      await pveFetch<any>(
        pveConn,
        `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/start`,
        { method: "POST" }
      )
      await appendLog(jobId, "VM started", "success")
    }

    await updateJob(jobId, "completed", { progress: 100 })
    await appendLog(jobId, `Migration completed successfully! VM ${targetVmid} is ready on ${config.targetNode}.`, "success")

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "create",
      category: "migration",
      resourceType: "vm",
      resourceId: String(targetVmid),
      resourceName: createParams.name || config.sourceVmName,
      details: {
        source: `${config.sourceType} ${config.sourceVmName} (${config.sourceConnectionId})`,
        target: `${config.targetNode}/${config.targetStorage}`,
        method: "virt-v2v",
      },
      status: "success",
    })

    // Cleanup: Nutanix images + downloaded disks (on success)
    if (nutanixImageUuids.length > 0) {
      try {
        const sourceConn = await prisma.connection.findUnique({
          where: { id: config.sourceConnectionId },
          select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true },
        })
        if (sourceConn?.apiTokenEnc) {
          const creds = decryptSecret(sourceConn.apiTokenEnc)
          const colonIdx = creds.indexOf(":")
          const { NutanixClient } = await import("@/lib/nutanix/client")
          const ntxClient = new NutanixClient({
            baseUrl: sourceConn.baseUrl,
            username: colonIdx > 0 ? creds.substring(0, colonIdx) : "admin",
            password: colonIdx > 0 ? creds.substring(colonIdx + 1) : creds,
            insecureTLS: sourceConn.insecureTLS,
          })
          for (const imageUuid of nutanixImageUuids) {
            await ntxClient.deleteImage(imageUuid).catch(() => {})
          }
          await appendLog(jobId, `Cleaned up ${nutanixImageUuids.length} Nutanix image(s)`, "info")
        }
      } catch { /* best effort */ }
    }
    // Clean up downloaded disk files
    try {
      const pveConn = await getConnectionById(config.targetConnectionId)
      const nodeIp = await getNodeIp(pveConn, config.targetNode)
      const nutanixDownloadDir = `${tempBase}/nutanix-${jobId}`
      await executeSSH(config.targetConnectionId, nodeIp, `rm -rf ${shellEscape(nutanixDownloadDir)}`).catch(() => {})
    } catch { /* best effort */ }
  } catch (err: any) {
    const errorMsg = err?.message || String(err)
    await appendLog(jobId, `Migration failed: ${errorMsg}`, "error")
    await updateJob(jobId, "failed", { error: errorMsg })

    // Cleanup: temp files
    try {
      const pveConn = await getConnectionById(config.targetConnectionId)
      const nodeIp = await getNodeIp(pveConn, config.targetNode)
      await executeSSH(config.targetConnectionId, nodeIp, `rm -rf ${shellEscape(outputDir)}`).catch(() => {})
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f ${shellEscape(pwFile)}`).catch(() => {})
      // Clean up Nutanix downloaded disks
      const nutanixDownloadDir = `${tempBase}/nutanix-${jobId}`
      await executeSSH(config.targetConnectionId, nodeIp, `rm -rf ${shellEscape(nutanixDownloadDir)}`).catch(() => {})
      // Unmount Hyper-V share if we mounted it
      if (hypervMounted) {
        await executeSSH(config.targetConnectionId, nodeIp, "umount /mnt/hyperv").catch(() => {})
      }
    } catch {
      // Best effort cleanup
    }

    // Cleanup: Nutanix images created for disk export
    if (nutanixImageUuids.length > 0) {
      try {
        const sourceConn = await prisma.connection.findUnique({
          where: { id: config.sourceConnectionId },
          select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true },
        })
        if (sourceConn?.apiTokenEnc) {
          const creds = decryptSecret(sourceConn.apiTokenEnc)
          const colonIdx = creds.indexOf(":")
          const { NutanixClient } = await import("@/lib/nutanix/client")
          const ntxClient = new NutanixClient({
            baseUrl: sourceConn.baseUrl,
            username: colonIdx > 0 ? creds.substring(0, colonIdx) : "admin",
            password: colonIdx > 0 ? creds.substring(colonIdx + 1) : creds,
            insecureTLS: sourceConn.insecureTLS,
          })
          for (const imageUuid of nutanixImageUuids) {
            await ntxClient.deleteImage(imageUuid).catch(() => {})
          }
          await appendLog(jobId, `Cleaned up ${nutanixImageUuids.length} Nutanix image(s)`, "info")
        }
      } catch {
        // Best effort cleanup
      }
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
        // Cleanup failed - leave for manual intervention
      }
    }
  } finally {
    cancelledJobs.delete(jobId)
    jobPrisma.delete(jobId)
  }
}
