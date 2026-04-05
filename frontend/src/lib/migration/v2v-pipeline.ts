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
  const outputDir = `/tmp/v2v-${jobId}`
  const pwFile = `/tmp/v2v-pwfile-${jobId}`
  const vmNameEsc = shellEscape(config.sourceVmName)

  let v2vCmd: string

  switch (config.sourceType) {
    case "vcenter": {
      // vpx://user@host/Datacenter/host/ESXiHost?no_verify=1
      const dc = config.vcenterDatacenter ? shellEscape(config.vcenterDatacenter) : "''"
      const esxiHost = config.vcenterHost ? shellEscape(config.vcenterHost) : "''"
      const userEsc = shellEscape(username)
      const hostEsc = shellEscape(host)
      const uri = `vpx://${userEsc}@${hostEsc}/${dc}/host/${esxiHost}?no_verify=1`
      v2vCmd = `virt-v2v -ic ${shellEscape(uri)} -ip ${shellEscape(pwFile)} ${vmNameEsc} -o local -os ${shellEscape(outputDir)} --machine-readable 2>&1`
      break
    }
    case "hyperv": {
      if (config.diskPaths && config.diskPaths.length > 0) {
        // Disk-based mode: no credentials needed
        const diskArgs = config.diskPaths.map(p => shellEscape(p)).join(" ")
        v2vCmd = `virt-v2v -i disk ${diskArgs} -o local -os ${shellEscape(outputDir)} --machine-readable 2>&1`
      } else {
        // Network mode: connect to Hyper-V host
        const userEsc = shellEscape(username)
        const hostEsc = shellEscape(host)
        const uri = `hyperv://${userEsc}@${hostEsc}`
        v2vCmd = `virt-v2v -ic ${shellEscape(uri)} -ip ${shellEscape(pwFile)} ${vmNameEsc} -o local -os ${shellEscape(outputDir)} --machine-readable 2>&1`
      }
      break
    }
    case "nutanix": {
      if (!config.diskPaths || config.diskPaths.length === 0) {
        throw new Error("Nutanix migrations require diskPaths to be specified")
      }
      const diskArgs = config.diskPaths.map(p => shellEscape(p)).join(" ")
      v2vCmd = `virt-v2v -i disk ${diskArgs} -o local -os ${shellEscape(outputDir)} --machine-readable 2>&1`
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
async function processV2vOutput(jobId: string, output: string): Promise<void> {
  const lines = output.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const progress = parseV2vLine(trimmed)
    if (progress) {
      const overall = calculateOverallProgress(progress)
      await updateJob(jobId, "transferring", { progress: overall })
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
  const outputDir = `/tmp/v2v-${jobId}`
  const pwFile = `/tmp/v2v-pwfile-${jobId}`
  let nutanixImageUuids: string[] = []  // Track Nutanix images for cleanup

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
      await appendLog(jobId, `Found ${disks.length} disk(s) to download`)

      // Prepare download directory on target node
      const downloadDir = `/tmp/nutanix-${jobId}`
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
          imageName
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

        const curlCmd = `curl -s ${insecureFlag} -H ${shellEscape(`Authorization: ${authHeader}`)} -o ${shellEscape(diskPath)} ${shellEscape(downloadUrl)}`
        await appendLog(jobId, `Downloading disk ${i} to ${diskPath}...`)

        const dlResult = await executeSSH(config.targetConnectionId, nodeIp, curlCmd)
        if (!dlResult.success) {
          throw new Error(`Failed to download disk ${i}: ${dlResult.error || dlResult.output?.substring(0, 500)}`)
        }

        // Verify file was downloaded
        const statResult = await executeSSH(config.targetConnectionId, nodeIp, `stat -c '%s' ${shellEscape(diskPath)}`)
        if (!statResult.success || !statResult.output?.trim() || statResult.output.trim() === "0") {
          throw new Error(`Downloaded disk file is empty or missing: ${diskPath}`)
        }
        const fileSize = Number(statResult.output.trim())
        await appendLog(jobId, `Disk ${i} downloaded: ${(fileSize / 1073741824).toFixed(1)} GB`, "success")

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
    await updateJob(jobId, "transferring", { progress: 0 })
    await appendLog(jobId, `Starting virt-v2v conversion (source: ${config.sourceType}, VM: "${config.sourceVmName}")...`)

    const v2vCommand = buildV2vCommand(jobId, config, username, host)
    await appendLog(jobId, `Running virt-v2v on ${config.targetNode}...`)

    const v2vResult = await executeSSH(config.targetConnectionId, nodeIp, v2vCommand)

    // Parse progress from output
    if (v2vResult.output) {
      await processV2vOutput(jobId, v2vResult.output)
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
      const nutanixDownloadDir = `/tmp/nutanix-${jobId}`
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
      const nutanixDownloadDir = `/tmp/nutanix-${jobId}`
      await executeSSH(config.targetConnectionId, nodeIp, `rm -rf ${shellEscape(nutanixDownloadDir)}`).catch(() => {})
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
