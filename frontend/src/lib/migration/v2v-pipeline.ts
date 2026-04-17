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
// SOAP imports for the NFC (HttpNfcLease) transport path used when the source VM
// has any disk on a vSAN datastore. vpx://+HTTPS /folder/ download is broken for
// vSAN because vSAN VMDK descriptors reference vsan:// URIs that only ESXi's
// internal filesystem layer can resolve. NFC export goes through ESXi's NFC
// service which is vSAN-aware, the same way ovftool extracts vSAN-backed VMs.
import {
  soapLogin,
  soapLogout,
  soapGetVmConfig,
  parseVmConfig,
  soapExportVm,
  soapWaitForNfcLease,
  soapNfcLeaseProgress,
  soapNfcLeaseComplete,
  soapNfcLeaseAbort,
} from "@/lib/vmware/soap"
import type { SoapSession, NfcLeaseDeviceUrl, EsxiVmConfig } from "@/lib/vmware/soap"

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
  /** vCenter datacenter name (libvirt vpx URI: vpx://VC/{datacenter}/...). Required for vcenter source. */
  vcenterDatacenter?: string
  /**
   * vCenter cluster name when the source ESXi host is part of a ClusterComputeResource.
   * When set, the libvirt vpx URI becomes vpx://VC/DC/host/{cluster}/{host}, which is
   * required for vSAN clusters and any other clustered ESXi setup. Omit for standalone hosts.
   */
  vcenterCluster?: string
  /** ESXi host name as registered in vCenter (FQDN or short name). Required for vcenter source. */
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
 * Download a single VM disk through an NFC lease device URL.
 *
 * The download runs in the background on the Proxmox node via curl writing to a
 * local file. We poll the file size for progress, periodically send NFC progress
 * keep-alive to vCenter (the lease times out after ~5 min of silence), and surface
 * progress to the migration job UI scaled to the caller-provided range.
 *
 * Auth: NFC URLs accept the same SOAP session cookie issued by login. We pass it
 * via curl --cookie. Self-signed vCenter certs require -k (ProxCenter routinely
 * connects to lab vCenters with --insecure).
 */
async function downloadDiskViaNfc(
  jobId: string,
  targetConnectionId: string,
  nodeIp: string,
  vmwareSession: SoapSession,
  leaseMor: string,
  device: NfcLeaseDeviceUrl,
  localPath: string,
  diskIndex: number,
  totalDisks: number,
  progressOffset: number,
  progressScale: number,
): Promise<void> {
  const sizeGB = device.fileSize > 0 ? (device.fileSize / 1073741824).toFixed(1) : "?"
  await appendLog(jobId, `[NFC disk ${diskIndex + 1}/${totalDisks}] Downloading ${device.targetId || device.key} (${sizeGB} GB)...`)

  // vSphere's Set-Cookie usually returns the session id WITH surrounding double
  // quotes (e.g. vmware_soap_session="abc"). A naive `header = "Cookie: ${cookie}"`
  // in a curl config file would have unescaped inner quotes and curl's config
  // parser would stop at the first one, dropping the session id and landing us
  // on a 401 from vCenter. Escape any " inside the cookie before embedding.
  const cookieEsc = (vmwareSession.cookie || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')

  const ctrlPrefix = `${localPath}.ctrl`
  const pidFile = `${ctrlPrefix}.pid`
  const exitFile = `${ctrlPrefix}.exit`
  const errFile = `${ctrlPrefix}.err`

  // Curl is launched in the background via nohup so we can poll its progress.
  // We write the cookie to a temp config file (chmod 600) instead of inlining it
  // on the command line to avoid leaking the SOAP session token in process listings.
  const curlCfg = `${ctrlPrefix}.curlcfg`
  const cfgContent = [
    `header = "Cookie: ${cookieEsc}"`,
    `output = "${localPath}"`,
    `url = "${device.url}"`,
    "silent",
    "show-error",
    "fail",
    vmwareSession.insecureTLS ? "insecure" : "",
  ].filter(Boolean).join("\n")

  const writeCfg = await executeSSH(
    targetConnectionId,
    nodeIp,
    `printf '%s' ${shellEscape(cfgContent)} > ${shellEscape(curlCfg)} && chmod 600 ${shellEscape(curlCfg)}`,
  )
  if (!writeCfg.success) {
    throw new Error(`Failed to write NFC curl config: ${writeCfg.error}`)
  }

  const launchCmd =
    `nohup bash -c ` +
    `"curl -K ${shellEscape(curlCfg)} 2>${shellEscape(errFile)}; ` +
    `echo \\$? > ${shellEscape(exitFile)}; ` +
    `rm -f ${shellEscape(curlCfg)}" ` +
    `> /dev/null 2>&1 & echo $!`
  const launch = await executeSSH(targetConnectionId, nodeIp, launchCmd)
  if (!launch.success || !launch.output?.trim()) {
    await executeSSH(targetConnectionId, nodeIp, `rm -f ${shellEscape(curlCfg)}`).catch(() => {})
    throw new Error(`Failed to start NFC download: ${launch.error}`)
  }
  const pid = launch.output.trim()
  await executeSSH(targetConnectionId, nodeIp, `echo ${pid} > ${shellEscape(pidFile)}`)

  // Poll loop: track size + send NFC keep-alive every 30s + abort on cancel.
  const startedAt = Date.now()
  let lastKeepAliveAt = 0
  let lastProgressLog = -10
  let lastSize = 0
  let stallCounter = 0
  const stallCheckIntervalMs = 5000
  const maxStallChecks = 60 // 60 * 5s = 5 min without growth = stalled
  const keepAliveIntervalMs = 30_000

  while (true) {
    if (isCancelled(jobId)) {
      await executeSSH(targetConnectionId, nodeIp, `kill ${pid} 2>/dev/null; rm -f ${shellEscape(curlCfg)} ${shellEscape(localPath)} ${shellEscape(pidFile)} ${shellEscape(exitFile)} ${shellEscape(errFile)}`).catch(() => {})
      throw new Error("Migration cancelled")
    }
    await new Promise(r => setTimeout(r, stallCheckIntervalMs))

    // Has curl exited?
    const exitCheck = await executeSSH(targetConnectionId, nodeIp, `cat ${shellEscape(exitFile)} 2>/dev/null || echo RUNNING`)
    const exitOut = exitCheck.output?.trim() || "RUNNING"

    if (exitOut !== "RUNNING") {
      const exitCode = Number.parseInt(exitOut, 10)
      if (exitCode !== 0) {
        const errCapture = await executeSSH(targetConnectionId, nodeIp, `tail -c 1000 ${shellEscape(errFile)} 2>/dev/null`)
        const errMsg = (errCapture.output || "").trim()
        await executeSSH(targetConnectionId, nodeIp, `rm -f ${shellEscape(localPath)} ${shellEscape(pidFile)} ${shellEscape(exitFile)} ${shellEscape(errFile)}`).catch(() => {})
        throw new Error(
          `NFC disk download failed (curl exit ${exitCode}). ` +
          `URL: ${device.url}. ` +
          `Curl stderr: ${errMsg || "(empty)"}. ` +
          `Common causes: vCenter cert mismatch (set insecureTLS on the connection), ` +
          `expired SOAP session (lease timed out), ` +
          `or vCenter NFC service unhealthy.`,
        )
      }
      await executeSSH(targetConnectionId, nodeIp, `rm -f ${shellEscape(pidFile)} ${shellEscape(exitFile)} ${shellEscape(errFile)}`).catch(() => {})

      // Sanity-check the file size matches what the lease promised (when known).
      if (device.fileSize > 0) {
        const stat = await executeSSH(targetConnectionId, nodeIp, `stat -c '%s' ${shellEscape(localPath)} 2>/dev/null || echo 0`)
        const got = Number.parseInt(stat.output?.trim() || "0", 10)
        if (got === 0) {
          throw new Error(`NFC disk download produced an empty file at ${localPath}`)
        }
        // We allow size mismatch (vSAN dynamic VMDKs may be smaller than promised
        // capacity if thin-provisioned), so log a warn instead of throwing.
        if (got < device.fileSize * 0.9) {
          await appendLog(
            jobId,
            `[NFC disk ${diskIndex + 1}/${totalDisks}] Downloaded ${(got / 1073741824).toFixed(1)} GB (expected ~${sizeGB} GB, ` +
            `acceptable for thin-provisioned disks)`,
            "warn",
          )
        }
      }

      const elapsed = (Date.now() - startedAt) / 1000
      await appendLog(
        jobId,
        `[NFC disk ${diskIndex + 1}/${totalDisks}] Download complete in ${elapsed.toFixed(0)}s`,
        "success",
      )
      return
    }

    // Track size growth for stall detection + progress.
    const stat = await executeSSH(targetConnectionId, nodeIp, `stat -c '%s' ${shellEscape(localPath)} 2>/dev/null || echo 0`)
    const currentSize = Number.parseInt(stat.output?.trim() || "0", 10)

    if (currentSize === lastSize) {
      stallCounter++
      if (stallCounter >= maxStallChecks) {
        await executeSSH(targetConnectionId, nodeIp, `kill ${pid} 2>/dev/null; rm -f ${shellEscape(localPath)} ${shellEscape(pidFile)} ${shellEscape(exitFile)} ${shellEscape(errFile)}`).catch(() => {})
        throw new Error(
          `NFC disk download stalled: no progress for ${(maxStallChecks * stallCheckIntervalMs / 60000).toFixed(0)} min ` +
          `at ${(currentSize / 1073741824).toFixed(2)} GB / ${sizeGB} GB`,
        )
      }
    } else {
      stallCounter = 0
      lastSize = currentSize
    }

    // Per-disk + global progress.
    const diskPct = device.fileSize > 0 ? Math.min(99, Math.round((currentSize / device.fileSize) * 100)) : 0
    if (diskPct > lastProgressLog + 9) {
      await appendLog(
        jobId,
        `[NFC disk ${diskIndex + 1}/${totalDisks}] ${diskPct}% (${(currentSize / 1073741824).toFixed(1)} GB)`,
      )
      lastProgressLog = diskPct
    }
    const perDiskWeight = progressScale / Math.max(1, totalDisks)
    const globalPct = Math.round(progressOffset + diskIndex * perDiskWeight + (diskPct / 100) * perDiskWeight)
    await updateJob(jobId, "transferring", { progress: Math.min(globalPct, 100) })

    // Keep the NFC lease alive so vCenter doesn't tear it down on us mid-download.
    if (Date.now() - lastKeepAliveAt >= keepAliveIntervalMs) {
      await soapNfcLeaseProgress(vmwareSession, leaseMor, diskPct).catch(() => {
        // Keep-alive failures are non-fatal; if the lease really dies, the curl
        // download itself will fail and we'll surface that error.
      })
      lastKeepAliveAt = Date.now()
    }
  }
}

/**
 * Run a full NFC export for a vCenter VM: open a lease, download every disk
 * device URL to local files on the Proxmox node, complete the lease.
 *
 * Returns the list of local disk file paths in lease order.  Caller is
 * responsible for cleaning up the files after virt-v2v has consumed them.
 */
async function runVcenterNfcExport(
  jobId: string,
  config: V2vMigrationConfig,
  nodeIp: string,
  vmwareSession: SoapSession,
  outputDir: string,
  /**
   * Parsed source VM config from vCenter SOAP. Used to backfill fileSize on NFC
   * device URLs when vCenter reports 0 (common for thin-provisioned vSAN VMs):
   * without a known size the progress bar stays at 0% for the whole download
   * and the stall detector can't distinguish a slow-start from a dead transfer.
   */
  sourceVmwareConfig: EsxiVmConfig | null,
): Promise<string[]> {
  await appendLog(jobId, "vSAN datastore detected, switching to NFC transport (HttpNfcLease)", "info")

  // Make sure the staging directory exists on the PVE node.
  await executeSSH(config.targetConnectionId, nodeIp, `mkdir -p ${shellEscape(outputDir)}`)

  await appendLog(jobId, "Initiating NFC export lease via vCenter ExportVm...")
  const leaseMor = await soapExportVm(vmwareSession, config.sourceVmId)

  let downloadedPaths: string[] = []
  let leaseFinalised = false
  try {
    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    await appendLog(jobId, `NFC lease ${leaseMor} created, waiting for ready state...`)
    const allDevices = await soapWaitForNfcLease(vmwareSession, leaseMor)
    const diskDevices = allDevices.filter(d => d.disk)
    if (diskDevices.length === 0) {
      throw new Error("NFC lease returned no disk device URLs (VM has no disks?)")
    }
    await appendLog(jobId, `NFC lease ready: ${diskDevices.length} disk URL(s) to download`, "success")

    // Each disk becomes a local file under outputDir.  We name them disk-<i>.vmdk
    // so virt-v2v can ingest them with -i disk; vCenter NFC always emits VMDK.
    for (let i = 0; i < diskDevices.length; i++) {
      if (isCancelled(jobId)) throw new Error("Migration cancelled")
      const localPath = `${outputDir}/disk-${i}.vmdk`

      // Patch the device fileSize when vCenter reports 0 but we know the disk
      // capacity from the source VM inspection. The indexed match relies on
      // NFC returning device URLs in the same order as the VM's disks; vSphere
      // is consistent on this but it's not contractually guaranteed. Any
      // mismatch just means a slightly-off progress bar, never a corrupt file.
      const dev = diskDevices[i]
      if (dev.fileSize === 0 && sourceVmwareConfig?.disks[i]?.capacityBytes) {
        dev.fileSize = sourceVmwareConfig.disks[i].capacityBytes
        await appendLog(
          jobId,
          `[NFC disk ${i + 1}/${diskDevices.length}] NFC lease reported fileSize=0 (typical for thin vSAN); ` +
          `using vCenter disk capacity ${(dev.fileSize / 1073741824).toFixed(1)} GB as progress target`,
          "info",
        )
      }

      await downloadDiskViaNfc(
        jobId,
        config.targetConnectionId,
        nodeIp,
        vmwareSession,
        leaseMor,
        dev,
        localPath,
        i,
        diskDevices.length,
        0,    // progressOffset: NFC transfer occupies 0..50% of the migration
        50,   // progressScale: leaving 50..100% for virt-v2v + import phases
      )
      downloadedPaths.push(localPath)
    }

    // Tell vCenter the transfer succeeded so it releases the lease cleanly.
    await soapNfcLeaseComplete(vmwareSession, leaseMor)
    leaseFinalised = true
    await appendLog(jobId, "NFC lease completed successfully", "success")
    return downloadedPaths
  } catch (err) {
    // Best-effort cleanup: abort the lease so vCenter doesn't keep it open, and
    // remove any partial downloads we already created.
    if (!leaseFinalised) {
      await soapNfcLeaseAbort(vmwareSession, leaseMor, (err as Error)?.message || "ProxCenter migration error").catch(() => {})
    }
    for (const p of downloadedPaths) {
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f ${shellEscape(p)}`).catch(() => {})
    }
    throw err
  }
}

/**
 * XML-escape a string for safe embedding in a libvirt domain XML attribute
 * or element body. The VM name, file paths, and other user-derived fields
 * go through here so a VM named `Foo & <Bar>` doesn't break the descriptor.
 */
function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, c => (
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === "&" ? "&amp;" :
    c === '"' ? "&quot;" :
    "&apos;"
  ))
}

/**
 * Build a minimal libvirt domain XML describing the pre-downloaded VMDKs so
 * virt-v2v can ingest them as a single multi-disk VM via `-i libvirtxml`.
 *
 * We include only the fields virt-v2v actually reads:
 *   - name / uuid: identify the domain
 *   - memory / vcpu: passed through to the output domain
 *   - os/type: tells virt-v2v to treat this as HVM (standard for vSphere VMs)
 *   - boot: "hd" so virt-v2v knows to look for a boot sector on the disks
 *   - disks: driver=qemu type=vmdk + source file + target dev=sd{a,b,c...}
 *
 * We deliberately don't include NICs, controllers, or graphics devices: they
 * wouldn't survive the conversion anyway (virt-v2v rewrites them based on
 * the target hypervisor profile) and would just add noise + validation risk.
 * The real NIC metadata comes from sourceVmwareConfig and is injected into
 * the Proxmox VM config in Phase 5, not here.
 */
function buildSynthesizedLibvirtXml(
  vmName: string,
  memoryMB: number,
  vcpus: number,
  diskFilePaths: string[],
): string {
  const nameEsc = xmlEscape(vmName || "proxcenter-v2v-vm")
  // target dev letters sda, sdb, sdc, ..., sdz — beyond 26 disks we'd need
  // sdaa/sdab but no real VM ever has that many. Cap defensively.
  const maxDisks = Math.min(diskFilePaths.length, 26)
  const diskNodes = diskFilePaths.slice(0, maxDisks).map((p, i) => {
    const dev = `sd${String.fromCharCode(0x61 + i)}` // 0x61 = 'a'
    return (
      `    <disk type='file' device='disk'>\n` +
      `      <driver name='qemu' type='vmdk'/>\n` +
      `      <source file='${xmlEscape(p)}'/>\n` +
      `      <target dev='${dev}' bus='scsi'/>\n` +
      `    </disk>`
    )
  }).join("\n")

  return (
    `<domain type='kvm'>\n` +
    `  <name>${nameEsc}</name>\n` +
    `  <memory unit='MiB'>${Math.max(128, Math.round(memoryMB))}</memory>\n` +
    `  <vcpu>${Math.max(1, vcpus)}</vcpu>\n` +
    `  <os>\n` +
    `    <type arch='x86_64'>hvm</type>\n` +
    `    <boot dev='hd'/>\n` +
    `  </os>\n` +
    `  <devices>\n` +
    `${diskNodes}\n` +
    `  </devices>\n` +
    `</domain>\n`
  )
}

/**
 * Launch a virt-v2v command in the background, poll its `--machine-readable`
 * output for progress events, and return the final output + exit status when
 * it completes.
 *
 * Why not just `await executeSSH(command)` synchronously?
 *   - virt-v2v over vpx:// downloads + converts in a single blocking call that
 *     can run for minutes-to-hours; the default 30s SSH timeout kills it.
 *   - Bumping the SSH timeout to "large enough" is arbitrary: 4h is not
 *     enough for 500 GB disks on slow links, and the user sees zero progress
 *     feedback while waiting.
 *   - virt-v2v already emits structured progress events (JSON lines with
 *     `--machine-readable`); we can parse them live if we tail the output.
 *
 * Flow:
 *   1. `mkdir -p` outputDir so virt-v2v's `-os` path exists.
 *   2. `nohup bash -c "<v2v-cmd> > log 2>&1; echo $? > exit"` + capture PID.
 *   3. Poll every ~5s:
 *        - `tail -c 4000 log` → feed to processV2vOutput() for incremental
 *          progress updates (virt-v2v prints [N.N] timestamps + JSON events).
 *        - `cat exit` → "RUNNING" until virt-v2v finishes, then exit code.
 *   4. On exit: read the full log once for diagnostics, clean up marker files,
 *      return SSHResult-shaped object so the caller's error handling doesn't
 *      change.
 *
 * Cancellation: `isCancelled(jobId)` is checked each poll; on cancel we SIGTERM
 * virt-v2v via `kill $pid` (best-effort — the orchestrator allowlist rejects
 * bare `kill` so it goes via ssh2 fallback, slower but works).
 */
async function runVirtV2vWithProgress(
  jobId: string,
  config: V2vMigrationConfig,
  nodeIp: string,
  v2vCommand: string,
  progressOffset: number,
  progressScale: number,
): Promise<{ success: boolean; output: string; error?: string }> {
  const tempBase = config.tempStorage || '/tmp'
  const outputDir = `${tempBase}/v2v-${jobId}`
  const logFile = `${outputDir}/v2v.log`
  const exitFile = `${outputDir}/v2v.exit`

  // 1. Ensure the output dir exists. virt-v2v's -o local -os <dir> expects
  //    the directory to be there already (it won't create parents).
  const mkdirResult = await executeSSH(
    config.targetConnectionId,
    nodeIp,
    `mkdir -p ${shellEscape(outputDir)}`,
  )
  if (!mkdirResult.success) {
    return { success: false, output: "", error: `Failed to create output dir: ${mkdirResult.error}` }
  }

  // 2. Launch virt-v2v in the background with stdout+stderr merged to a log
  //    file, capturing the exit code to a marker file. The shellEscape on the
  //    whole inner bash -c payload keeps the multi-level quoting sane.
  //    NOTE: the orchestrator SSH allowlist accepts "nohup bash" as a prefix,
  //    so this launch goes through the fast path, not the ssh2 fallback.
  //
  //    stdbuf -oL forces LINE buffering on virt-v2v's stdout. Without this,
  //    redirecting stdout to a file switches libc to block buffering (4 KB)
  //    and we'd only see events after the buffer fills — so the "Setting up
  //    the source" / "Copying disk" messages would appear in a burst at the
  //    very end instead of streaming. `stdbuf` is from coreutils and is
  //    always available on Debian-based Proxmox.
  const innerCmd = `stdbuf -oL ${v2vCommand} > ${shellEscape(logFile)} 2>&1; echo $? > ${shellEscape(exitFile)}`
  const launchCmd = `nohup bash -c ${shellEscape(innerCmd)} > /dev/null 2>&1 & echo $!`
  const launch = await executeSSH(config.targetConnectionId, nodeIp, launchCmd)
  if (!launch.success || !launch.output?.trim()) {
    return { success: false, output: "", error: `Failed to launch virt-v2v: ${launch.error}` }
  }
  const pid = launch.output.trim()
  await appendLog(jobId, `virt-v2v launched in background (PID ${pid}), streaming progress...`, "info")

  // 3. Poll loop: tail log for progress + check exit marker. We tail a small
  //    window (last 4 KB) each cycle; processV2vOutput is idempotent so
  //    re-parsing the same line on a subsequent poll just re-sets the same
  //    progress value, which is a no-op.
  const pollIntervalMs = 5000
  const startedAt = Date.now()
  let loggedNoProgressAt = 0

  while (true) {
    if (isCancelled(jobId)) {
      await executeSSH(config.targetConnectionId, nodeIp, `kill ${pid} 2>/dev/null`).catch(() => {})
      throw new Error("Migration cancelled")
    }
    await new Promise(r => setTimeout(r, pollIntervalMs))

    // Check if virt-v2v has exited (exit marker file present).
    const exitCheck = await executeSSH(
      config.targetConnectionId,
      nodeIp,
      `cat ${shellEscape(exitFile)} 2>/dev/null || echo RUNNING`,
    )
    const exitOut = exitCheck.output?.trim() || "RUNNING"

    // Tail the log for incremental progress, regardless of exit state.
    const tailResult = await executeSSH(
      config.targetConnectionId,
      nodeIp,
      `tail -c 4000 ${shellEscape(logFile)} 2>/dev/null`,
    )
    if (tailResult.success && tailResult.output) {
      // processV2vOutput parses each line and updates migrationJob.progress
      // via updateJob(). Running it every poll with the latest tail surfaces
      // progress events (disk copy %, phase transitions) as they happen.
      await processV2vOutput(jobId, tailResult.output, progressOffset, progressScale).catch(() => {})
    }

    if (exitOut !== "RUNNING") {
      const exitCode = Number.parseInt(exitOut, 10)
      // Grab the full log for both the success path (passed to
      // processV2vOutput one last time so nothing is missed) and the failure
      // path (needs the tail for error diagnostics).
      const fullLog = await executeSSH(
        config.targetConnectionId,
        nodeIp,
        `cat ${shellEscape(logFile)} 2>/dev/null`,
      )
      const output = fullLog.output || ""
      // Clean up the control files. We leave the outputDir itself for the
      // subsequent import phases — it holds the converted disks + XML.
      await executeSSH(
        config.targetConnectionId,
        nodeIp,
        `rm -f ${shellEscape(logFile)} ${shellEscape(exitFile)}`,
      ).catch(() => {})

      const elapsed = (Date.now() - startedAt) / 1000
      if (exitCode === 0) {
        await appendLog(jobId, `virt-v2v completed in ${elapsed.toFixed(0)}s`, "success")
        return { success: true, output }
      }
      // Non-zero exit: surface the tail of the log as the error message so
      // the caller can show something actionable without scrolling through
      // a 4000-char log.
      const errTail = output.trim().split("\n").slice(-20).join("\n")
      return {
        success: false,
        output,
        error: `virt-v2v exited ${exitCode} after ${elapsed.toFixed(0)}s. Last lines:\n${errTail}`,
      }
    }

    // Still running — emit a liveness log every 60 s so the user sees
    // activity during virt-v2v's silent phases (Inspecting / Converting can
    // run for 5-15 min with zero output while the tool streams data from
    // vCenter in the background). We also include the size of the output
    // dir as a secondary progress signal: even when no phase log is
    // emitted, virt-v2v writes to an overlay file in outputDir whose size
    // grows as data is downloaded. That way the user can tell the
    // migration is *actually* doing work vs hung.
    if (Date.now() - loggedNoProgressAt > 60_000) {
      loggedNoProgressAt = Date.now()
      const elapsed = (Date.now() - startedAt) / 1000
      // Best-effort: du is fast, if it errors we just skip the size hint.
      const duResult = await executeSSH(
        config.targetConnectionId,
        nodeIp,
        `du -sb ${shellEscape(outputDir)} 2>/dev/null | awk '{print $1}'`,
      )
      const bytesRaw = (duResult.output || "").trim()
      const bytes = Number.parseInt(bytesRaw, 10)
      const sizeSuffix = (Number.isFinite(bytes) && bytes > 0)
        ? `, output dir now ${(bytes / 1073741824).toFixed(2)} GB`
        : ""
      await appendLog(
        jobId,
        `virt-v2v still running (${elapsed.toFixed(0)}s elapsed${sizeSuffix}). ` +
        `Silent phases (Inspecting/Converting/Mapping) can take several minutes; ` +
        `progress updates resume during "Copying disk".`,
        "info",
      )
    }
  }
}

/**
 * Build the virt-v2v command string based on source type and config.
 */
function buildV2vCommand(
  jobId: string,
  config: V2vMigrationConfig,
  username: string,
  host: string,
  supportsBlockDriver: boolean,
  /**
   * If set, virt-v2v reads the listed VMDK files from the local FS instead of
   * connecting to the source hypervisor. Used by the NFC transport path: the
   * disks have already been downloaded by runVcenterNfcExport(), so virt-v2v
   * doesn't need network access to vCenter. For 1 disk we use `-i disk`, for
   * 2+ we use `-i libvirtxml` pointing at `libvirtXmlPath` (caller-written).
   */
  preDownloadedDiskPaths?: string[],
  /**
   * Path (on the target node) to a synthesized libvirt domain XML that
   * references every entry in preDownloadedDiskPaths as a <disk> element.
   * Required when preDownloadedDiskPaths has more than one entry.
   */
  libvirtXmlPath?: string,
): string {
  const tempBase = config.tempStorage || '/tmp'
  const outputDir = `${tempBase}/v2v-${jobId}`
  const pwFile = `${tempBase}/v2v-pwfile-${jobId}`
  const vmNameEsc = shellEscape(config.sourceVmName)

  let v2vCmd: string
  // --block-driver landed in libguestfs/virt-v2v but is not present in every
  // 2.x build (Debian 12 Bookworm's 2.0.x, plus some 2.2.0 packages that predate
  // the flag). Without it virt-v2v defaults to virtio-blk driver injection for
  // Windows. Linux guests boot fine either way; Windows guests in the fallback
  // path are attached on virtio0 instead of scsi0 (see `useVirtioBlk` at the
  // disk-attach loop) so the injected viostor.sys matches the actual bus.
  const blockDriverOpt = supportsBlockDriver ? '--block-driver virtio-scsi ' : ''
  // NOTE: no trailing `2>&1`. The caller (runVirtV2vWithProgress) wraps the
  // whole command in a nohup + file redirect (`> log 2>&1`) so the streams
  // are merged into a log file, then polled for progress. Putting a `2>&1`
  // here would be redundant (and actively wrong if the caller wraps us).
  const v2vOpts = `${blockDriverOpt}-o local -os ${shellEscape(outputDir)} --machine-readable`

  // Pre-downloaded local disks (NFC export path for vSAN). This bypasses the
  // sourceType-specific URI building below since virt-v2v doesn't need to talk
  // to the hypervisor anymore.
  if (preDownloadedDiskPaths && preDownloadedDiskPaths.length > 0) {
    if (preDownloadedDiskPaths.length === 1) {
      // Single-disk fast path: virt-v2v -i disk works directly on one VMDK
      // without any extra metadata file. Simpler and battle-tested.
      const diskArg = shellEscape(preDownloadedDiskPaths[0])
      const cmd = `virt-v2v -i disk ${diskArg} ${v2vOpts}`
      // Caller (runVirtV2vWithProgress) ensures outputDir exists before launching.
    return cmd
    }
    // Multi-disk path: virt-v2v's -i disk only takes one disk, so we use
    // -i libvirtxml with a synthesized domain XML referencing every downloaded
    // VMDK. The caller (runV2vMigrationPipeline) is responsible for writing the
    // XML file to `libvirtXmlPath` on the target node BEFORE this command runs.
    // We don't build the XML here because that needs SOAP-side metadata
    // (memory, vcpu count, firmware) which isn't available in this synchronous
    // command builder.
    if (!libvirtXmlPath) {
      throw new Error(
        `Multi-disk NFC path requires a pre-written libvirt domain XML at ` +
        `libvirtXmlPath; the caller did not provide one. This is a pipeline bug, ` +
        `not a user-facing error.`,
      )
    }
    const cmd = `virt-v2v -i libvirtxml ${shellEscape(libvirtXmlPath)} ${v2vOpts}`
    // Caller (runVirtV2vWithProgress) ensures outputDir exists before launching.
    return cmd
  }

  switch (config.sourceType) {
    case "vcenter": {
      // libvirt vpx URI formats:
      //   Standalone host: vpx://USER@VCENTER/DATACENTER/host/ESX-HOST?no_verify=1
      //   Clustered host:  vpx://USER@VCENTER/DATACENTER/host/CLUSTER/ESX-HOST?no_verify=1
      // Components must be percent-encoded (not shell-escaped) because the URI is a
      // single token; the surrounding shellEscape on the whole URI handles shell quoting.
      // The '@' in SSO usernames like "administrator@vsphere.local" is a URI-reserved
      // separator and MUST be encoded as %40, otherwise libvirt's parse_uri rejects it.
      if (!config.vcenterDatacenter || !config.vcenterHost) {
        // Diagnostic: which one(s) are missing so the user can tell whether SOAP
        // discovery silently failed (both empty), or only one field arrived (likely
        // a stale frontend cache that sent the legacy payload before re-listing VMs).
        const missing: string[] = []
        if (!config.vcenterDatacenter) missing.push("vcenterDatacenter")
        if (!config.vcenterHost) missing.push("vcenterHost")
        throw new Error(
          `vCenter migration is missing required field(s): ${missing.join(", ")}. ` +
          `These are normally auto-discovered server-side by listing the VMs on the ` +
          `vCenter connection (SOAP -> soapResolveHostInventoryPaths). If this error ` +
          `persists, refresh the VM list in the UI (the cached inventory may pre-date ` +
          `the discovery feature) and check the server logs for "[vmware/vms] Resolved ` +
          `only N/M ESXi host inventory paths" warnings.`,
        )
      }
      const userEnc = encodeURIComponent(username)
      const hostEnc = encodeURIComponent(host)
      const dcEnc = encodeURIComponent(config.vcenterDatacenter)
      const esxiEnc = encodeURIComponent(config.vcenterHost)
      // Cluster segment is optional. When the ESXi host is part of a vSphere cluster
      // (vSAN, DRS, HA, etc.) libvirt requires the cluster name in the inventory path;
      // omitting it would cause "Could not find domain at host" from the vpx driver.
      const clusterSegment = config.vcenterCluster
        ? `${encodeURIComponent(config.vcenterCluster)}/`
        : ""
      const uri = `vpx://${userEnc}@${hostEnc}/${dcEnc}/host/${clusterSegment}${esxiEnc}?no_verify=1`
      v2vCmd = `virt-v2v -ic ${shellEscape(uri)} -ip ${shellEscape(pwFile)} ${vmNameEsc} ${v2vOpts}`
      break
    }
    case "hyperv": {
      if (config.diskPaths && config.diskPaths.length > 0) {
        // Disk-based mode: no credentials needed
        const diskArgs = config.diskPaths.map(p => shellEscape(p)).join(" ")
        v2vCmd = `virt-v2v -i disk ${diskArgs} ${v2vOpts}`
      } else {
        // Network mode: connect to Hyper-V host. Same percent-encode rule as vpx above.
        const userEnc = encodeURIComponent(username)
        const hostEnc = encodeURIComponent(host)
        const uri = `hyperv://${userEnc}@${hostEnc}`
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

  // Caller (runVirtV2vWithProgress) ensures outputDir exists before launching.
  return v2vCmd
}

/**
 * Parse virt-v2v output lines and update job progress.
 */
async function processV2vOutput(jobId: string, output: string, progressOffset: number = 0, progressScale: number = 100): Promise<void> {
  const lines = output.split("\n")
  let maxProgress = -1
  let lastStep = ""
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const progress = parseV2vLine(trimmed)
    if (!progress) continue

    // Track the latest phase name and the max progress seen in this batch.
    // virt-v2v repeats the same phase message multiple times (esp. around
    // disk transitions) and legacy percent lines reset to 0 at the start of
    // each disk — we don't want the UI progress bar to bounce backwards.
    if (progress.step) lastStep = progress.step
    if (progress.percent > 0) {
      const v2vPct = calculateOverallProgress(progress)
      if (v2vPct > maxProgress) maxProgress = v2vPct
    }
  }
  // Single updateJob call per batch (instead of one per line) to avoid
  // hammering the DB during the polling loop which runs every 5s.
  const patch: Record<string, any> = {}
  if (maxProgress >= 0) {
    const globalPct = Math.round(progressOffset + (maxProgress / 100) * progressScale)
    patch.progress = Math.min(globalPct, 100)
  }
  if (lastStep) {
    // currentStep is surfaced in the UI under each migration job card.
    // Showing "Copying disk 1/2" / "Inspecting the source" etc. is more
    // informative than the raw pipeline state names (transferring,
    // creating_vm) while virt-v2v runs.
    patch.currentStep = lastStep
  }
  if (Object.keys(patch).length > 0) {
    await updateJob(jobId, "transferring", patch)
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
  // NFC transport state (used when source = vCenter and any disk is on vSAN).
  // We open a long-lived SOAP session for the duration of the NFC export and
  // logout in cleanup; the downloaded disks must also be removed in both
  // success and failure paths so we don't leak temp space on the PVE node.
  let vmwareSession: SoapSession | null = null
  let nfcDownloadedDisks: string[] = []
  // When NFC export ran, virt-v2v's -i disk mode loses the source VM metadata
  // (CPU, RAM, NIC model/MAC) because those live in the VMX/OVF, not in the disk.
  // We capture the parsed source config at vSAN detection time and use it later
  // in Phase 5 to override the sparse defaults virt-v2v would otherwise emit.
  let sourceVmwareConfig: EsxiVmConfig | null = null

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

    // Probe virt-v2v capability for --block-driver (introduced in 2.2.0).
    // Debian 12 Bookworm (PVE 8 base) ships virt-v2v 2.0.x which lacks this flag.
    const blockDriverProbe = await executeSSH(
      config.targetConnectionId,
      nodeIp,
      "virt-v2v --help 2>&1 | grep -q -- '--block-driver' && echo yes || echo no",
    )
    const supportsBlockDriver = blockDriverProbe.output?.trim() === "yes"
    if (!supportsBlockDriver) {
      await appendLog(
        jobId,
        "virt-v2v on this node does not support --block-driver. Falling back to virtio-blk: Windows data disks will be attached on virtio0 (matching the injected viostor.sys driver) instead of scsi0.",
        "warn",
      )
    }

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

    // ── PHASE 2.7: NFC export (vCenter source — every VM, every datastore) ──
    // We used to branch here on "is this VM on vSAN?" and only route the NFC
    // transport for vSAN disks, letting non-vSAN VMs fall through to virt-v2v's
    // default vpx:// + HTTP /folder/ path. Real-world testing showed vpx:// is
    // DRAMATICALLY slower than NFC on every datastore type we tested (VMFS
    // included): the HTTP /folder/ API isn't optimised for streaming so each
    // block read is an independent HTTPS request — "Inspecting the source"
    // phase alone can take 15+ minutes on a VM that NFC downloads in 5 minutes
    // total. NFC (HttpNfcLease) is the canonical VMware transfer API and
    // supports every datastore (VMFS, NFS, vSAN) uniformly.
    //
    // So now: vCenter → always NFC. One code path, one set of dependencies
    // (nbdkit + libnbd-bin, auto-installed below), predictable performance.
    if (config.sourceType === "vcenter") {
      const sourceConn = await prisma.connection.findUnique({
        where: { id: config.sourceConnectionId },
        select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true },
      })
      if (!sourceConn?.apiTokenEnc) {
        throw new Error("vCenter source connection credentials not found")
      }
      const sourceCreds = decryptSecret(sourceConn.apiTokenEnc)
      const credColon = sourceCreds.indexOf(":")
      const soapUser = credColon > 0 ? sourceCreds.substring(0, credColon) : "root"
      const soapPass = credColon > 0 ? sourceCreds.substring(credColon + 1) : sourceCreds
      const soapBaseUrl = sourceConn.baseUrl.replace(/\/$/, "")

      await appendLog(jobId, "Opening SOAP session to vCenter for NFC export...")
      vmwareSession = await soapLogin(soapBaseUrl, soapUser, soapPass, sourceConn.insecureTLS)

      const vmConfigXml = await soapGetVmConfig(vmwareSession, config.sourceVmId)
      sourceVmwareConfig = parseVmConfig(vmConfigXml)
      const datastoreNames = sourceVmwareConfig.disks.map(d => d.datastoreName).filter(Boolean)
      await appendLog(
        jobId,
        `Source VM has ${sourceVmwareConfig.disks.length} disk(s) on datastores: ` +
        `${datastoreNames.join(", ") || "(none parsed)"}. Using NFC transport (vCenter canonical API).`,
      )

      // virt-v2v's `-i disk` / `-i libvirtxml` input modes need two Debian
      // packages: nbdkit (exposes the local VMDK over NBD during opening /
      // inspection) and libnbd-bin (provides `nbdcopy`, used during disk
      // copy). Missing nbdcopy is only reported AFTER the multi-GB NFC
      // download and the full OS conversion, the worst place to fail. Auto-
      // install upfront so the user doesn't waste a long download.
      const depsCheck = await executeSSH(
        config.targetConnectionId,
        nodeIp,
        "which nbdkit >/dev/null 2>&1 && which nbdcopy >/dev/null 2>&1 && echo ok || echo missing",
      )
      if (depsCheck.output?.trim() !== "ok") {
        await appendLog(
          jobId,
          "nbdkit or libnbd-bin missing on target node; auto-installing (required for virt-v2v NFC path)...",
          "warn",
        )
        const install = await executeSSH(
          config.targetConnectionId,
          nodeIp,
          "apt-get update -qq && apt-get install -y nbdkit libnbd-bin",
        )
        if (!install.success) {
          throw new Error(
            `Failed to auto-install nbdkit + libnbd-bin: ${install.error || install.output?.substring(0, 300)}. ` +
            `Install manually on the Proxmox node: apt install nbdkit libnbd-bin`,
          )
        }
        await appendLog(jobId, "nbdkit + libnbd-bin installed successfully", "success")
      }

      // Reset to the transferring phase since NFC download is the bulk of the work.
      await updateJob(jobId, "transferring", { progress: 0 })
      nfcDownloadedDisks = await runVcenterNfcExport(
        jobId,
        config,
        nodeIp,
        vmwareSession,
        outputDir,
        sourceVmwareConfig,
      )
      // SOAP session is no longer needed past this point: the NFC lease has
      // been finalised inside runVcenterNfcExport(). Close it now to release
      // the vCenter session slot rather than holding it for the long virt-v2v
      // conversion that follows.
      await soapLogout(vmwareSession).catch(() => {})
      vmwareSession = null
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
    // Don't reset progress for Nutanix or vSAN-NFC (download phase already at 50%).
    const hasDownloadPhase = config.sourceType === "nutanix" || nfcDownloadedDisks.length > 0
    if (!hasDownloadPhase) {
      await updateJob(jobId, "transferring", { progress: 0 })
    }
    await appendLog(jobId, `Starting virt-v2v conversion (source: ${config.sourceType}, VM: "${config.sourceVmName}"${nfcDownloadedDisks.length > 0 ? ", transport: NFC" : ""})...`)

    // Multi-disk NFC path: synthesize a libvirt domain XML before we ask
    // virt-v2v to consume the downloaded VMDKs. virt-v2v's -i disk can only
    // ingest one disk, so for 2+ disks we switch to -i libvirtxml pointing at
    // an XML we write ourselves using the source VM's metadata from SOAP.
    let libvirtXmlPath: string | undefined
    if (nfcDownloadedDisks.length > 1) {
      libvirtXmlPath = `${outputDir}/vm.xml`
      const xml = buildSynthesizedLibvirtXml(
        config.sourceVmName,
        sourceVmwareConfig?.memoryMB || 1024,
        sourceVmwareConfig?.numCPU || 1,
        nfcDownloadedDisks,
      )
      await appendLog(jobId, `Multi-disk NFC path: writing synthesized libvirt domain XML for ${nfcDownloadedDisks.length} disks to ${libvirtXmlPath}`, "info")
      const writeXml = await executeSSH(
        config.targetConnectionId,
        nodeIp,
        `printf '%s' ${shellEscape(xml)} > ${shellEscape(libvirtXmlPath)}`,
      )
      if (!writeXml.success) {
        throw new Error(`Failed to write synthesized libvirt XML on target node: ${writeXml.error || writeXml.output}`)
      }
    }

    const v2vCommand = buildV2vCommand(
      jobId,
      config,
      username,
      host,
      supportsBlockDriver,
      // When NFC export ran, virt-v2v consumes the local VMDK files instead of
      // talking to vCenter. Empty array (the default) keeps the legacy vpx://
      // path for non-vSAN vCenter VMs and for hyperv/nutanix sources.
      nfcDownloadedDisks.length > 0 ? nfcDownloadedDisks : undefined,
      libvirtXmlPath,
    )
    await appendLog(jobId, `Running virt-v2v on ${config.targetNode}...`)

    // virt-v2v is launched in the background via runVirtV2vWithProgress so we
    // don't hit the 30s SSH timeout and get live progress updates parsed from
    // --machine-readable events. Any arbitrary timeout we'd pick here (1h? 4h?)
    // would be wrong for some real-world VM size/link combination; background
    // execution with an exit marker removes the cap entirely.
    const v2vProgressOffset = hasDownloadPhase ? 50 : 0
    const v2vProgressScale = hasDownloadPhase ? 50 : 100
    let v2vResult = await runVirtV2vWithProgress(
      jobId,
      config,
      nodeIp,
      v2vCommand,
      v2vProgressOffset,
      v2vProgressScale,
    )

    // Parse progress from output
    if (v2vResult.output) {
      await processV2vOutput(jobId, v2vResult.output, hasDownloadPhase ? 50 : 0, hasDownloadPhase ? 50 : 100)
    }

    // NTFS dirty flag recovery: if virt-v2v failed with NTFS errors and we're in disk mode, try ntfsfix.
    // "disk mode" means the VMDKs are local files — either from config.diskPaths (Hyper-V/Nutanix)
    // or from nfcDownloadedDisks (vCenter NFC export). Both paths have the files on the PVE node.
    const localDiskPaths = (config.diskPaths && config.diskPaths.length > 0)
      ? config.diskPaths
      : (nfcDownloadedDisks.length > 0 ? nfcDownloadedDisks : null)
    const isNtfsError = !v2vResult.success && v2vResult.output &&
      /read.only|not cleanly unmounted|ntfs.*dirty|mounted read.only|windows hibernat|Fast Restart/i.test(v2vResult.output)

    if (isNtfsError && localDiskPaths) {
      await appendLog(jobId, "NTFS dirty flag detected (Windows Fast Startup / Hibernation). Attempting ntfsfix recovery...", "warn")

      // Check if ntfsfix + qemu-nbd are available; auto-install if missing
      let toolCheck = await executeSSH(config.targetConnectionId, nodeIp, "which ntfsfix && which qemu-nbd && echo ok")
      if (!toolCheck.success || !toolCheck.output?.trim().endsWith("ok")) {
        await appendLog(jobId, "ntfsfix/qemu-nbd not found, auto-installing ntfs-3g + qemu-utils...", "warn")
        await executeSSH(config.targetConnectionId, nodeIp, "apt-get update -qq && apt-get install -y ntfs-3g qemu-utils")
        toolCheck = await executeSSH(config.targetConnectionId, nodeIp, "which ntfsfix && which qemu-nbd && echo ok")
      }
      if (toolCheck.success && toolCheck.output?.trim().endsWith("ok")) {
        for (const diskPath of localDiskPaths) {
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

        // Same background-polling helper as the initial attempt — retries run
        // the full virt-v2v pipeline again (source download + conversion).
        v2vResult = await runVirtV2vWithProgress(
          jobId,
          config,
          nodeIp,
          v2vCommand,
          v2vProgressOffset,
          v2vProgressScale,
        )
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

    // Cleanup the NFC-downloaded source VMDKs now that virt-v2v has produced
    // its converted outputs (named <basename>-sda, -sdb, ... under outputDir).
    // Leaving them around would cause Phase 6 ("Listing converted disk files")
    // to pick them up and attach them as extra disks on the Proxmox VM (seen
    // in real migrations as a duplicate scsi1 alongside the correct scsi0).
    // We also free the temp-storage space here, not in the finally block, so
    // subsequent phases have room to breathe if Proxmox storage is the same
    // mount as the temp output dir.
    if (nfcDownloadedDisks.length > 0) {
      for (const p of nfcDownloadedDisks) {
        await executeSSH(config.targetConnectionId, nodeIp, `rm -f ${shellEscape(p)}`).catch(() => {})
      }
      await appendLog(jobId, `Cleaned up ${nfcDownloadedDisks.length} NFC source VMDK(s) from ${outputDir}`, "info")
      // Clear the array so the finally-block doesn't try to rm them again.
      nfcDownloadedDisks = []
    }
    // Same treatment for our synthesized input XML in multi-disk mode: Phase 5
    // does `cat ${outputDir}/*.xml` and would concat our input XML with the
    // output domain XML that virt-v2v wrote — leading to a duplicated disk list
    // and garbled VM metadata. Remove the input XML now that virt-v2v no longer
    // needs it.
    if (libvirtXmlPath) {
      await executeSSH(config.targetConnectionId, nodeIp, `rm -f ${shellEscape(libvirtXmlPath)}`).catch(() => {})
    }

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

      // NFC transport path (vSAN): virt-v2v -i disk doesn't see the source VMX/OVF
      // so its generated XML carries placeholder defaults (1 vCPU, 1 GB RAM, no NICs).
      // We have the real values from the SOAP inspection done in Phase 2.7 — merge
      // them in so the Proxmox VM matches the source. Without this, every vSAN
      // migration would land on PVE with wrong sizing and require manual fixup.
      if (sourceVmwareConfig) {
        const realCpu = sourceVmwareConfig.numCPU || vmConfig.cores
        const realSockets = sourceVmwareConfig.sockets || vmConfig.sockets
        const realMemMB = sourceVmwareConfig.memoryMB || vmConfig.memory
        const realFirmware: 'bios' | 'efi' = sourceVmwareConfig.firmware === "efi" ? "efi" : "bios"

        await appendLog(
          jobId,
          `Overriding virt-v2v defaults with vCenter source values: ` +
          `cores ${vmConfig.cores}->${realCpu}, sockets ${vmConfig.sockets}->${realSockets}, ` +
          `memory ${vmConfig.memory}MB->${realMemMB}MB, firmware ${vmConfig.firmware}->${realFirmware}, ` +
          `NICs ${vmConfig.nics.length}->${sourceVmwareConfig.nics.length}`,
          "info",
        )
        vmConfig.cores = realCpu
        vmConfig.sockets = realSockets
        vmConfig.memory = realMemMB
        vmConfig.firmware = realFirmware

        // NIC mapping: preserve MAC addresses for guest network continuity (DHCP
        // reservations, license activations tied to MAC, etc.). We map each source
        // NIC to a virtio device on the chosen Proxmox bridge; complex bridge-to-
        // network mapping is a future improvement (would need vSphere network ->
        // PVE bridge configuration in the connection).
        if (sourceVmwareConfig.nics.length > 0) {
          vmConfig.nics = sourceVmwareConfig.nics.map(n => ({
            model: "virtio",
            mac: n.macAddress || undefined,
          }))
        }
      }

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

    // EFI VMs need an EFI varstore disk allocated at create time. We compute
    // this once here so both the create body builder AND Phase 6's disk
    // numbering (line below this block) can read it. Bug-trap: when this was
    // declared inside buildCreateBody() the Phase 6 reference at
    // `let nextDiskNum = isEfi ? 1 : 0` blew up with "isEfi is not defined".
    const isEfi = vmConfig?.firmware === "efi" || createParams.bios === "ovmf"

    const buildCreateBody = (vmid: number) => {
      const body = new URLSearchParams()
      for (const [key, value] of Object.entries({ ...createParams, vmid })) {
        body.set(key, String(value))
      }
      body.set("serial0", "socket")
      if (isEfi) {
        body.set("efidisk0", `${config.targetStorage}:1,efitype=4m,pre-enrolled-keys=0`)
      }
      return body
    }

    // Race-tolerant create loop: PVE's /cluster/nextid is NOT atomic — concurrent
    // bulk migrations can both grab the same id, then the second create fails
    // with "VM <id> already exists on node ...". With BULK_MIG_CONCURRENCY=1
    // (sequential) this can't happen, but we keep the loop so future concurrent
    // bumps don't reintroduce the bug. Try up to 5 times: on conflict, ask PVE
    // for a fresh id and retry. Any other PVE error is fatal.
    const MAX_VMID_RETRIES = 5
    let createdVmid = targetVmid
    for (let attempt = 0; attempt < MAX_VMID_RETRIES; attempt++) {
      try {
        const createResult = await pveFetch<any>(
          pveConn,
          `/nodes/${encodeURIComponent(config.targetNode)}/qemu`,
          { method: "POST", body: buildCreateBody(createdVmid) },
        )
        if (createResult) {
          await waitForPveTask(pveConn, config.targetNode, String(createResult))
        }
        targetVmid = createdVmid
        // Make sure the cleanup paths use the actually-created id, not the
        // initially-allocated one we may have moved past.
        await updateJob(jobId, "creating_vm", { targetVmid })
        await appendLog(jobId, `VM ${targetVmid} created on ${config.targetNode}`, "success")
        break
      } catch (err: any) {
        const errMsg = err?.message || String(err)
        const isConflict = /already exists on node/i.test(errMsg) || /VM \d+ already exists/i.test(errMsg)
        if (!isConflict || attempt === MAX_VMID_RETRIES - 1) {
          throw err
        }
        const freshId = Number(await pveFetch<number | string>(pveConn, "/cluster/nextid"))
        await appendLog(
          jobId,
          `VMID ${createdVmid} taken (race with concurrent migration), retrying with fresh id ${freshId}`,
          "warn",
        )
        createdVmid = freshId
      }
    }

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── PHASE 6: Import disks ──
    await appendLog(jobId, "Listing converted disk files...")

    // Grep excludes:
    //   - .xml   : virt-v2v's libvirt domain descriptor (parsed separately above)
    //   - .vmdk  : NFC-downloaded source VMDKs that the previous step should have
    //              cleaned up already; belt-and-braces so a leftover source file
    //              can't be wrongly attached to the PVE VM as an extra disk.
    //   - .ctrl* : stray control files from NFC download (.pid, .exit, .err, .curlcfg);
    //              same defensive reason, the helper removes them on both paths.
    const lsResult = await executeSSH(
      config.targetConnectionId, nodeIp,
      `ls -1 ${shellEscape(outputDir)} | grep -vE '\\.(xml|vmdk|pid|exit|err|curlcfg)$' | sort`
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

    // When virt-v2v can't inject virtio-scsi (`--block-driver` missing), it falls
    // back to virtio-blk (viostor.sys) as the boot-critical driver on Windows.
    // Attaching on scsi0 in that case yields INACCESSIBLE_BOOT_DEVICE (0x7B) at
    // first boot because vioscsi.sys isn't registered as critical. Attach on
    // virtio0 instead so the injected viostor matches the bus.
    const useVirtioBlk = isWindowsVm && !supportsBlockDriver

    for (let i = 0; i < diskFiles.length; i++) {
      const diskFile = diskFiles[i]
      const diskPath = `${outputDir}/${diskFile}`
      const diskSlot = useVirtioBlk ? `virtio${i}` : `scsi${i}`

      await appendLog(jobId, `[Disk ${i + 1}/${diskFiles.length}] Importing ${diskFile}...`)
      await updateJob(jobId, "transferring", {
        currentStep: `importing_disk_${i + 1}`,
        progress: Math.round(70 + (i / diskFiles.length) * 25),
      })

      if (isFileBased) {
        // File-based storage: qm disk import. Same 30s-default-timeout problem
        // as the dd path below — qm disk import streams the entire disk into
        // PVE storage and routinely runs for 5-30 min on multi-GB disks. Use a
        // 4h cap so SSH doesn't kill the import mid-stream.
        const FOUR_HOURS_MS = 14_400_000
        const importResult = await executeSSH(
          config.targetConnectionId, nodeIp,
          `qm disk import ${targetVmid} ${shellEscape(diskPath)} ${shellEscape(config.targetStorage)} --format qcow2 2>&1`,
          FOUR_HOURS_MS,
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
          [diskSlot]: `${diskVolume},discard=on`,
        })
        try {
          await pveFetch<any>(
            pveConn,
            `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
            { method: "PUT", body: attachBody }
          )
          await appendLog(jobId, `Disk ${i + 1} imported and attached as ${diskSlot}`, "success")
        } catch (attachErr: any) {
          await appendLog(jobId, `Warning: Could not auto-attach ${diskSlot}: ${attachErr.message}`, "warn")
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
          // efidisk/tpmstate also consume vm-<vmid>-disk-N slots — miss them and we
          // collide on "dataset already exists" when PVE auto-allocates the efidisk
          // as disk-0 on OVMF VMs.
          .filter(k => k.match(/^(?:scsi|sata|virtio|ide|unused|efidisk|tpmstate)\d+$/))
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

        // Stream data to block device.
        // executeSSH defaults to a 30s timeout which is far too short for a multi-GB
        // dd write to a ZFS zvol or Ceph RBD device — typical Linux VMs (10-50 GB)
        // take 1-15 min depending on storage backend speed, and large data disks
        // can take well over an hour. We pass an explicit 4h cap so the SSH layer
        // doesn't kill the dd mid-write (which manifested as
        // "Block write failed: SSH connection timeout (30s)" on real migrations).
        await appendLog(jobId, `[Disk ${i + 1}/${diskFiles.length}] Streaming to block device ${devicePath}...`)
        const FOUR_HOURS_MS = 14_400_000
        const ddResult = await executeSSH(
          config.targetConnectionId, nodeIp,
          `pv ${shellEscape(diskPath)} | dd of=${shellEscape(devicePath)} bs=4M oflag=direct 2>&1`,
          FOUR_HOURS_MS,
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
          [diskSlot]: volumeId,
        })
        try {
          await pveFetch<any>(
            pveConn,
            `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
            { method: "PUT", body: attachBody }
          )
          await appendLog(jobId, `Disk ${i + 1} imported and attached as ${diskSlot}`, "success")
        } catch (attachErr: any) {
          await appendLog(jobId, `Warning: Could not auto-attach ${diskSlot}: ${attachErr.message}`, "warn")
        }
      }

      nextDiskNum++
    }

    // Set boot order — must match the slot of the first data disk, which on
    // Windows-without-block-driver lives on virtio0 (see useVirtioBlk comment
    // above).
    const bootSlot = useVirtioBlk ? "virtio0" : "scsi0"
    await pveFetch<any>(
      pveConn,
      `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`,
      { method: "PUT", body: new URLSearchParams({ boot: `order=${bootSlot}` }) }
    )
    await appendLog(jobId, `Boot order set to ${bootSlot}`, "success")

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
    // Always close the vCenter SOAP session if one is open. Leaving it dangling
    // would slowly exhaust vCenter's session pool (default cap ~250). Idempotent
    // and fault-tolerant: we never want cleanup to mask the real migration error.
    if (vmwareSession) {
      await soapLogout(vmwareSession).catch(() => {})
      vmwareSession = null
    }
    // Remove NFC-downloaded VMDK files. virt-v2v has already consumed them on
    // the success path; on failure the partials are useless and will accumulate
    // on the PVE node's temp storage if not cleaned. The runVcenterNfcExport
    // helper does its own cleanup on internal errors, but cleanup here is the
    // safety net for failures further down the pipeline (after NFC succeeded).
    if (nfcDownloadedDisks.length > 0) {
      try {
        const pveConn = await getConnectionById(config.targetConnectionId)
        const nodeIp = await getNodeIp(pveConn, config.targetNode)
        for (const p of nfcDownloadedDisks) {
          await executeSSH(config.targetConnectionId, nodeIp, `rm -f ${shellEscape(p)}`).catch(() => {})
        }
      } catch {
        // Best-effort: PVE connection lookup itself can fail in dev/test setups.
      }
    }
    cancelledJobs.delete(jobId)
    jobPrisma.delete(jobId)
  }
}
