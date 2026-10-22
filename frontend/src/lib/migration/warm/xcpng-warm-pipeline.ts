import { getTenantPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { reserveTargetVmid } from "../reserve-target-vmid"
import { releaseVmids } from "../vmid-reservation"
import { isFileBasedStorage } from "@/lib/proxmox/storage"
import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import {
  xapiLogin, xapiLogout, xapiKeepAlive, xapiGetVmConfig, xapiVmRefByUuid, xapiNbdEnabled, xapiManagementNetworkUuid,
  xapiEnableCbt, xapiDisableCbt, xapiSnapshotVm, xapiGetNbdInfo, xapiListChangedBlocks, xapiDestroySnapshot,
  xapiFindSnapshotsByPrefix, xapiCleanShutdown, xapiHardShutdown, xapiPowerState, CBT_CAPABLE_SR_TYPES,
  type XapiSession, type XapiSnapshot,
} from "@/lib/xcpng/xapi-client"
import type { XoVmConfig, XoDiskInfo } from "@/lib/xcpng/client"
import { splitCreds, xcpngSubTypeOf } from "@/lib/xcpng/source"
import { isWindowsXoVm, mapXoToPveConfig } from "../xcpngConfigMapper"
import { virtioDevices } from "../configMapper"
import { volumesToFree, volumesToKeep, PVESM_FREE_TIMEOUT_MS, type AllocatedVolume } from "../pvesm-alloc"
import { getNodeSshEndpointForMigration } from "../pve-tasks"
import { startJobHeartbeat } from "../job-heartbeat"
import { decideNextPass, type ConvergenceConfig } from "./convergence"
import { detectChangedExtentsByChecksum } from "./checksum-detector"
import type { Extent } from "./extents"
import type { WarmMigrationConfig } from "./types"
import {
  registerJob, unregisterJob, acquireVmLock, releaseVmLock, updateJob, updateJobLive, appendLog, appendStep, readJobConfig,
  isCancelled, isCutoverRequested, sleepUnlessCutover, awaitOperatorCutover, runDeltaPassWithRetry, HOLD_PASS_INTERVAL_MS,
} from "./job-control"
import {
  applyExtentsWithProgress, checksumDiskWindows, scaleWarmProgress, warmFinalTransfer, APPLY_INACTIVITY_MS, PROGRESS_LOG_INTERVAL_MS,
  type PassWindow, type PassProgress,
} from "./apply"
import { createTargetVmShell, provisionBlockTargets, markVolumesCopied } from "./target-provision"
import { resolveWarmZeroRateLimit } from "./zero-rate-target"
import { sweepOrphanReaders } from "./orphan-readers"
import { cleanShutdownAndConfirm, isXapiGuestAgentMissing, type PowerOffOps } from "./power-off"
import { attachDisksAndBoot, removeTargetVmOnFailure, unmapTargetVolumes, verifySampledFirstBlock } from "./finish"
import { startXapiReader, stopXapiReader, readAllocatedExtents, type XapiReaderHandle } from "./xapi-reader"
import { checkNbdNodePreflight } from "./xcpng-node-preflight"
import { startSessionKeepAlive } from "./session-keepalive"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"
import { conversionNotAppliedMessage, convertGuestAtCutover, GUEST_CONVERSION_ESTIMATE_SEC } from "./guest-conversion"
import { guestNicsFromNets } from "./guest-network"

export const XCPNG_SNAPSHOT_PREFIX = "proxcenter-warm"
// XAPI sessions expire after 24 h of inactivity by default; ping well within that.
const KEEPALIVE_MS = 5 * 60_000
const POWER_POLL_MS = 5000

/** CBT needs VHD based SRs; raw VDIs and SMAPIv3 SRs fall back to the checksum path. */
export function cbtEligibilityXcpng(disks: XoDiskInfo[]): { eligible: boolean; reason?: string } {
  for (const d of disks) {
    if (!d.srType) return { eligible: false, reason: `SR type unknown for disk "${d.label}"` }
    if (!CBT_CAPABLE_SR_TYPES.has(d.srType)) return { eligible: false, reason: `SR type "${d.srType}" of disk "${d.label}" does not support changed block tracking` }
  }
  return { eligible: true }
}

/**
 * Warm migration from an XCP-ng pool (direct XAPI connection) to Proxmox: the
 * VMware warm engine's behaviour on XAPI. Same statuses, same progress windows
 * (planning, enabling_cbt, preparing_disks 0-10, full_copy 10-80, delta_sync
 * 80-95, cutover 95-98, verify 98, converting_disks, completed).
 *
 * The source disks are read through xapi-nbd: each pass snapshots the VM, the
 * snapshot VDIs are re-exported on the Proxmox node by an nbdkit-nbd reader and
 * applied to raw block targets with the shared block applier. With CBT the delta
 * of a pass is VDI.list_changed_blocks between two consecutive snapshots; without
 * it (raw VDIs, SMAPIv3 SRs) the source is shut down first and one checksum
 * block-diff pass copies everything, exactly like the VMware fallback.
 */
export async function runXcpngWarmMigration(jobId: string, config: WarmMigrationConfig, tenantId = "default"): Promise<void> {
  const prisma = getTenantPrisma(tenantId)
  await registerJob(jobId, prisma)
  const budget = config.downtimeBudgetSec ?? 300
  const maxPasses = config.maxPasses ?? 5
  const cutoverMode = config.cutoverMode === "manual" ? "manual" : "auto"

  let session: XapiSession | null = null
  let stopKeepAlive: (() => void) | null = null
  let vmRef = ""
  let nodeIp: SshTarget = ""
  let targetVmid: number | null = config.targetVmid ?? null
  const vmKey = `${config.sourceConnectionId}:${config.sourceVmId}`
  let acquiredVmLock = false
  const ourSnapshots: string[] = []            // snapshot VM refs we created
  const allocatedVolumes: AllocatedVolume[] = []
  const activeReaders: XapiReaderHandle[] = []
  const targetDev = new Map<number, string>()  // disk position -> device path
  let pveConn: any = null
  let createdVmid: number | null = null        // set once THIS job created the target VM
  const cbtEnabledVdis: string[] = []          // VDIs whose CBT was off until we switched it on
  const stopHeartbeat = startJobHeartbeat({ jobId, prisma })

  // Give the source back CBT the way we found it: off only where we switched it
  // on, so the CBT a backup product relies on is never touched. Never throws.
  const restoreSourceCbt = async () => {
    if (!session) return
    for (const ref of cbtEnabledVdis.splice(0)) {
      await xapiDisableCbt(session, ref).catch(async (e: any) => {
        await appendLog(jobId, `Could not disable CBT on source disk ${ref} again: ${e?.message || e}. It was off before the migration.`, "warn").catch(() => {})
      })
    }
  }

  try {
    await updateJob(jobId, "planning")
    await appendStep(jobId, "planning", "Planning")
    await appendLog(jobId, "Warm migration (XCP-ng CBT): planning")
    if (!acquireVmLock(vmKey)) throw new Error("A warm migration is already running for this source VM. Wait for it to finish or cancel it before starting another.")
    acquiredVmLock = true

    const conn = await prisma.connection.findUnique({ where: { id: config.sourceConnectionId }, select: { id: true, type: true, subType: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true } })
    if (!conn || conn.type !== "xcpng") throw new Error("XCP-ng connection not found")
    if (xcpngSubTypeOf(conn) !== "xapi") throw new Error("Warm migration needs a direct XCP-ng pool connection; this connection goes through Xen Orchestra, which only supports offline migration")
    const { user, password } = splitCreds(decryptSecret(conn.apiTokenEnc), "root")
    session = await xapiLogin(conn.baseUrl, user, password, conn.insecureTLS)
    await appendLog(jobId, `Authenticated to ${session.baseUrl} as ${user}`, "success")
    stopKeepAlive = startSessionKeepAlive(() => xapiKeepAlive(session!), KEEPALIVE_MS)

    pveConn = await getConnectionById(config.targetConnectionId)
    nodeIp = await getNodeSshEndpointForMigration(prisma, config.targetConnectionId, config.targetNode, pveConn.baseUrl)

    vmRef = await xapiVmRefByUuid(session, config.sourceVmId)
    const vmConfig: XoVmConfig = await xapiGetVmConfig(session, config.sourceVmId)
    if (vmConfig.disks.length === 0) throw new Error("VM has no disks to migrate")
    await updateJob(jobId, "planning", { sourceVmName: vmConfig.name, totalDisks: vmConfig.disks.length, totalBytes: BigInt(vmConfig.disks.reduce((s, d) => s + d.sizeBytes, 0)) })

    const storageInfo = await pveFetch<any>(pveConn as any, `/storage/${encodeURIComponent(config.targetStorage)}`)
    if (isFileBasedStorage(storageInfo?.type || "dir")) {
      throw new Error(`Warm migration requires a block-storage target (LVM/LVM-thin/ZFS/Ceph RBD); "${config.targetStorage}" is file-based (${storageInfo?.type}). Pick a block storage or use a cold migration.`)
    }
    const pf = await checkNbdNodePreflight(config.targetConnectionId, nodeIp)
    if (!pf.ok) throw new Error(pf.error || `Proxmox node is missing the NBD tooling for warm migration (${pf.missing.join(", ")}). Install with: apt install nbdkit nbd-client libnbd-bin`)
    await appendLog(jobId, "NBD tooling preflight OK on Proxmox node", "success")
    // Same sweep as the VMware engine (roadmap#45): readers of finished jobs
    // are stopped, live ones left alone, failures never fail the job.
    await sweepOrphanReaders({
      connectionId: config.targetConnectionId, nodeIp, nodeName: config.targetNode, currentJobId: jobId,
      log: (msg, level) => appendLog(jobId, msg, level),
    }).catch(async (e: any) => { await appendLog(jobId, `Leftover reader sweep skipped: ${e?.message || e}`, "warn").catch(() => {}) })
    if (!(await xapiNbdEnabled(session))) {
      const net = await xapiManagementNetworkUuid(session).catch(() => "<network uuid>")
      throw new Error(`NBD is not enabled on any network of the XCP-ng pool. Run once on the pool master: xe network-param-add uuid=${net} param-name=purpose param-key=nbd`)
    }
    const elig = cbtEligibilityXcpng(vmConfig.disks)
    const useCbt = elig.eligible
    if (!useCbt) await appendLog(jobId, `CBT unavailable (${elig.reason}); using checksum block-diff fallback (downtime scales with disk size)`, "warn")
    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── enabling_cbt ──
    await updateJob(jobId, "enabling_cbt")
    await appendStep(jobId, "prepare", "Preparing the source and the target")
    if (useCbt) {
      for (const d of vmConfig.disks) if (await xapiEnableCbt(session, d.vdiRef!)) cbtEnabledVdis.push(d.vdiRef!)
      await appendLog(jobId, cbtEnabledVdis.length === vmConfig.disks.length
        ? "CBT enabled on source disks"
        : `CBT enabled on ${cbtEnabledVdis.length} of ${vmConfig.disks.length} source disk(s), already on for the others (left as is)`, "success")
    }
    if (targetVmid == null) targetVmid = await reserveTargetVmid(pveConn, config.targetConnectionId, jobId)
    const pveParams = mapXoToPveConfig(vmConfig, targetVmid, config.targetStorage, config.networkBridge, config.vlanTag, config.cpuType)
    const shellConf = await createTargetVmShell(pveConn as any, config.targetNode, pveParams)
    createdVmid = targetVmid
    await updateJob(jobId, "enabling_cbt", { targetVmid })
    await appendLog(jobId, `Target VM ${targetVmid} created on ${config.targetNode}`, "success")

    // ── preparing_disks ──
    // Every disk on the job's storage: the per-disk choices of #317 are VMware only.
    const devByKey = await provisionBlockTargets({
      jobId, connectionId: config.targetConnectionId, nodeIp, targetVmid, shellConf,
      disks: vmConfig.disks.map(d => ({ key: d.position, capacityBytes: d.sizeBytes, storage: config.targetStorage, storageType: storageInfo?.type || "" })),
      allocatedVolumes,
      zeroRateLimitMBps: await resolveWarmZeroRateLimit(config.zeroRateLimitMBps, config.targetConnectionId),
    })
    for (const [k, dev] of devByKey) targetDev.set(k, dev)

    /** Expose a VDI on the node through an nbdkit-nbd reader pinned to the host certificate XAPI handed us. */
    const readerFor = async (vdiRef: string, tag: string): Promise<XapiReaderHandle> => {
      const nbd = await xapiGetNbdInfo(session!, vdiRef)
      const reader = await startXapiReader(config.targetConnectionId, nodeIp, {
        sock: `/tmp/proxcenter-xapi-${jobId}-${tag}.sock`, address: nbd.address, port: nbd.port, exportname: nbd.exportname, cert: nbd.cert,
      })
      activeReaders.push(reader)
      return reader
    }
    const release = async (reader: XapiReaderHandle) => {
      await stopXapiReader(config.targetConnectionId, nodeIp, reader).catch(() => {})
      const i = activeReaders.indexOf(reader); if (i >= 0) activeReaders.splice(i, 1)
    }
    const destroySnapshot = async (snap: XapiSnapshot) => {
      await xapiDestroySnapshot(session!, snap.ref).catch(async (e: any) => {
        await appendLog(jobId, `Warning: snapshot ${snap.nameLabel} (${snap.uuid}) was not removed (${e?.message || e}); delete it on the XCP-ng pool`, "warn")
      })
      const k = ourSnapshots.indexOf(snap.ref); if (k >= 0) ourSnapshots.splice(k, 1)
    }

    /** One pass: snapshot, per disk read the changed (or allocated) extents and apply, then drop the previous snapshot. */
    async function runPass(label: string, prev: XapiSnapshot | null, window: PassWindow): Promise<{ bytes: number; snap: XapiSnapshot }> {
      const snap = await xapiSnapshotVm(session!, vmRef, `${XCPNG_SNAPSHOT_PREFIX}-${label}`, { shouldAbort: () => isCancelled(jobId) })
      ourSnapshots.push(snap.ref)
      let bytes = 0
      const extentsByPos = new Map<number, Extent[]>()
      const readers = new Map<number, XapiReaderHandle>()
      const snapDisk = (disk: XoDiskInfo) => {
        const sd = snap.disks.find(x => x.position === disk.position)
        if (!sd) throw new Error(`snapshot has no disk at position ${disk.position} ("${disk.label}")`)
        return sd
      }
      try {
        // Size the whole pass first so the progress bar has its denominator
        // before the first byte is written (all disks share one window).
        // A reader is only started when something needs it: the full pass needs
        // the socket for the allocated map, a delta pass gets its extents from
        // CBT and opens the reader at apply time, so a disk with no change never
        // starts one. That matters in the cutover pass (guest downtime) and on a
        // manual hold that re-snapshots every minute.
        let passTotal = 0
        for (const disk of vmConfig.disks) {
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          const sd = snapDisk(disk)
          let extents: Extent[] | null = null
          if (prev) {
            const pd = prev.disks.find(x => x.position === disk.position)
            if (!pd) throw new Error(`previous snapshot has no disk at position ${disk.position}`)
            try {
              extents = await xapiListChangedBlocks(session!, pd.vdiRef, sd.vdiRef, disk.sizeBytes)
            } catch (e: any) {
              // XAPI answers VDI_NO_CBT_METADATA or VDIS_NOT_IN_SAME_CHAIN when the
              // CBT chain between the two snapshots is broken (SR coalesce, metadata
              // dropped). The allocated map of the new snapshot is a superset of the
              // changed blocks, so copying it is still correct, only larger.
              await appendLog(jobId, `Disk ${disk.position} ("${disk.label}"): changed block list unavailable (${e?.message || e}); copying every allocated block of this snapshot instead`, "warn")
            }
          }
          if (extents === null) {
            const reader = await readerFor(sd.vdiRef, `${label}-${disk.position}`)
            readers.set(disk.position, reader)
            extents = await readAllocatedExtents(config.targetConnectionId, nodeIp, reader.sock, disk.sizeBytes)
          }
          extentsByPos.set(disk.position, extents)
          passTotal += extents.reduce((s, e) => s + e.length, 0)
        }
        const pass: PassProgress = { ...window, totalBytes: passTotal, doneBytes: 0, lastPct: Math.round(window.rangeStart) }
        await updateJob(jobId, window.status, { currentStep: window.currentStep, progress: pass.lastPct, totalBytes: BigInt(passTotal), bytesTransferred: BigInt(0) })
        for (let i = 0; i < vmConfig.disks.length; i++) {
          if (isCancelled(jobId)) throw new Error("Migration cancelled")
          const disk = vmConfig.disks[i]
          await updateJobLive(jobId, window.status, { currentStep: window.currentStep, currentDisk: i })
          const extents = extentsByPos.get(disk.position)!
          if (extents.length > 0) {
            let reader = readers.get(disk.position)
            if (!reader) {
              reader = await readerFor(snapDisk(disk).vdiRef, `${label}-${disk.position}`)
              readers.set(disk.position, reader)
            }
            await applyExtentsWithProgress({
              jobId, connectionId: config.targetConnectionId, nodeIp, nbdDev: reader.nbdDev, dev: targetDev.get(disk.position)!,
              extents, capacityBytes: disk.sizeBytes, label: "block apply failed", diskIndex: i, pass,
            })
            bytes += extents.reduce((s, e) => s + e.length, 0)
            pass.doneBytes = bytes
          }
          // Release right after the apply: the next disk's reader must not stack on this one.
          const reader = readers.get(disk.position)
          if (reader) { await release(reader); readers.delete(disk.position) }
        }
      } catch (e) {
        // prev stays the baseline, so a retried pass diffs from it again; this
        // attempt's snapshot is dead weight on the chain and must not pile up
        // with every retry (#1028). Its readers go first: XAPI will not destroy
        // a VDI that is still exported over NBD. A failed full pass has no
        // retry and is left to the failure cleanup.
        if (prev) {
          for (const r of readers.values()) if (activeReaders.includes(r)) await release(r)
          readers.clear()
          await destroySnapshot(snap)
        }
        throw e
      } finally {
        for (const r of readers.values()) if (activeReaders.includes(r)) await release(r)
      }
      if (prev) await destroySnapshot(prev)
      return { bytes, snap }
    }

    // Bytes copied over every pass, left on the job when it completes (warmFinalTransfer).
    let copiedBytes = 0

    const powerOps: PowerOffOps = {
      requestShutdown: () => xapiCleanShutdown(session!, vmRef, { shouldAbort: () => isCancelled(jobId) }),
      waitPoweredOff: async (sliceMs: number) => {
        const t0 = Date.now()
        while (Date.now() - t0 < sliceMs) {
          if ((await xapiPowerState(session!, vmRef)) === "Halted") return true
          await new Promise(r => setTimeout(r, Math.min(POWER_POLL_MS, sliceMs)))
        }
        return (await xapiPowerState(session!, vmRef)) === "Halted"
      },
      hardPowerOff: () => xapiHardShutdown(session!, vmRef),
      // No guest agent means VM.clean_shutdown can never succeed: the source is
      // then powered off hard without the operator (see cleanShutdownAndConfirm).
      isGuestUnreachable: isXapiGuestAgentMissing,
    }

    if (useCbt) {
      // ── full_copy (10 -> 80): allocated blocks of a live snapshot ──
      await updateJob(jobId, "full_copy", { progress: 10 })
      await appendStep(jobId, "full_copy", "Full copy")
      await appendLog(jobId, "Full copy (allocated blocks of a live snapshot)…")
      const t0 = Date.now()
      const full = await runPass("full", null, { status: "full_copy", currentStep: "full_copy", rangeStart: 10, rangeEnd: 80 })
      let baseline = full.snap
      copiedBytes += full.bytes
      markVolumesCopied(allocatedVolumes)
      const fullSec = Math.max(1, (Date.now() - t0) / 1000)
      let throughput = full.bytes / fullSec
      await updateJob(jobId, "full_copy", { progress: 80, bytesTransferred: BigInt(full.bytes), transferSpeed: `${(throughput / 1048576).toFixed(0)} MB/s` })
      await appendLog(jobId, `Full copy done: ${(full.bytes / 1073741824).toFixed(2)} GB at ${(throughput / 1048576).toFixed(0)} MB/s`, "success")

      // ── delta_sync (80 -> 95): converge, then cut over ──
      // The guest conversion chosen at launch (#1000) runs with the source off:
      // the projection counts it as part of the downtime.
      const verifySec = config.convertGuest === false ? 0 : GUEST_CONVERSION_ESTIMATE_SEC
      const cfg: ConvergenceConfig = { downtimeBudgetSec: budget, maxPasses, shutdownSec: 20, bootSec: 30, verifySec, cutoverMode }
      if (cutoverMode === "manual") await appendLog(jobId, `Manual cutover: replication will keep running and the migration will wait for you. Click "Cutover now" when your window opens.`, "info")
      await appendStep(jobId, "delta", "Delta sync")
      let pass = 0
      while (true) {
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
        if (isCutoverRequested(jobId)) { await appendLog(jobId, "Operator requested cutover: proceeding to final delta", "info"); break }
        const tk = Date.now()
        await updateJob(jobId, "delta_sync", { currentStep: `delta_${pass + 1}` })
        const deltaWindow: PassWindow = cutoverMode === "manual"
          ? { status: "delta_sync", currentStep: `delta_${pass + 1}`, rangeStart: 88, rangeEnd: 90 }
          : { status: "delta_sync", currentStep: `delta_${pass + 1}`, rangeStart: 80 + (15 * pass) / maxPasses, rangeEnd: 80 + (15 * (pass + 1)) / maxPasses }
        // A failed pass leaves the baseline untouched, so it is retried rather
        // than thrown away with hours of replication (#1028).
        const r = await runDeltaPassWithRetry(jobId, `Delta pass ${pass + 1}`, () => runPass(`delta-${pass + 1}`, baseline, deltaWindow))
        if (r === null) { await appendLog(jobId, "Operator requested cutover: proceeding to final delta", "info"); break }
        baseline = r.snap
        copiedBytes += r.bytes
        const dsec = Math.max(1, (Date.now() - tk) / 1000)
        throughput = r.bytes > 0 ? r.bytes / dsec : throughput
        await appendLog(jobId, `Delta pass ${pass + 1}: ${(r.bytes / 1048576).toFixed(1)} MB`)
        const decision = decideNextPass(pass, { deltaBytes: r.bytes, throughputBytesPerSec: throughput }, cfg)
        await updateJob(jobId, "delta_sync", { currentStep: `delta_${pass + 1}`, projectedDowntimeSec: decision.projectedDowntimeSec, progress: Math.round(deltaWindow.rangeEnd) })
        if (decision.action === "cutover") break
        if (decision.action === "operator-gate") { await awaitOperatorCutover(jobId, decision.projectedDowntimeSec, budget, maxPasses, { floorSec: cfg.shutdownSec + cfg.bootSec }); break }
        if (cutoverMode === "manual" && !(await sleepUnlessCutover(jobId, HOLD_PASS_INTERVAL_MS))) { await appendLog(jobId, "Operator requested cutover: proceeding to final delta", "info"); break }
        pass++
      }

      // ── cutover (95 -> 98): confirmed power off, then the final delta ──
      await updateJob(jobId, "cutover", { progress: 95 })
      await appendStep(jobId, "cutover", "Cutover")
      await cleanShutdownAndConfirm(jobId, powerOps, "Cutover: requesting clean guest shutdown (XCP-ng guest tools)…", "cutover")
      await appendLog(jobId, "Source powered off (confirmed): applying final delta", "success")
      const fin = await runPass("cutover", baseline, { status: "cutover", currentStep: "cutover", rangeStart: 95, rangeEnd: 98 })
      copiedBytes += fin.bytes
      await destroySnapshot(fin.snap)
      await restoreSourceCbt()
    } else {
      // ── checksum fallback: source off for the whole copy, one block-diff pass per disk ──
      await updateJob(jobId, "full_copy", { currentStep: "source_shutdown", progress: 10 })
      await appendStep(jobId, "full_copy", "Full copy (checksum, source powered off)")
      await cleanShutdownAndConfirm(jobId, powerOps, "Checksum fallback: requesting clean guest shutdown of the source BEFORE the copy; the VM stays powered off until the migration completes (CBT unavailable)…", "full_copy")
      await updateJob(jobId, "full_copy", { progress: 10 })
      const snap = await xapiSnapshotVm(session, vmRef, `${XCPNG_SNAPSHOT_PREFIX}-checksum`)
      ourSnapshots.push(snap.ref)
      try {
        for (let i = 0; i < vmConfig.disks.length; i++) {
          const disk = vmConfig.disks[i]
          const sd = snap.disks.find(x => x.position === disk.position)
          if (!sd) throw new Error(`snapshot has no disk at position ${disk.position}`)
          const reader = await readerFor(sd.vdiRef, `checksum-${disk.position}`)
          try {
            const dev = targetDev.get(disk.position)!
            const win = checksumDiskWindows(i, vmConfig.disks.length)
            await appendLog(jobId, `Disk ${i + 1}: scanning source and target block checksums (${(disk.sizeBytes / 1073741824).toFixed(1)} GB); nothing is copied during this phase`)
            let lastScanFlush = 0
            const extents = await detectChangedExtentsByChecksum(config.targetConnectionId, nodeIp, reader.nbdDev, dev, 256 * 1024 * 1024, disk.sizeBytes, {
              inactivityMs: APPLY_INACTIVITY_MS,
              onProgress: (scanned, total) => {
                const now = Date.now(); if (now - lastScanFlush < PROGRESS_LOG_INTERVAL_MS) return; lastScanFlush = now
                const pct = scaleWarmProgress(win.scanStart, win.scanEnd, scanned, total)
                void updateJobLive(jobId, "full_copy", { currentStep: "full_copy", currentDisk: i, progress: pct, transferSpeed: null }).catch(() => {})
              },
            })
            await applyExtentsWithProgress({
              jobId, connectionId: config.targetConnectionId, nodeIp, nbdDev: reader.nbdDev, dev, extents, capacityBytes: disk.sizeBytes, label: "checksum apply failed", diskIndex: i,
              pass: { status: "full_copy", currentStep: "full_copy", rangeStart: win.scanEnd, rangeEnd: win.applyEnd, totalBytes: extents.reduce((s, e) => s + e.length, 0), doneBytes: 0, lastPct: Math.round(win.scanEnd) },
            })
            copiedBytes += extents.reduce((s, e) => s + e.length, 0)
          } finally { await release(reader) }
        }
        markVolumesCopied(allocatedVolumes)
      } finally { await destroySnapshot(snap) }
    }

    // ── verify (98, sampled) ──
    await updateJob(jobId, "verify", { progress: 98 })
    await appendStep(jobId, "verify", "Integrity check")
    for (let i = 0; i < vmConfig.disks.length; i++) {
      const disk = vmConfig.disks[i]
      await verifySampledFirstBlock({
        jobId, connectionId: config.targetConnectionId, nodeIp, diskIndex: i, dev: targetDev.get(disk.position)!,
        openReader: async () => { const r = await readerFor(disk.vdiRef!, `vrfy-${disk.position}`); return { nbdDev: r.nbdDev, close: () => release(r) } },
      })
    }

    // ── guest conversion (#1000): the operator's latest choice, read back from
    // the job row (the "Cutover now" dialog writes it there), else the launch value ──
    const latest = await readJobConfig(jobId).catch(() => ({} as Record<string, any>))
    const convertGuest = typeof latest.convertGuest === "boolean" ? latest.convertGuest : config.convertGuest !== false
    let bootParams = pveParams
    let converted = false
    if (convertGuest) {
      await updateJob(jobId, "verify", { currentStep: "guest_conversion", progress: 98 })
      await appendStep(jobId, "conversion", "Guest conversion")
      const result = await convertGuestAtCutover({
        jobId, connectionId: config.targetConnectionId, nodeIp,
        name: vmConfig.name, firmware: vmConfig.firmware === "uefi" ? "efi" : "bios", isWindows: isWindowsXoVm(vmConfig), guestOs: vmConfig.guestOS,
        memoryMB: vmConfig.memoryMB, devices: vmConfig.disks.map(d => targetDev.get(d.position) ?? ""),
        // A netfront VIF is eth<device> in the guest, enX<device> under
        // systemd 253 and later (Debian 13, measured on the lab).
        nics: guestNicsFromNets(pveParams.nets, i => {
          const device = [...vmConfig.networks].sort((a, b) => Number(a.device) - Number(b.device))[i]?.device
          return /^\d+$/.test(device ?? "") ? [`eth${device}`, `enX${device}`] : []
        }),
        log: (msg, level) => appendLog(jobId, msg, level), isCancelled: () => isCancelled(jobId),
      })
      if (result.converted) {
        converted = true
        bootParams = mapXoToPveConfig(vmConfig, targetVmid, config.targetStorage, config.networkBridge, config.vlanTag, config.cpuType, { guestConverted: true })
        const os = result.os ? ` (${result.os})` : ""
        await appendLog(jobId, `Guest converted in ${result.seconds ?? 0}s${os}: VirtIO drivers installed; the target boots from VirtIO SCSI with VirtIO NICs`, "success")
        for (const line of result.network ?? []) await appendLog(jobId, line.msg, line.level)
      } else {
        const notApplied = conversionNotAppliedMessage(result)
        await appendLog(jobId, notApplied.msg, notApplied.level)
      }
    } else {
      await appendLog(jobId, "Guest conversion not requested for this cutover: the guest keeps the hardware it boots on without new drivers", "info")
    }
    const unusable = isWindowsXoVm(vmConfig) && !converted ? virtioDevices(bootParams) : []
    if (unusable.length > 0) {
      await appendLog(jobId, `Windows has no VirtIO driver yet and does not see ${unusable.join(", ")}: install virtio-win-guest-tools.exe from the VirtIO ISO in the guest`, "warn")
    }

    await appendStep(jobId, "finish", "Attach and start")
    await unmapTargetVolumes(config.targetConnectionId, nodeIp, allocatedVolumes)
    await attachDisksAndBoot({
      jobId, pveConn: pveConn as any, node: config.targetNode, vmid: targetVmid, diskCount: vmConfig.disks.length, diskSlots: bootParams.diskSlots, bootDiskSlot: bootParams.bootDiskSlot,
      allocatedVolumes, startAfterMigration: config.startAfterMigration, convertDisksToQcow2: config.convertDisksToQcow2 === true, targetStorage: config.targetStorage,
      ...(bootParams !== pveParams && { nets: bootParams.nets }),
    })
    await updateJob(jobId, "completed", { progress: 100, ...warmFinalTransfer(vmConfig.disks.map(d => d.sizeBytes), copiedBytes) })
    await appendLog(jobId, "Warm migration complete", "success").catch(() => {})
  } catch (err: any) {
    await updateJob(jobId, isCancelled(jobId) ? "cancelled" : "failed", { error: String(err?.message || err) }).catch(() => {})
    await appendLog(jobId, `Warm migration failed: ${err?.message || err}`, "error").catch(() => {})
    for (const r of activeReaders) if (nodeIp) await stopXapiReader(config.targetConnectionId, nodeIp, r).catch(() => {})
    if (session) {
      // Every destroy that fails is named in the log: a snapshot left on the pool
      // is the operator's problem to clean up, so it must not vanish in silence.
      const notRemoved = new Set<string>()
      const warnNotRemoved = async (ref: string, e: any) => {
        notRemoved.add(ref)
        await appendLog(jobId, `Warning: could not remove warm snapshot ${ref}: ${e?.message || e}; delete it on the XCP-ng pool`, "warn").catch(() => {})
      }
      for (const ref of [...ourSnapshots]) await xapiDestroySnapshot(session, ref).catch(e => warnNotRemoved(ref, e))
      // Belt and braces: anything with our prefix that an earlier aborted run left on the VM.
      if (vmRef) for (const ref of await xapiFindSnapshotsByPrefix(session, vmRef, `${XCPNG_SNAPSHOT_PREFIX}-`).catch(() => [] as string[])) {
        if (notRemoved.has(ref)) continue
        try {
          await xapiDestroySnapshot(session, ref)
          await appendLog(jobId, `Removed leftover warm snapshot ${ref} from the source VM`, "warn").catch(() => {})
        } catch (e: any) {
          await warnNotRemoved(ref, e)
        }
      }
    }
    // Free the target volumes that never held a complete copy; keep the ones that do (#612).
    await unmapTargetVolumes(config.targetConnectionId, nodeIp, allocatedVolumes)
    for (const v of volumesToFree(allocatedVolumes)) {
      if (nodeIp) await executeSSH(config.targetConnectionId, nodeIp, `pvesm free ${shellEscape(v.volumeId)} 2>/dev/null`, PVESM_FREE_TIMEOUT_MS).catch(() => {})
    }
    for (const v of volumesToKeep(allocatedVolumes)) await appendLog(jobId, `Kept target volume ${v.volumeId}: it holds a completed copy of the source disk. Remove it manually from the storage if you do not want it.`, "warn").catch(() => {})
    if (createdVmid != null && pveConn) {
      await removeTargetVmOnFailure({ jobId, pveConn, node: config.targetNode, vmid: createdVmid, allocatedVolumes })
    }
    await restoreSourceCbt()
    throw err
  } finally {
    // The VMID reserved for this job is either created on the cluster or unused now.
    releaseVmids(jobId)
    stopHeartbeat()
    stopKeepAlive?.()
    if (session) await xapiLogout(session).catch(() => {})
    unregisterJob(jobId)
    if (acquiredVmLock) releaseVmLock(vmKey)
  }
}
