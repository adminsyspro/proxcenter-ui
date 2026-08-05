import { getTenantPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { isFileBasedStorage } from "@/lib/proxmox/storage"
import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import {
  soapLogin, soapLogout, soapGetVmConfig, parseVmConfig, soapCreateSnapshot, soapRemoveSnapshot,
} from "@/lib/vmware/soap"
import type { SoapSession, EsxiVmConfig, EsxiDiskInfo } from "@/lib/vmware/soap"
import {
  cbtEligibility, soapEnableCbt, queryAllChangedAreas, soapGetSnapshotChangeIds,
  soapGuestShutdown, soapWaitPoweredOff, soapKeepAlive,
} from "@/lib/vmware/cbt"
import { mapEsxiToPveConfig } from "../configMapper"
import {
  allocateAndMapBlockVolume, nextFreeDiskName, volumesToFree, volumesToKeep,
  PVESM_FREE_TIMEOUT_MS, type AllocatedVolume,
} from "../pvesm-alloc"
import { pveSetVmConfig } from "../pve-vm-config"
import { waitForPveTask, getNodeIpForMigration } from "../pve-tasks"
import { convertDisksToQcow2 } from "../qcow2-convert"
import { decideNextPass, type PassStat, type ConvergenceConfig, type ConvergenceDecision } from "./convergence"
import { initDiskState, recordPass, type DiskWarmState } from "./state"
import { startVddkReader, stopVddkReader, type VddkReaderHandle } from "./vddk-reader"
import type { VddkOpts } from "./vddk-cmd"
import { buildApplyScripts } from "./block-applier"
import { parseDdProgress, createDdProgressAccumulator } from "./dd-progress"
import { detectChangedExtentsByChecksum, scanBlockChecksums } from "./checksum-detector"
import { checkVddkPreflight } from "./vddk-preflight"
import { parseSha1Thumbprint } from "./thumbprint"
import type { Extent } from "./extents"
import { startSoapKeepAlive } from "./session-keepalive"
import { startJobHeartbeat } from "../job-heartbeat"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"

export type WarmStatus =
  | "pending" | "planning" | "enabling_cbt" | "preparing_disks" | "full_copy" | "delta_sync"
  | "awaiting_cutover" | "cutover" | "verify" | "converting_disks"
  | "completed" | "failed" | "cancelled"

export interface WarmMigrationConfig {
  sourceConnectionId: string
  sourceVmId: string
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  networkBridge: string
  vlanTag?: number
  startAfterMigration: boolean
  /**
   * Convert the migrated data disks to qcow2 after the cutover (one `move_disk`
   * per disk on the same storage), so they can take Proxmox snapshots on a
   * snapshot-as-volume-chain LVM storage (#595). Opt-in, default false; the
   * conversion can never fail the migration.
   */
  convertDisksToQcow2?: boolean
  targetVmid?: number
  /** Extracted VDDK distribution dir on the PVE node (libdir=). */
  vddkLibdir?: string
  /** Max cutover downtime before warm requires operator consent (default 300s). */
  downtimeBudgetSec?: number
  /** Safety cap on delta passes (default 5). */
  maxPasses?: number
}

// ── Job tracking (per-orchestrator, mirrors the other migration pipelines) ──
interface LogEntry { ts: string; msg: string; level: "info" | "success" | "warn" | "error" }
const cancelledJobs = new Set<string>()
const cutoverRequests = new Set<string>()
const jobPrisma = new Map<string, any>()
// At most one warm job per source VM in-flight. Concurrent warm runs against the
// same VM would interleave snapshots and dd-seek writes (target corruption), so a
// second run for a VM already migrating is rejected (design §12 concurrency lock).
const activeWarmVms = new Set<string>()

/** Cooperative cancel signal for a warm job (called by the cancel route). */
export function cancelWarmMigrationJob(jobId: string) { cancelledJobs.add(jobId) }
function isCancelled(jobId: string): boolean { return cancelledJobs.has(jobId) }

/** Cooperative "cutover now" signal for a warm job (called by the cutover route). */
export function requestWarmCutover(jobId: string) { cutoverRequests.add(jobId) }
function isCutoverRequested(jobId: string): boolean { return cutoverRequests.has(jobId) }
/** @internal test hook */
export function __isCutoverRequestedForTest(jobId: string): boolean { return isCutoverRequested(jobId) }

async function updateJob(id: string, status: WarmStatus, extra: Record<string, any> = {}) {
  const prisma = jobPrisma.get(id)
  await prisma.migrationJob.update({
    where: { id },
    data: { status, currentStep: status, ...(status === "completed" ? { completedAt: new Date() } : {}), ...extra },
  })
}

/**
 * Throttled live-progress write, fired from an SSH onData callback that is not
 * awaited by the pipeline. updateMany scoped to a non-terminal status: a
 * straggler flush racing the terminal write in the catch must never resurrect a
 * completed/failed/cancelled row (#608 — same guard as the job heartbeat).
 */
async function updateJobLive(id: string, status: WarmStatus, extra: Record<string, any> = {}) {
  const prisma = jobPrisma.get(id)
  await prisma.migrationJob.updateMany({
    where: { id, status: { notIn: [...TERMINAL_STATUSES] } },
    data: { status, currentStep: status, ...extra },
  })
}

async function appendLog(id: string, msg: string, level: LogEntry["level"] = "info") {
  const prisma = jobPrisma.get(id)
  const job = await prisma.migrationJob.findUnique({ where: { id }, select: { logs: true, progress: true } })
  const logs: LogEntry[] = (job?.logs as LogEntry[] | null) ?? []
  logs.push({ ts: new Date().toISOString(), msg, level, progress: job?.progress ?? 0 } as any)
  await prisma.migrationJob.update({ where: { id }, data: { logs } })
}

// ── Pure convergence planning (unit-tested) ──

/**
 * Walk a sequence of pass statistics and return the decision after each pass,
 * stopping at the first non-delta decision (cutover or operator-gate). Pure
 * wrapper over decideNextPass; the live loop in runWarmMigration calls
 * decideNextPass per pass with freshly measured stats, but this lets the
 * convergence policy be tested without a live vCenter.
 */
export function planPasses(stats: PassStat[], cfg: ConvergenceConfig): ConvergenceDecision[] {
  const out: ConvergenceDecision[] = []
  for (let i = 0; i < stats.length; i++) {
    const d = decideNextPass(i, stats[i], cfg)
    out.push(d)
    if (d.action !== "delta") break
  }
  return out
}

// Long-running SSH operations (block apply, checksum scan) need a generous timeout.
const APPLY_TIMEOUT_MS = 12 * 60 * 60 * 1000
// Inactivity guard for the block-apply dd (which runs with status=progress, ~1
// line/s): if no output arrives for this long the transfer has genuinely stalled,
// so fail fast instead of waiting out the 12h absolute cap. A healthy copy emits
// progress continuously and never trips it (#445).
const APPLY_INACTIVITY_MS = 10 * 60 * 1000
// Throttle live throughput log lines so a multi-hour copy doesn't flood the job log.
const PROGRESS_LOG_INTERVAL_MS = 30_000
const SNAPSHOT_PREFIX = "proxcenter-warm"
// Ping the SOAP session every 60 s to prevent idle-expiry during long dd copies (issue #394).
const SOAP_KEEPALIVE_INTERVAL_MS = 60_000

// Parallel ranges for the streamed zero fallback. One dd is queue depth 1: the
// #606 field run sustained only 359 MiB/s on an FC array that reaches 1.9 GB/s
// with concurrency, i.e. 2 h 30 min to zero 3.1 TiB. FC/iSCSI arrays scale with
// outstanding I/O, so a handful of concurrent streams recovers most of it.
export const ZERO_PARALLEL_CHUNKS = 4

/**
 * Build the node-side command that zeroes a freshly-allocated *thick* block
 * device before the CBT copy. Unwritten regions on a thick LV are not
 * guaranteed to read as zero, and the CBT pass only writes the allocated/changed
 * map, so any gap left un-zeroed would surface a previous tenant's bytes (a
 * correctness AND information-leak bug). We prefer `blkdiscard -z` (offloaded
 * write-zeroes where the array supports it) and fall back to streaming zeros.
 * When the array refuses the offload, the script says so with a parseable
 * `blkdiscard-refused: <reason>` line — previously that reason was only visible
 * if the whole script failed, so the slow path ran with no explanation (#606).
 *
 * The fallback streams `head -c <bytes> /dev/zero | dd …` rather than the earlier
 * `dd if=/dev/zero of=DEV` (no count): a bare unbounded dd fills the device and
 * then issues one write *past* end-of-device, which returns ENOSPC and makes dd
 * exit 1 — even though every block was already zeroed — so the thick-zero step
 * could never succeed (this is what broke #445's disk 1 after a full 45-min
 * zero). The device is split into `chunks` equal 4 MiB-aligned ranges (the last
 * takes the remainder) and each range gets its own bounded stream, run in
 * parallel and reaped with `wait` (#606). Every stream is still bounded to its
 * exact range, so the #445 ENOSPC-past-EOF failure cannot come back.
 * `iflag=fullblock` reassembles 4 MiB blocks across the pipe so O_DIRECT
 * accepts every write, including a sub-4 MiB final block (still logical-block
 * aligned because a device size is always a sector multiple).
 *
 * The step used to run `status=none` — hours of total silence on a multi-TB LV,
 * indistinguishable from a hang (#606). Now each range dd writes
 * `status=progress` to its own temp file and a background poller sums the last
 * counter of every range every 10 s into ONE line in dd's own summary format
 * (`<bytes> bytes copied, <s> s`), so parseDdProgress consumes it unchanged,
 * the caller can drive the progress bar, and the SSH stream stays alive for the
 * same inactivity guard as the copy. On a range failure the dd error text (kept
 * in the temp files) is replayed to stdout so the caller surfaces the real cause.
 */
export function buildThickZeroScript(dev: string, chunks: number = ZERO_PARALLEL_CHUNKS): string {
  const d = shellEscape(dev)
  const n = Math.max(1, Math.floor(chunks))
  const lines = [
    `sz=$(blockdev --getsize64 ${d})`,
    `t=$(mktemp -d)`,
    `start=$(date +%s)`,
    `( while :; do sleep 10; b=0; for f in "$t"/z*; do [ -s "$f" ] || continue; v=$(tr '\\r' '\\n' < "$f" | awk '/ bytes /{n=$1} END{print n+0}'); b=$((b+v)); done; echo "$b bytes copied, $(($(date +%s)-start)) s"; done ) & poller=$!`,
    `trap 'kill $poller 2>/dev/null; rm -rf "$t"' EXIT`,
    `if out=$(blkdiscard -z ${d} 2>&1); then echo "$sz bytes copied, $(($(date +%s)-start)) s"; exit 0; fi`,
    `echo "blkdiscard-refused: $out"`,
    `per=$((sz / ${n} / 4194304 * 4194304))`,
  ]
  for (let i = 0; i < n; i++) {
    const bound = i === n - 1 ? `"$((sz - ${i} * per))"` : `"$per"`
    lines.push(`head -c ${bound} /dev/zero | dd of=${d} bs=4M iflag=fullblock oflag=seek_bytes,direct conv=notrunc status=progress seek=$((${i} * per)) 2>"$t/z${i}" & p${i}=$!`)
  }
  lines.push(`fail=0`)
  for (let i = 0; i < n; i++) lines.push(`wait $p${i} || fail=1`)
  lines.push(`if [ "$fail" -ne 0 ]; then for f in "$t"/z*; do tr '\\r' '\\n' < "$f" | grep -v ' bytes \\|records '; done; exit 1; fi`)
  lines.push(`echo "$sz bytes copied, $(($(date +%s)-start)) s"`)
  return lines.join("\n")
}

/**
 * Map a phase's byte counter onto its window of the warm run's locked progress
 * scale (#502/#606): preparing_disks 0→10, full_copy 10→80, delta passes 80→95,
 * cutover/verify/attach 95→100. Monotonic across the run as long as callers hand
 * it non-decreasing byte counts and contiguous windows. A total of zero means
 * the phase has nothing to do, i.e. it is already complete.
 */
export function scaleWarmProgress(rangeStart: number, rangeEnd: number, doneBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return Math.round(rangeEnd)
  const fraction = Math.min(1, Math.max(0, doneBytes / totalBytes))
  return Math.round(rangeStart + (rangeEnd - rangeStart) * fraction)
}

/** One copy pass's slot on the locked progress scale (see scaleWarmProgress). */
interface PassWindow {
  status: WarmStatus
  /** Persisted with each live update so a throttled flush never clobbers a
   *  finer-grained step label (e.g. `delta_2`). */
  currentStep: string
  rangeStart: number
  rangeEnd: number
}

/** Live byte bookkeeping for one pass, shared across its disks. */
interface PassProgress extends PassWindow {
  /** Denominator: changed-extent bytes across ALL disks of the pass. */
  totalBytes: number
  /** Exact bytes from disks already fully applied (corrected per disk). */
  doneBytes: number
  /** Monotonic floor so a conservative estimate never moves the bar backwards. */
  lastPct: number
}

const OPERATOR_GATE_TIMEOUT_MS = 2 * 60 * 60 * 1000 // 2h safety cap

/**
 * Pause a warm job at the operator gate: persist the estimate, log an actionable
 * message, then wait until the operator requests cutover (resolve), cancels
 * (throw "Migration cancelled"), or the safety timeout elapses (throw). No delta
 * passes run while waiting; only the SOAP session stays alive (keepalive).
 */
async function awaitOperatorCutover(
  jobId: string, projectedDowntimeSec: number, budgetSec: number, maxPasses: number,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const pollMs = opts.pollMs ?? 3000
  const timeoutMs = opts.timeoutMs ?? OPERATOR_GATE_TIMEOUT_MS
  await updateJob(jobId, "awaiting_cutover", { currentStep: "awaiting_cutover", projectedDowntimeSec })
  const mins = Math.round(projectedDowntimeSec / 60)
  await appendLog(jobId, `Reached ${maxPasses} delta passes; projected cutover downtime ~${projectedDowntimeSec}s (~${mins} min) exceeds the ${budgetSec}s budget. The source is changing faster than it converges. Click "Cutover now" to proceed (VM offline ~${mins} min), or cancel and use a cold migration.`, "warn")
  const start = Date.now()
  while (true) {
    if (isCancelled(jobId)) throw new Error("Migration cancelled")
    if (isCutoverRequested(jobId)) { await appendLog(jobId, "Operator requested cutover — proceeding to final delta", "info"); return }
    if (Date.now() - start > timeoutMs) throw new Error(`Operator gate timed out after ${Math.round(timeoutMs / 3600000)}h with no cutover decision; the job was left paused too long`)
    await new Promise(r => setTimeout(r, pollMs))
  }
}

/** @internal test hook */
export function __awaitOperatorCutoverForTest(
  jobId: string, projectedDowntimeSec: number, budgetSec: number, maxPasses: number,
  opts: { pollMs?: number; timeoutMs?: number },
): Promise<void> {
  jobPrisma.set(jobId, getTenantPrisma("default"))
  return awaitOperatorCutover(jobId, projectedDowntimeSec, budgetSec, maxPasses, opts)
}

/**
 * Warm migration orchestrator (ESXi-direct source, Proxmox block target).
 * Keeps the source online through a full copy + N delta passes, then a short
 * cutover with a CONFIRMED power-off. CBT (QueryChangedDiskAreas) is the
 * accelerator; a checksum block-diff is the lossless fallback. Coverage-excluded
 * (lab-validated, section 14 of the design); the pure planPasses above and the
 * helpers it composes carry the unit tests.
 */
export async function runWarmMigration(jobId: string, config: WarmMigrationConfig, tenantId = "default"): Promise<void> {
  const prisma = getTenantPrisma(tenantId)
  jobPrisma.set(jobId, prisma)
  cutoverRequests.delete(jobId)

  const libdir = config.vddkLibdir || "/usr/lib/vmware-vix-disklib"
  const budget = config.downtimeBudgetSec ?? 300
  const maxPasses = config.maxPasses ?? 5

  let soapSession: SoapSession | null = null
  let stopKeepAlive: (() => void) | null = null
  let targetVmid: number | null = config.targetVmid ?? null
  let nodeIp = ""                                   // resolved in planning; used by failure cleanup
  const vmKey = `${config.sourceConnectionId}:${config.sourceVmId}`
  let acquiredVmLock = false
  const ourSnapshots: string[] = []                 // MORs WE created — cleaned up by specific MOR
  const allocatedVolumes: AllocatedVolume[] = []
  const activeReaders: VddkReaderHandle[] = []      // readers to tear down on failure
  // Per-disk: target device path + CBT state. NOTE: state is in-memory only; a
  // retry re-runs from a fresh full pass (safe, full re-copy) rather than resuming
  // mid-stream. Persisted/resumable per-disk state (design §5.3/§12) is deferred.
  const targetDev = new Map<number, string>()
  const diskState = new Map<number, DiskWarmState>()

  // Liveness signal for the orphan sweep (#608): bump updatedAt while the job
  // runs. Warm is the pipeline that motivated it — a thick pre-zero can be
  // silent for hours (#606) and must not look like a dead process.
  const stopHeartbeat = startJobHeartbeat({ jobId, prisma })

  try {
    // ── planning ──
    await updateJob(jobId, "planning")
    await appendLog(jobId, "Warm migration: planning")

    if (activeWarmVms.has(vmKey)) {
      throw new Error("A warm migration is already running for this source VM. Wait for it to finish or cancel it before starting another.")
    }
    activeWarmVms.add(vmKey); acquiredVmLock = true

    const esxiConn = await prisma.connection.findUnique({
      where: { id: config.sourceConnectionId },
      select: { id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })
    if (!esxiConn || esxiConn.type !== "vmware") throw new Error("ESXi connection not found")

    const creds = decryptSecret(esxiConn.apiTokenEnc)
    const colonIdx = creds.indexOf(":")
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : "root"
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const esxiUrl = esxiConn.baseUrl.replace(/\/$/, "")
    const esxiHost = new URL(esxiUrl).hostname

    const pveConn = await getConnectionById(config.targetConnectionId)
    nodeIp = await getNodeIpForMigration(prisma, config.targetConnectionId, config.targetNode, (pveConn as any).baseUrl)

    soapSession = await soapLogin(esxiUrl, username, password, esxiConn.insecureTLS)
    await appendLog(jobId, `Authenticated to ${esxiHost} as ${username}`, "success")
    stopKeepAlive = startSoapKeepAlive(() => soapKeepAlive(soapSession!), SOAP_KEEPALIVE_INTERVAL_MS)

    const vmConfig: EsxiVmConfig = parseVmConfig(await soapGetVmConfig(soapSession, config.sourceVmId))
    for (const d of vmConfig.disks) {
      if (!d.datastoreName || !d.relativePath) throw new Error(`Disk "${d.label}" has no datastore path: ${d.fileName}`)
    }
    await updateJob(jobId, "planning", {
      sourceVmName: vmConfig.name,
      totalDisks: vmConfig.disks.length,
      totalBytes: BigInt(vmConfig.disks.reduce((s, d) => s + d.capacityBytes, 0)),
    })

    // Warm patches the target by byte offset, which is only valid on a raw
    // block device. A file-based target (dir/NFS qcow2) would be silently
    // corrupted by the dd-seek apply — refuse it up front.
    const storageInfo = await pveFetch<any>(pveConn as any, `/storage/${encodeURIComponent(config.targetStorage)}`)
    if (isFileBasedStorage(storageInfo?.type || "dir")) {
      throw new Error(`Warm migration requires a block-storage target (LVM/LVM-thin/ZFS/Ceph RBD); "${config.targetStorage}" is file-based (${storageInfo?.type}). Pick a block storage or use a cold migration.`)
    }

    // VDDK preflight on the PVE node — actionable error before we touch anything.
    const pf = await checkVddkPreflight(config.targetConnectionId, nodeIp, libdir)
    if (!pf.ok) throw new Error(pf.error || "VDDK preflight failed")
    await appendLog(jobId, "VDDK preflight OK on Proxmox node", "success")

    // CBT eligibility: the "*" baseline is VMFS-only and needs no pre-existing snapshot.
    const elig = cbtEligibility({ hwVersion: vmConfig.vmxVersion, disks: vmConfig.disks })
    const useCbt = elig.eligible && vmConfig.snapshotCount === 0
    if (!useCbt) {
      await appendLog(jobId, `CBT unavailable (${elig.reason || "pre-existing snapshot"}) — using checksum block-diff fallback (downtime scales with disk size)`, "warn")
    }

    // SSL thumbprint for the VDDK connection (fetched from the PVE node).
    const tp = await executeSSH(config.targetConnectionId, nodeIp,
      `echo | openssl s_client -connect ${shellEscape(esxiHost)}:443 2>/dev/null | openssl x509 -fingerprint -sha1 -noout`)
    const thumbprint = parseSha1Thumbprint(tp.output || "")

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── enabling_cbt: enable CBT + provision the target VM shell and raw volumes ──
    await updateJob(jobId, "enabling_cbt")
    if (useCbt) { await soapEnableCbt(soapSession, config.sourceVmId); await appendLog(jobId, "CBT enabled on source", "success") }

    if (targetVmid == null) targetVmid = Number(await pveFetch<number | string>(pveConn as any, "/cluster/nextid"))
    const pveParams = mapEsxiToPveConfig(vmConfig, targetVmid, config.targetStorage, config.networkBridge, config.vlanTag)
    const createBody = new URLSearchParams({
      vmid: String(pveParams.vmid), name: pveParams.name, ostype: pveParams.ostype,
      cores: String(pveParams.cores), sockets: String(pveParams.sockets), memory: String(pveParams.memory),
      cpu: pveParams.cpu, scsihw: pveParams.scsihw, bios: pveParams.bios, machine: pveParams.machine,
      net0: pveParams.net0, agent: pveParams.agent, serial0: "socket",
    })
    if (pveParams.efidisk0) createBody.set("efidisk0", pveParams.efidisk0)
    const created = await pveFetch<any>(pveConn as any, `/nodes/${encodeURIComponent(config.targetNode)}/qemu`, { method: "POST", body: createBody })
    if (created) await waitForPveTask(pveConn as any, config.targetNode, String(created))
    await updateJob(jobId, "enabling_cbt", { targetVmid })
    await appendLog(jobId, `Target VM ${targetVmid} created on ${config.targetNode}`, "success")

    // The VM shell may already own a disk: an OVMF/UEFI guest gets an efidisk0
    // (vm-<vmid>-disk-0) created with `qm create`. Data disks must therefore start
    // after the highest existing disk number, or `pvesm alloc` collides on the name.
    const shellConf = await pveFetch<Record<string, any>>(pveConn as any, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`)

    // ── preparing_disks: allocate a raw block volume per disk, zero the thick ones ──
    // A dedicated phase, not enabling_cbt: on thick LVM the mandatory pre-zero
    // below can run for hours, and the badge must say what the job is doing (#606).
    // Progress covers 0→10 of the locked scale, weighted by bytes zeroed across
    // all disks (they share the target storage, so it is all-thick or none).
    await updateJob(jobId, "preparing_disks")
    const zeroTotalBytes = vmConfig.disks.reduce((s, d) => s + d.capacityBytes, 0)
    let zeroedBytes = 0
    let lastZeroPct = 0
    for (let i = 0; i < vmConfig.disks.length; i++) {
      const disk = vmConfig.disks[i]
      const sizeKB = Math.ceil(disk.capacityBytes / 1024)
      // Numbering walks forward as each disk registers itself in allocatedVolumes.
      const volName = nextFreeDiskName(shellConf, allocatedVolumes, targetVmid)
      // See allocateAndMapBlockVolume for the raw format and why the volume is
      // registered for cleanup before the allocation runs (#587).
      const vol = await allocateAndMapBlockVolume({
        connectionId: config.targetConnectionId, nodeIp,
        targetStorage: config.targetStorage, targetVmid, volName, sizeKB,
        allocatedVolumes,
      })
      const dev = vol.devicePath
      targetDev.set(disk.deviceKey, dev)
      diskState.set(disk.deviceKey, initDiskState(disk.deviceKey))
      // Unwritten regions MUST read as zero: the CBT pass writes only the
      // allocated/changed map, so any block it skips is left as-is on the target.
      // Thin pools (LVM-thin / ZFS / Ceph RBD) hand back pre-zeroed volumes, so a
      // cheap discard suffices. Plain (thick) LVM does NOT — a bare DISCARD only
      // *permits* zero reads, it does not guarantee them, so a freshly-alloc'd
      // thick LV can surface a previous tenant's bytes (a correctness AND
      // information-leak bug). Write-zero those (slow but mandatory); fail hard if
      // it doesn't succeed rather than copy onto stale data.
      const preZeroed = ["lvmthin", "zfspool", "zfs", "rbd"].includes(storageInfo?.type)
      if (preZeroed) {
        await executeSSH(config.targetConnectionId, nodeIp, `blkdiscard ${shellEscape(dev)} 2>/dev/null || true`)
      } else {
        // #606: this step used to be hours of total silence (no start line, no
        // output, status stuck on enabling_cbt) — operators cancelled healthy
        // runs. Announce it, stream the script's aggregated dd progress through
        // the same inactivity guard as the copy, and surface why the blkdiscard
        // offload was refused when the streamed slow path runs.
        const capGB = (disk.capacityBytes / 1073741824).toFixed(1)
        await appendLog(jobId, `Disk ${i}: zeroing thick target ${dev} (${capGB} GB) — mandatory on thick storage and can take a long time; live throughput follows`)
        let headBuf = ""              // first KBs of output; carries the refusal marker
        let refusalLogged = false
        let lastFlush = 0
        const onData = (chunk: string): void => {
          if (!refusalLogged && headBuf.length < 8192) {
            headBuf += chunk
            const m = /blkdiscard-refused: ([^\r\n]*)/.exec(headBuf)
            if (m) {
              refusalLogged = true
              void appendLog(jobId, `Disk ${i}: array refused the blkdiscard write-zeroes offload (${m[1].trim() || "no reason given"}) — streaming zeros in ${ZERO_PARALLEL_CHUNKS} parallel ranges instead`, "warn").catch(() => {})
            }
          }
          const p = parseDdProgress(chunk)
          if (!p) return
          const now = Date.now()
          if (now - lastFlush < PROGRESS_LOG_INTERVAL_MS) return
          lastFlush = now
          const diskBytes = Math.min(p.bytes, disk.capacityBytes)
          const pct = Math.max(lastZeroPct, scaleWarmProgress(0, 10, zeroedBytes + diskBytes, zeroTotalBytes))
          lastZeroPct = pct
          // Progress first, then the log line — appendLog stamps each entry with
          // the job's current progress, which is why the lines used to read 0 (#502).
          void (async () => {
            await updateJobLive(jobId, "preparing_disks", { progress: pct, transferSpeed: `Zeroing: ${(p.bytesPerSec / 1048576).toFixed(0)} MB/s` })
            await appendLog(jobId, `Disk ${i}: zeroed ${(diskBytes / 1073741824).toFixed(1)} of ${capGB} GB`)
          })().catch(() => {})
        }
        const z = await executeSSH(config.targetConnectionId, nodeIp, buildThickZeroScript(dev), APPLY_TIMEOUT_MS, { inactivityMs: APPLY_INACTIVITY_MS, onData })
        // Surface z.output first: the script replays the range dd errors to
        // stdout, so the real cause (e.g. "No space left on device", an array
        // I/O error) lands in output while error is just "Exit code N" on the
        // ssh2 path.
        if (!z.success) throw new Error(`Failed to zero thick target ${dev} before warm copy (unwritten regions would expose stale data): ${z.output || z.error}`)
        await appendLog(jobId, `Disk ${i}: zeroed thick target ${dev}`)
      }
      zeroedBytes += disk.capacityBytes
      await appendLog(jobId, `Disk ${i}: target ${vol.volumeId} → ${dev} (${(disk.capacityBytes / 1073741824).toFixed(1)} GB)`)
    }

    // Apply a disk's changed extents to its target. buildApplyScripts splits the
    // dd batch into one or more commands, each bounded so no single command
    // exceeds the OS argument-length limit (see MAX_APPLY_CMD_BYTES) — a large
    // change set in one command was rejected at exec and surfaced as an opaque
    // "EOF" (#445). We run the commands in order and stop on the first failure,
    // so the original abort-on-first-error (`set -e`) semantics hold across the
    // split. `label` distinguishes the delta/full path from the checksum path.
    async function applyExtents(nbdDev: string, dev: string, extents: Extent[], capacityBytes: number, label: string, diskIndex: number, pass: PassProgress): Promise<void> {
      // Live progress: accumulate dd's status=progress counters off the stream —
      // the pass runs one dd per extent, so the raw counter restarts at 0 with
      // every batch and the log read "copying 0.0 GB" for the whole run (#502).
      // The cumulative figure drives the job's progress/bytesTransferred within
      // the pass's window (throttled to one DB write per interval). Also feeds
      // executeSSH's inactivity guard, which resets on every byte — so a moving
      // copy is never cut off and a stalled one fails within APPLY_INACTIVITY_MS
      // instead of hanging to the 12h cap.
      const accumulate = createDdProgressAccumulator()
      let lastFlush = 0
      const onData = (chunk: string): void => {
        const p = accumulate(chunk)
        if (!p) return
        const now = Date.now()
        if (now - lastFlush < PROGRESS_LOG_INTERVAL_MS) return
        lastFlush = now
        const passBytes = Math.min(pass.doneBytes + p.bytes, pass.totalBytes)
        const pct = Math.max(pass.lastPct, scaleWarmProgress(pass.rangeStart, pass.rangeEnd, passBytes, pass.totalBytes))
        pass.lastPct = pct
        // Progress first, then the log line — appendLog stamps each entry with
        // the job's current progress, which is why the lines used to read 0 (#502).
        void (async () => {
          await updateJobLive(jobId, pass.status, { currentStep: pass.currentStep, progress: pct, bytesTransferred: BigInt(passBytes), transferSpeed: `${(p.bytesPerSec / 1048576).toFixed(0)} MB/s` })
          await appendLog(jobId, `Disk ${diskIndex}: copying ${(passBytes / 1073741824).toFixed(1)} GB at ${(p.bytesPerSec / 1048576).toFixed(0)} MB/s`)
        })().catch(() => {})
      }
      for (const script of buildApplyScripts(nbdDev, dev, extents, capacityBytes)) {
        const res = await executeSSH(config.targetConnectionId, nodeIp, script, APPLY_TIMEOUT_MS, { inactivityMs: APPLY_INACTIVITY_MS, onData })
        if (!res.success) throw new Error(`${label} on disk ${diskIndex}: ${res.error || res.output}`)
      }
    }

    // Read one disk of a snapshot through VDDK and apply its extents to the target.
    async function readAndApply(disk: EsxiDiskInfo, diskIndex: number, snapMor: string, extents: Extent[], pass: PassProgress): Promise<number> {
      const bytes = extents.reduce((s, e) => s + e.length, 0)
      if (extents.length === 0) return 0
      const sock = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.sock`
      const pwFile = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.pw`
      const opts: VddkOpts = { sock, libdir, server: esxiHost, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName, snapshot: snapMor }
      const reader = await startVddkReader(config.targetConnectionId, nodeIp, opts, password)
      activeReaders.push(reader)
      try {
        await applyExtents(reader.nbdDev, targetDev.get(disk.deviceKey)!, extents, disk.capacityBytes, "block apply failed", diskIndex, pass)
        return bytes
      } finally {
        await stopVddkReader(config.targetConnectionId, nodeIp, reader).catch(() => {})
        const idx = activeReaders.indexOf(reader)
        if (idx >= 0) activeReaders.splice(idx, 1)
      }
    }

    // Run one CBT pass: snapshot, per-disk query+read+apply, record changeIds, remove the snapshot.
    async function runCbtPass(label: string, baseline: (deviceKey: number) => string, window: PassWindow): Promise<number> {
      const snapMor = await soapCreateSnapshot(soapSession!, config.sourceVmId, `${SNAPSHOT_PREFIX}-${label}`, "warm migration", false)
      if (!snapMor) throw new Error(`CreateSnapshot (${label}) returned no snapshot reference; a snapshot may have been created on the source — verify and remove it manually`)
      ourSnapshots.push(snapMor)
      let bytes = 0
      try {
        // Query every disk's changed areas up front so the pass has its byte
        // denominator before the first dd runs (#502): the sum weights the
        // progress window and is persisted as totalBytes for the transfer
        // readout. bytesTransferred restarts at 0 with each pass, matching it.
        const extentsByDisk = new Map<number, Extent[]>()
        let passTotalBytes = 0
        for (const disk of vmConfig.disks) {
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          const extents = await queryAllChangedAreas(soapSession!, config.sourceVmId, snapMor, disk.deviceKey, baseline(disk.deviceKey), disk.capacityBytes)
          extentsByDisk.set(disk.deviceKey, extents)
          passTotalBytes += extents.reduce((s, e) => s + e.length, 0)
        }
        const pass: PassProgress = { ...window, totalBytes: passTotalBytes, doneBytes: 0, lastPct: Math.round(window.rangeStart) }
        await updateJob(jobId, window.status, { currentStep: window.currentStep, progress: pass.lastPct, totalBytes: BigInt(passTotalBytes), bytesTransferred: BigInt(0) })
        for (let i = 0; i < vmConfig.disks.length; i++) {
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          const disk = vmConfig.disks[i]
          bytes += await readAndApply(disk, i, snapMor, extentsByDisk.get(disk.deviceKey)!, pass)
          // Correct the estimate with the disk's exact extent total: the dd
          // accumulator is conservative (see createDdProgressAccumulator).
          pass.doneBytes = bytes
        }
        // Record this snapshot's per-disk changeId as the next pass's baseline.
        const cids = await soapGetSnapshotChangeIds(soapSession!, snapMor)
        for (const disk of vmConfig.disks) {
          const cid = cids.get(disk.deviceKey) || ""
          // An empty changeId means the next pass falls back to "*" (full allocated
          // re-read) for this disk — correct but wasteful; surface it rather than
          // silently inflating the next delta.
          if (!cid) await appendLog(jobId, `Warning: no changeId captured for disk ${disk.deviceKey} after ${label}; the next pass will re-read its full allocated map`, "warn")
          diskState.set(disk.deviceKey, recordPass(diskState.get(disk.deviceKey)!, { newChangeId: cid, bytes: 0 }))
        }
      } finally {
        // Always remove OUR snapshot, by its specific MOR, never the children (a
        // user snapshot taken under ours must survive — section 11).
        await soapRemoveSnapshot(soapSession!, snapMor, false).catch(async () => {
          await appendLog(jobId, `Warning: could not remove warm snapshot ${snapMor}; remove it manually`, "warn")
        })
        const k = ourSnapshots.indexOf(snapMor)
        if (k >= 0) ourSnapshots.splice(k, 1)
      }
      return bytes
    }

    if (useCbt) {
      // ── full_copy: pass 0 with the "*" baseline (10→80 on the locked scale) ──
      await updateJob(jobId, "full_copy", { progress: 10 })
      await appendLog(jobId, "Full copy (CBT allocated map)…")
      const t0 = Date.now()
      const fullBytes = await runCbtPass("full", () => "*", { status: "full_copy", currentStep: "full_copy", rangeStart: 10, rangeEnd: 80 })
      // The full pass applied a VMware-snapshot-consistent image of every disk:
      // from this point the target holds a bootable point-in-time copy worth hours
      // of transfer, so failure cleanup must keep these volumes, not free them (#612).
      markVolumesCopied(allocatedVolumes)
      const fullSec = Math.max(1, (Date.now() - t0) / 1000)
      let throughput = fullBytes / fullSec
      await updateJob(jobId, "full_copy", { progress: 80, bytesTransferred: BigInt(fullBytes), transferSpeed: `${(throughput / 1048576).toFixed(0)} MB/s` })
      await appendLog(jobId, `Full copy done: ${(fullBytes / 1073741824).toFixed(2)} GB at ${(throughput / 1048576).toFixed(0)} MB/s`, "success")

      // ── delta_sync: converge by downtime budget ──
      const cfg: ConvergenceConfig = { downtimeBudgetSec: budget, maxPasses, shutdownSec: 20, bootSec: 30 }
      let pass = 0
      while (true) {
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
        if (isCutoverRequested(jobId)) { await appendLog(jobId, "Operator requested cutover — proceeding to final delta", "info"); break }
        const tk = Date.now()
        await updateJob(jobId, "delta_sync", { currentStep: `delta_${pass + 1}` })
        // Each delta pass advances through an equal slice of the 80→95 delta
        // window; a run that converges before maxPasses jumps to 95 at cutover.
        const deltaWindow: PassWindow = {
          status: "delta_sync", currentStep: `delta_${pass + 1}`,
          rangeStart: 80 + (15 * pass) / maxPasses, rangeEnd: 80 + (15 * (pass + 1)) / maxPasses,
        }
        const deltaBytes = await runCbtPass(`delta-${pass + 1}`, dk => diskState.get(dk)!.currentChangeId || "*", deltaWindow)
        const dsec = Math.max(1, (Date.now() - tk) / 1000)
        throughput = deltaBytes > 0 ? deltaBytes / dsec : throughput
        await appendLog(jobId, `Delta pass ${pass + 1}: ${(deltaBytes / 1048576).toFixed(1)} MB`)
        const decision = decideNextPass(pass, { deltaBytes, throughputBytesPerSec: throughput }, cfg)
        await updateJob(jobId, "delta_sync", { currentStep: `delta_${pass + 1}`, projectedDowntimeSec: decision.projectedDowntimeSec, progress: Math.round(deltaWindow.rangeEnd) })
        if (decision.action === "cutover") break
        if (decision.action === "operator-gate") {
          await awaitOperatorCutover(jobId, decision.projectedDowntimeSec, budget, maxPasses)
          break
        }
        pass++
      }

      // ── cutover: confirmed power-off → final delta → verify → attach → boot ──
      await updateJob(jobId, "cutover", { progress: 95 })
      await cleanShutdownAndConfirm(jobId, soapSession!, config.sourceVmId)
      await appendLog(jobId, "Source powered off (confirmed) — applying final delta", "success")
      await runCbtPass("cutover", dk => diskState.get(dk)!.currentChangeId || "*", { status: "cutover", currentStep: "cutover", rangeStart: 95, rangeEnd: 98 })
    } else {
      // ── checksum fallback: stop source, full block-diff vs the (zeroed) target ──
      await updateJob(jobId, "cutover")
      await cleanShutdownAndConfirm(jobId, soapSession!, config.sourceVmId)
      await updateJob(jobId, "full_copy", { progress: 10 })
      const snapMor = await soapCreateSnapshot(soapSession!, config.sourceVmId, `${SNAPSHOT_PREFIX}-checksum`, "warm migration", false)
      if (!snapMor) throw new Error("CreateSnapshot (checksum) returned no snapshot reference; a snapshot may have been created on the source — verify and remove it manually")
      ourSnapshots.push(snapMor)
      try {
        for (let i = 0; i < vmConfig.disks.length; i++) {
          const disk = vmConfig.disks[i]
          const sock = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.sock`
          const pwFile = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.pw`
          const opts: VddkOpts = { sock, libdir, server: esxiHost, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName, snapshot: snapMor }
          const reader = await startVddkReader(config.targetConnectionId, nodeIp, opts, password)
          activeReaders.push(reader)
          try {
            const dev = targetDev.get(disk.deviceKey)!
            const extents = await detectChangedExtentsByChecksum(config.targetConnectionId, nodeIp, reader.nbdDev, dev, 256 * 1024 * 1024, disk.capacityBytes)
            // Per-disk progress window: unlike runCbtPass there is no upfront
            // all-disk denominator here (the checksum scan needs each disk's
            // reader), so each disk gets an equal slice of the 10→80 window.
            const span = 70 / vmConfig.disks.length
            await applyExtents(reader.nbdDev, dev, extents, disk.capacityBytes, "checksum apply failed", i, {
              status: "full_copy", currentStep: "full_copy",
              rangeStart: 10 + span * i, rangeEnd: 10 + span * (i + 1),
              totalBytes: extents.reduce((s, e) => s + e.length, 0), doneBytes: 0,
              lastPct: Math.round(10 + span * i),
            })
          } finally {
            await stopVddkReader(config.targetConnectionId, nodeIp, reader).catch(() => {})
            const idx = activeReaders.indexOf(reader)
            if (idx >= 0) activeReaders.splice(idx, 1)
          }
        }
        // Every disk has been fully applied against the checksum snapshot: the
        // target now holds a consistent bootable image, so failure cleanup must
        // keep these volumes, not free them (#612). Only reached when ALL disks
        // completed; a failure mid loop leaves the volumes unmarked and freeable.
        markVolumesCopied(allocatedVolumes)
      } finally {
        await soapRemoveSnapshot(soapSession!, snapMor, false).catch(() => {})
        const k = ourSnapshots.indexOf(snapMor)
        if (k >= 0) ourSnapshots.splice(k, 1)
      }
    }

    // ── verify (sampled, defense-in-depth) ──
    // The no-loss property is algorithmic (CBT + post-shutdown final delta), not a
    // product of this check. We sample the first block of each disk: the source is
    // now powered off, so its current disk == the cutover state (no snapshot param).
    // A mismatch is a loud warning, never a hard failure; the authoritative full
    // cmp is the lab runbook.
    await updateJob(jobId, "verify", { progress: 98 })
    for (let i = 0; i < vmConfig.disks.length; i++) {
      const disk = vmConfig.disks[i]
      const dev = targetDev.get(disk.deviceKey)!
      const sock = `/tmp/proxcenter-vddk-${jobId}-vrfy-${disk.deviceKey}.sock`
      const pwFile = `/tmp/proxcenter-vddk-${jobId}-vrfy-${disk.deviceKey}.pw`
      try {
        const reader = await startVddkReader(config.targetConnectionId, nodeIp,
          { sock, libdir, server: esxiHost, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName }, password)
        try {
          const [src, dst] = await Promise.all([
            scanBlockChecksums(config.targetConnectionId, nodeIp, reader.nbdDev, 256 * 1024 * 1024, 1),
            scanBlockChecksums(config.targetConnectionId, nodeIp, dev, 256 * 1024 * 1024, 1),
          ])
          if (src[0] && dst[0] && src[0] !== dst[0]) {
            await appendLog(jobId, `Verify: disk ${i} first-block checksum differs (source vs target) — investigate before relying on the copy`, "warn")
          } else {
            await appendLog(jobId, `Verify: disk ${i} sampled block matches`, "success")
          }
        } finally {
          await stopVddkReader(config.targetConnectionId, nodeIp, reader).catch(() => {})
        }
      } catch (e: any) {
        await appendLog(jobId, `Verify (sampled) skipped on disk ${i}: ${e?.message || e}`, "warn")
      }
    }
    await appendLog(jobId, "Attaching target disks…")

    const reconfig = new URLSearchParams()
    const slots: string[] = []
    for (let i = 0; i < vmConfig.disks.length; i++) {
      const slot = i === 0 ? pveParams.bootDiskSlot : `scsi${i}`
      slots.push(slot)
      reconfig.set(slot, allocatedVolumes[i].volumeId)
    }
    reconfig.set("boot", `order=${slots[0]}`)
    try {
      await pveSetVmConfig(pveConn as any, config.targetNode, targetVmid, reconfig)
    } catch (e: any) {
      // Attach is fatal at cutover (section 8): do NOT start a VM with unattached disks.
      throw new Error(`FATAL: could not attach target disks at cutover: ${e?.message || e}`)
    }
    for (const v of allocatedVolumes) v.attached = true
    await appendLog(jobId, `Attached ${vmConfig.disks.length} disk(s); boot order ${slots[0]}`, "success")

    if (config.startAfterMigration) {
      await pveFetch<any>(pveConn as any, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/status/start`, { method: "POST" })
      await appendLog(jobId, "Target VM started", "success")
    }

    // Post-cutover qcow2 conversion (#595): runs after the disks are attached
    // and after the optional start — on a running VM PVE does move_disk as a
    // live drive-mirror, no extra downtime. The helper gates itself (opt-in,
    // storage default format, free space) and NEVER throws: a conversion
    // problem leaves the disks raw, not the migration failed.
    await convertDisksToQcow2({
      enabled: config.convertDisksToQcow2 === true,
      conn: pveConn as any, node: config.targetNode, vmid: targetVmid,
      targetStorage: config.targetStorage, volumes: allocatedVolumes,
      log: (m, l) => appendLog(jobId, m, l),
      setPhase: p => updateJob(jobId, "converting_disks", { progress: p }),
    })

    await updateJob(jobId, "completed", { progress: 100 })
    // Non-fatal: a failing log append after the terminal write must not throw
    // us into the catch, which would flip a completed job to "failed" (#608).
    await appendLog(jobId, "Warm migration complete", "success").catch(() => {})
  } catch (err: any) {
    // Terminal status first, and nothing may prevent it — a row left
    // non-terminal here would show as "in progress" forever (#608).
    await updateJob(jobId, isCancelled(jobId) ? "cancelled" : "failed", { error: String(err?.message || err) }).catch(() => {})
    await appendLog(jobId, `Warm migration failed: ${err?.message || err}`, "error").catch(() => {})
    // Best-effort cleanup: stop readers, remove OUR snapshots (specific MOR), free orphan volumes.
    await cleanupOnFailure(jobId, config, soapSession, ourSnapshots, allocatedVolumes, activeReaders, nodeIp).catch(() => {})
    throw err
  } finally {
    stopHeartbeat()
    stopKeepAlive?.()
    if (soapSession) await soapLogout(soapSession).catch(() => {})
    jobPrisma.delete(jobId)
    cancelledJobs.delete(jobId)
    cutoverRequests.delete(jobId)
    if (acquiredVmLock) activeWarmVms.delete(vmKey)
  }
}

/**
 * Clean guest shutdown then CONFIRM the source is powered off. Mandatory for a
 * valid final delta (section 9): a delta taken while the guest still writes is
 * invalid, so there is no proceed-anyway. Aborts if the source never stops.
 */
async function cleanShutdownAndConfirm(jobId: string, session: SoapSession, vmid: string): Promise<void> {
  await appendLog(jobId, "Cutover: requesting clean guest shutdown (VMware Tools)…")
  await soapGuestShutdown(session, vmid).catch(async (e: any) => {
    await appendLog(jobId, `Guest shutdown could not be initiated (${e?.message || e}); waiting for manual/hard power-off`, "warn")
  })
  const off = await soapWaitPoweredOff(session, vmid, 300000)
  // Careful with the wording: the CBT path reaches this AFTER the full copy, so a
  // completed copy is kept, but the checksum fallback shuts the source down BEFORE
  // copying anything, and those unmarked volumes are still freed. State the rule,
  // never promise a copy that may not exist (#612).
  if (!off) throw new Error("Cutover aborted: source VM did not reach a confirmed powered-off state (no final delta taken; any target volume holding a completed copy is kept, not deleted)")
}

/**
 * Mark every allocated volume as holding a completed, snapshot-consistent copy of
 * its source disk. Called only once a copy pass has finished for ALL disks (the
 * CBT full pass, or the checksum fallback after its last disk): each pass applies
 * a VMware-snapshot-consistent image, so a completed pass leaves the target
 * bootable, and `volumesToFree` then keeps it out of failure cleanup (#612). A run
 * that fails mid pass never reaches this, so a half-written target is still freed.
 */
export function markVolumesCopied(allocatedVolumes: AllocatedVolume[]): void {
  for (const v of allocatedVolumes) v.copied = true
}

/**
 * Failure cleanup: stop readers, remove our snapshots by specific MOR, free orphan
 * target volumes, and log (under `jobId`) each copied volume deliberately kept so
 * the operator knows what survived and where.
 */
async function cleanupOnFailure(
  jobId: string,
  config: WarmMigrationConfig,
  session: SoapSession | null,
  ourSnapshots: string[],
  allocatedVolumes: AllocatedVolume[],
  activeReaders: VddkReaderHandle[],
  nodeIp: string,
): Promise<void> {
  // nodeIp is the value resolved during planning (empty if we failed before that,
  // in which case nothing was allocated on the node and there is nothing to free).
  for (const r of activeReaders) {
    if (nodeIp) await stopVddkReader(config.targetConnectionId, nodeIp, r).catch(() => {})
  }
  if (session) {
    for (const mor of [...ourSnapshots]) await soapRemoveSnapshot(session, mor, false).catch(() => {})
  }
  // Unmap RBD + free volumes the VM never referenced (orphans). volumesToFree also
  // covers a volume created by an allocation that reported a failure, and skips the
  // slots whose allocation never started.
  for (const v of volumesToFree(allocatedVolumes)) {
    if (nodeIp && v.rbdMapped && v.devicePath) await executeSSH(config.targetConnectionId, nodeIp, `rbd unmap "${v.devicePath}" 2>/dev/null`).catch(() => {})
    // A `saferemove` LVM storage zeroes the volume before removing it, which takes
    // far longer than the 30 s executeSSH default.
    if (nodeIp) await executeSSH(config.targetConnectionId, nodeIp, `pvesm free ${shellEscape(v.volumeId)} 2>/dev/null`, PVESM_FREE_TIMEOUT_MS).catch(() => {})
  }
  // Volumes holding a completed copy are deliberately NOT freed: the copy is
  // bootable and worth hours of transfer, and deleting it on a post-copy failure
  // is what destroyed 3.4 TB on a customer cluster (#612). Say so in the job log,
  // one line per volume, so nothing silently lingers on the storage.
  for (const v of volumesToKeep(allocatedVolumes)) {
    await appendLog(jobId, `Kept target volume ${v.volumeId}: it holds a completed copy of the source disk. Remove it manually from the storage if you do not want it.`, "warn").catch(() => {})
  }
}
