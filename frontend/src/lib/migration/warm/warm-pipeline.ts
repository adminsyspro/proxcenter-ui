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
import { allocateBlockVolumeAndResolvePath } from "../pvesm-alloc"
import { pveSetVmConfig } from "../pve-vm-config"
import { waitForPveTask, getNodeIpForMigration } from "../pve-tasks"
import { decideNextPass, type PassStat, type ConvergenceConfig, type ConvergenceDecision } from "./convergence"
import { initDiskState, recordPass, type DiskWarmState } from "./state"
import { startVddkReader, stopVddkReader, type VddkReaderHandle } from "./vddk-reader"
import type { VddkOpts } from "./vddk-cmd"
import { buildApplyScript } from "./block-applier"
import { detectChangedExtentsByChecksum, scanBlockChecksums } from "./checksum-detector"
import { checkVddkPreflight } from "./vddk-preflight"
import { parseSha1Thumbprint } from "./thumbprint"
import type { Extent } from "./extents"
import { startSoapKeepAlive } from "./session-keepalive"

export type WarmStatus =
  | "pending" | "planning" | "enabling_cbt" | "full_copy" | "delta_sync"
  | "cutover" | "verify" | "completed" | "failed" | "cancelled"

export interface WarmMigrationConfig {
  sourceConnectionId: string
  sourceVmId: string
  targetConnectionId: string
  targetNode: string
  targetStorage: string
  networkBridge: string
  vlanTag?: number
  startAfterMigration: boolean
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
const jobPrisma = new Map<string, any>()
// At most one warm job per source VM in-flight. Concurrent warm runs against the
// same VM would interleave snapshots and dd-seek writes (target corruption), so a
// second run for a VM already migrating is rejected (design §12 concurrency lock).
const activeWarmVms = new Set<string>()

/** Cooperative cancel signal for a warm job (called by the cancel route). */
export function cancelWarmMigrationJob(jobId: string) { cancelledJobs.add(jobId) }
function isCancelled(jobId: string): boolean { return cancelledJobs.has(jobId) }

async function updateJob(id: string, status: WarmStatus, extra: Record<string, any> = {}) {
  const prisma = jobPrisma.get(id)
  await prisma.migrationJob.update({
    where: { id },
    data: { status, currentStep: status, ...(status === "completed" ? { completedAt: new Date() } : {}), ...extra },
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
const SNAPSHOT_PREFIX = "proxcenter-warm"
// Ping the SOAP session every 60 s to prevent idle-expiry during long dd copies (issue #394).
const SOAP_KEEPALIVE_INTERVAL_MS = 60_000

/**
 * Build the node-side command that zeroes a freshly-allocated *thick* block
 * device before the CBT copy. Unwritten regions on a thick LV are not
 * guaranteed to read as zero, and the CBT pass only writes the allocated/changed
 * map, so any gap left un-zeroed would surface a previous tenant's bytes (a
 * correctness AND information-leak bug). We prefer `blkdiscard -z` (offloaded
 * write-zeroes where the array supports it) and fall back to streaming zeros.
 *
 * The fallback streams `head -c <size> /dev/zero | dd …` rather than the earlier
 * `dd if=/dev/zero of=DEV` (no count): a bare unbounded dd fills the device and
 * then issues one write *past* end-of-device, which returns ENOSPC and makes dd
 * exit 1 — even though every block was already zeroed — so the thick-zero step
 * could never succeed (this is what broke #445's disk 1 after a full 45-min
 * zero). Bounding the stream to `blockdev --getsize64` writes exactly the device
 * and exits 0. `iflag=fullblock` reassembles 4 MiB blocks across the pipe so
 * O_DIRECT accepts every write, including a sub-4 MiB final block (still
 * logical-block aligned because a device size is always a sector multiple).
 */
export function buildThickZeroScript(dev: string): string {
  const d = shellEscape(dev)
  return `sz=$(blockdev --getsize64 ${d}); blkdiscard -z ${d} 2>&1 || head -c "$sz" /dev/zero | dd of=${d} bs=4M iflag=fullblock oflag=direct status=none 2>&1`
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
  const allocatedVolumes: { volumeId: string; devicePath: string; rbdMapped?: boolean; attached?: boolean }[] = []
  const activeReaders: VddkReaderHandle[] = []      // readers to tear down on failure
  // Per-disk: target device path + CBT state. NOTE: state is in-memory only; a
  // retry re-runs from a fresh full pass (safe, full re-copy) rather than resuming
  // mid-stream. Persisted/resumable per-disk state (design §5.3/§12) is deferred.
  const targetDev = new Map<number, string>()
  const diskState = new Map<number, DiskWarmState>()

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
    // (vm-<vmid>-disk-0) created with `qm create`. Data disks must therefore
    // start after the highest existing disk number, or `pvesm alloc` collides on
    // the name (mirrors the cold pipeline's allocateBlockVolume).
    const shellConf = await pveFetch<Record<string, any>>(pveConn as any, `/nodes/${encodeURIComponent(config.targetNode)}/qemu/${targetVmid}/config`)
    let nextDiskNum = 0
    for (const v of Object.values(shellConf || {})) {
      if (typeof v === "string") {
        const m = v.match(/vm-\d+-disk-(\d+)/)
        if (m) nextDiskNum = Math.max(nextDiskNum, Number(m[1]) + 1)
      }
    }

    // Allocate a raw block volume per disk and resolve (+ map) its device path.
    for (let i = 0; i < vmConfig.disks.length; i++) {
      const disk = vmConfig.disks[i]
      const sizeKB = Math.ceil(disk.capacityBytes / 1024)
      const volName = `vm-${targetVmid}-disk-${nextDiskNum + i}`
      const alloc = await allocateBlockVolumeAndResolvePath(config.targetConnectionId, nodeIp, config.targetStorage, targetVmid, volName, sizeKB)
      const dev = await mapRbdIfNeeded(config.targetConnectionId, nodeIp, alloc.devicePath, allocatedVolumes, alloc.volumeId)
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
        const z = await executeSSH(config.targetConnectionId, nodeIp, buildThickZeroScript(dev), APPLY_TIMEOUT_MS)
        // Surface z.output first: the script merges stderr into stdout (2>&1), so
        // the real cause (e.g. "No space left on device", an array I/O error)
        // lands in output while error is just "Exit code N" on the ssh2 path.
        if (!z.success) throw new Error(`Failed to zero thick target ${dev} before warm copy (unwritten regions would expose stale data): ${z.output || z.error}`)
        await appendLog(jobId, `Disk ${i}: zeroed thick target ${dev}`)
      }
      await appendLog(jobId, `Disk ${i}: target ${alloc.volumeId} → ${dev} (${(disk.capacityBytes / 1073741824).toFixed(1)} GB)`)
    }

    // Read one disk of a snapshot through VDDK and apply its extents to the target.
    async function readAndApply(disk: EsxiDiskInfo, diskIndex: number, snapMor: string, extents: Extent[]): Promise<number> {
      const bytes = extents.reduce((s, e) => s + e.length, 0)
      if (extents.length === 0) return 0
      const sock = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.sock`
      const pwFile = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.pw`
      const nbdDev = `/dev/nbd${diskIndex}`
      const opts: VddkOpts = { sock, libdir, server: esxiHost, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName, snapshot: snapMor }
      const reader = await startVddkReader(config.targetConnectionId, nodeIp, opts, password, nbdDev)
      activeReaders.push(reader)
      try {
        const script = buildApplyScript(reader.nbdDev, targetDev.get(disk.deviceKey)!, extents, disk.capacityBytes)
        const res = await executeSSH(config.targetConnectionId, nodeIp, script, APPLY_TIMEOUT_MS)
        if (!res.success) throw new Error(`block apply failed on disk ${diskIndex}: ${res.error || res.output}`)
        return bytes
      } finally {
        await stopVddkReader(config.targetConnectionId, nodeIp, reader).catch(() => {})
        const idx = activeReaders.indexOf(reader)
        if (idx >= 0) activeReaders.splice(idx, 1)
      }
    }

    // Run one CBT pass: snapshot, per-disk query+read+apply, record changeIds, remove the snapshot.
    async function runCbtPass(label: string, baseline: (deviceKey: number) => string): Promise<number> {
      const snapMor = await soapCreateSnapshot(soapSession!, config.sourceVmId, `${SNAPSHOT_PREFIX}-${label}`, "warm migration", false)
      if (!snapMor) throw new Error(`CreateSnapshot (${label}) returned no snapshot reference; a snapshot may have been created on the source — verify and remove it manually`)
      ourSnapshots.push(snapMor)
      let bytes = 0
      try {
        for (let i = 0; i < vmConfig.disks.length; i++) {
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          const disk = vmConfig.disks[i]
          const extents = await queryAllChangedAreas(soapSession!, config.sourceVmId, snapMor, disk.deviceKey, baseline(disk.deviceKey), disk.capacityBytes)
          bytes += await readAndApply(disk, i, snapMor, extents)
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
      // ── full_copy: pass 0 with the "*" baseline ──
      await updateJob(jobId, "full_copy", { progress: 0 })
      await appendLog(jobId, "Full copy (CBT allocated map)…")
      const t0 = Date.now()
      const fullBytes = await runCbtPass("full", () => "*")
      const fullSec = Math.max(1, (Date.now() - t0) / 1000)
      let throughput = fullBytes / fullSec
      await appendLog(jobId, `Full copy done: ${(fullBytes / 1073741824).toFixed(2)} GB at ${(throughput / 1048576).toFixed(0)} MB/s`, "success")

      // ── delta_sync: converge by downtime budget ──
      const cfg: ConvergenceConfig = { downtimeBudgetSec: budget, maxPasses, shutdownSec: 20, bootSec: 30 }
      let pass = 0
      while (true) {
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
        const tk = Date.now()
        await updateJob(jobId, "delta_sync", { currentStep: `delta_${pass + 1}` })
        const deltaBytes = await runCbtPass(`delta-${pass + 1}`, dk => diskState.get(dk)!.currentChangeId || "*")
        const dsec = Math.max(1, (Date.now() - tk) / 1000)
        throughput = deltaBytes > 0 ? deltaBytes / dsec : throughput
        await appendLog(jobId, `Delta pass ${pass + 1}: ${(deltaBytes / 1048576).toFixed(1)} MB`)
        const decision = decideNextPass(pass, { deltaBytes, throughputBytesPerSec: throughput }, cfg)
        if (decision.action === "cutover") break
        if (decision.action === "operator-gate") {
          await updateJob(jobId, "delta_sync", { currentStep: "operator_gate", operatorGateDowntimeSec: decision.projectedDowntimeSec })
          await appendLog(jobId, `Reached ${maxPasses} passes; projected cutover downtime ${decision.projectedDowntimeSec}s exceeds the ${budget}s budget. Operator decision required (accept longer cutover or abort).`, "warn")
          throw new Error(`Warm migration paused at operator gate: projected downtime ${decision.projectedDowntimeSec}s > budget ${budget}s`)
        }
        pass++
      }

      // ── cutover: confirmed power-off → final delta → verify → attach → boot ──
      await updateJob(jobId, "cutover")
      await cleanShutdownAndConfirm(jobId, soapSession!, config.sourceVmId)
      await appendLog(jobId, "Source powered off (confirmed) — applying final delta", "success")
      await runCbtPass("cutover", dk => diskState.get(dk)!.currentChangeId || "*")
    } else {
      // ── checksum fallback: stop source, full block-diff vs the (zeroed) target ──
      await updateJob(jobId, "cutover")
      await cleanShutdownAndConfirm(jobId, soapSession!, config.sourceVmId)
      await updateJob(jobId, "full_copy")
      const snapMor = await soapCreateSnapshot(soapSession!, config.sourceVmId, `${SNAPSHOT_PREFIX}-checksum`, "warm migration", false)
      if (!snapMor) throw new Error("CreateSnapshot (checksum) returned no snapshot reference; a snapshot may have been created on the source — verify and remove it manually")
      ourSnapshots.push(snapMor)
      try {
        for (let i = 0; i < vmConfig.disks.length; i++) {
          const disk = vmConfig.disks[i]
          const sock = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.sock`
          const pwFile = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.pw`
          const nbdDev = `/dev/nbd${i}`
          const opts: VddkOpts = { sock, libdir, server: esxiHost, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName, snapshot: snapMor }
          const reader = await startVddkReader(config.targetConnectionId, nodeIp, opts, password, nbdDev)
          activeReaders.push(reader)
          try {
            const dev = targetDev.get(disk.deviceKey)!
            const extents = await detectChangedExtentsByChecksum(config.targetConnectionId, nodeIp, reader.nbdDev, dev, 256 * 1024 * 1024, disk.capacityBytes)
            const script = buildApplyScript(reader.nbdDev, dev, extents, disk.capacityBytes)
            const res = await executeSSH(config.targetConnectionId, nodeIp, script, APPLY_TIMEOUT_MS)
            if (!res.success) throw new Error(`checksum apply failed on disk ${i}: ${res.error || res.output}`)
          } finally {
            await stopVddkReader(config.targetConnectionId, nodeIp, reader).catch(() => {})
            const idx = activeReaders.indexOf(reader)
            if (idx >= 0) activeReaders.splice(idx, 1)
          }
        }
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
    await updateJob(jobId, "verify")
    for (let i = 0; i < vmConfig.disks.length; i++) {
      const disk = vmConfig.disks[i]
      const dev = targetDev.get(disk.deviceKey)!
      const sock = `/tmp/proxcenter-vddk-${jobId}-vrfy-${disk.deviceKey}.sock`
      const pwFile = `/tmp/proxcenter-vddk-${jobId}-vrfy-${disk.deviceKey}.pw`
      try {
        const reader = await startVddkReader(config.targetConnectionId, nodeIp,
          { sock, libdir, server: esxiHost, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName }, password, `/dev/nbd${i}`)
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
      const slot = pveParams.bios === "ovmf" && i === 0 ? "sata0" : `scsi${i}`
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

    await updateJob(jobId, "completed", { progress: 100 })
    await appendLog(jobId, "Warm migration complete", "success")
  } catch (err: any) {
    await appendLog(jobId, `Warm migration failed: ${err?.message || err}`, "error").catch(() => {})
    await updateJob(jobId, isCancelled(jobId) ? "cancelled" : "failed", { error: String(err?.message || err) }).catch(() => {})
    // Best-effort cleanup: stop readers, remove OUR snapshots (specific MOR), free orphan volumes.
    await cleanupOnFailure(config, soapSession, ourSnapshots, allocatedVolumes, activeReaders, nodeIp).catch(() => {})
    throw err
  } finally {
    stopKeepAlive?.()
    if (soapSession) await soapLogout(soapSession).catch(() => {})
    jobPrisma.delete(jobId)
    cancelledJobs.delete(jobId)
    if (acquiredVmLock) activeWarmVms.delete(vmKey)
  }
}

/** Map an RBD/Ceph volume to a kernel device if pvesm returned an rbd: spec or KRBD symlink. */
async function mapRbdIfNeeded(
  connId: string, nodeIp: string, devicePath: string,
  allocatedVolumes: { volumeId: string; devicePath: string; rbdMapped?: boolean; attached?: boolean }[], volumeId: string,
): Promise<string> {
  let dev = devicePath
  let rbdMapped = false
  const krbd = devicePath.match(/^\/dev\/rbd-pve\/[^/]+\/([^/]+)\/([^/]+)$/)
  if (devicePath.startsWith("rbd:")) {
    const spec = devicePath.split(":")[1]
    if (!spec) throw new Error(`Cannot parse RBD path: ${devicePath}`)
    const r = await executeSSH(connId, nodeIp, `rbd map "${spec}" 2>&1`)
    if (!r.success || !r.output?.trim()) throw new Error(`Failed to rbd map ${spec}: ${r.error || r.output}`)
    dev = r.output.trim(); rbdMapped = true
  } else if (krbd) {
    const spec = `${krbd[1]}/${krbd[2]}`
    const r = await executeSSH(connId, nodeIp, `rbd device map "${spec}" 2>&1`)
    if (!r.success) throw new Error(`Failed to rbd device map ${spec}: ${r.error || r.output}`)
    rbdMapped = true
  }
  allocatedVolumes.push({ volumeId, devicePath: dev, rbdMapped })
  return dev
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
  if (!off) throw new Error("Cutover aborted: source VM did not reach a confirmed powered-off state (no final delta taken; target left untouched)")
}

/** Failure cleanup: stop readers, remove our snapshots by specific MOR, free orphan target volumes. */
async function cleanupOnFailure(
  config: WarmMigrationConfig,
  session: SoapSession | null,
  ourSnapshots: string[],
  allocatedVolumes: { volumeId: string; devicePath: string; rbdMapped?: boolean; attached?: boolean }[],
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
  // Unmap RBD + free volumes the VM never referenced (orphans).
  for (const v of allocatedVolumes.filter(v => !v.attached)) {
    if (nodeIp && v.rbdMapped) await executeSSH(config.targetConnectionId, nodeIp, `rbd unmap "${v.devicePath}" 2>/dev/null`).catch(() => {})
    if (nodeIp) await executeSSH(config.targetConnectionId, nodeIp, `pvesm free ${shellEscape(v.volumeId)} 2>/dev/null`).catch(() => {})
  }
}
