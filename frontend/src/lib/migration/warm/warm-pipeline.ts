import { getTenantPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { reserveTargetVmid } from "../reserve-target-vmid"
import { releaseVmids } from "../vmid-reservation"
import { assertTargetStorageSpace, gib } from "./target-space"
import { isFileBasedStorage } from "@/lib/proxmox/storage"
import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import {
  soapLogin, soapLogout, soapGetVmConfig, parseVmConfig, vmwareToolsState, soapCreateSnapshot, soapRemoveSnapshot,
  soapWaitForConsolidation, soapFindSnapshotsByNamePrefix, CONSOLIDATION_TIMEOUT_MS, soapGetGuestStaticIpv4,
  SNAPSHOT_REMOVE_TERMINAL_TIMEOUT_MS, soapPowerOffVm,
} from "@/lib/vmware/soap"
import type { SoapSession, EsxiVmConfig, EsxiDiskInfo, GuestStaticIpv4 } from "@/lib/vmware/soap"
import {
  cbtEligibility, soapEnableCbt, soapDisableCbt, queryAllChangedAreas, soapGetSnapshotChangeIds,
  soapGuestShutdown, soapWaitPoweredOff, soapKeepAlive,
} from "@/lib/vmware/cbt"
import { describeHardwareChanges, isWindowsVm, mapEsxiToPveConfig, virtioDevices, withoutVirtioChoices } from "../configMapper"
import { bytesPerStorage, describeDiskPlan, describeOverrides, planDiskTargets, planStorages } from "../target-overrides"
import { volumesToFree, volumesToKeep, PVESM_FREE_TIMEOUT_MS, type AllocatedVolume } from "../pvesm-alloc"
import { getNodeSshEndpointForMigration } from "../pve-tasks"
import { decideNextPass, type PassStat, type ConvergenceConfig, type ConvergenceDecision } from "./convergence"
import { initDiskState, recordPass, type DiskWarmState } from "./state"
import { startVddkReader, stopVddkReader, buildJobReaderSweepCmd, type VddkReaderHandle } from "./vddk-reader"
import type { VddkOpts } from "./vddk-cmd"
import { detectChangedExtentsByChecksum } from "./checksum-detector"
import { checkVddkPreflight } from "./vddk-preflight"
import { checkWarmSourceVersion, warmSourceVersionError, warmSourceVersionWarning } from "./source-version"
import { parseSha1Thumbprint } from "./thumbprint"
import type { Extent } from "./extents"
import { startSoapKeepAlive } from "./session-keepalive"
import { startJobHeartbeat } from "../job-heartbeat"
import { resolveWarmZeroRateLimit } from "./zero-rate-target"
import { resolveIntegritySettings } from "../integrity-target"
import { faultInjectionFromEnv } from "../integrity"
import { estimateIntegritySecondsPerDisk } from "../integrity-settings"
import { vtpmPreflightWarning, vtpmCreatedLine } from "../vtpm"
import { sweepOrphanReaders } from "./orphan-readers"
import { resolveCopyPath } from "./copy-path"
import { checkNfcReachability, describeUnreachable, NFC_PORT, API_PORT } from "./nfc-reachability"
import { describeHeadroom, isThinHeadroom, parseVmDatastoreMors, soapGetDatastoreHeadroom } from "@/lib/vmware/datastore-headroom"
import type { WarmMigrationConfig } from "./types"
import {
  registerJob, unregisterJob, acquireVmLock, releaseVmLock,
  updateJob, updateJobLive, appendLog, appendStep, readJobConfig, isCancelled, isCutoverRequested,
  sleepUnlessCutover, awaitOperatorCutover, runDeltaPassWithRetry, HOLD_PASS_INTERVAL_MS,
} from "./job-control"
import {
  applyExtentsWithProgress, checksumDiskWindows, scaleWarmProgress, warmFinalTransfer,
  APPLY_INACTIVITY_MS, PROGRESS_LOG_INTERVAL_MS, type PassWindow, type PassProgress,
} from "./apply"
import { createTargetVmShell, provisionBlockTargets, markVolumesCopied } from "./target-provision"
import { cleanShutdownAndConfirm, isVmwareToolsUnavailable, type PowerOffOps } from "./power-off"
import { attachDisksAndBoot, removeTargetVmOnFailure, unmapTargetVolumes, verifyWarmDiskIntegrity } from "./finish"
import { conversionNotAppliedMessage, convertGuestAtCutover, GUEST_CONVERSION_ESTIMATE_SEC } from "./guest-conversion"
import { guestNicsFromNets } from "./guest-network"
import { warnIfEl10OnLowCpu } from "../el10-check"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"

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

const SNAPSHOT_PREFIX = "proxcenter-warm"
// Ping the SOAP session every 60 s to prevent idle-expiry during long dd copies (issue #394).
const SOAP_KEEPALIVE_INTERVAL_MS = 60_000

/**
 * Snapshot-removal budget for the LAST pass and for failure cleanup.
 *
 * The per-pass removal must be waited out in full (SNAPSHOT_REMOVE_TIMEOUT_MS,
 * 4 h): the next pass creates a snapshot and vCenter cannot do that while it
 * consolidates. After the cutover pass no snapshot follows, and the target VM
 * is waiting to be attached and booted — blocking that for hours on a source
 * that is already powered off would be its own regression. Same on the failure
 * path: the job has already failed, so cleanup notes what it could not confirm
 * and moves on. In both cases the removal task keeps running on vCenter; we
 * simply stop waiting for it.
 */
const TERMINAL_SNAPSHOT_REMOVE_TIMEOUT_MS = SNAPSHOT_REMOVE_TERMINAL_TIMEOUT_MS

/**
 * Snapshot budgets for the CUTOVER pass, where the source is already powered
 * off and every second is guest downtime.
 *
 * The generous defaults (30 min to create, 4 h to wait out a consolidation)
 * are right while the guest is still serving users: spending them buys a
 * migration that would otherwise die. They are wrong here. The declared
 * downtime budget for a warm migration defaults to 300 s, so inheriting hours
 * of patience in this window would silently turn a "few seconds" cutover into
 * an outage — exactly the promise warm migration exists to keep. Both waits
 * stay bounded; the consolidation one is fail-open and proceeds regardless.
 */
const CUTOVER_SNAPSHOT_CREATE_TIMEOUT_MS = 5 * 60 * 1000
const CUTOVER_CONSOLIDATION_TIMEOUT_MS = 2 * 60 * 1000

/**
 * Slice of the consolidation wait between two cancellation checks. The whole
 * budget is CONSOLIDATION_TIMEOUT_MS (hours); polling it in slices keeps the
 * job cancellable while it waits.
 */
const CONSOLIDATION_SLICE_MS = 60_000

/**
 * Create a warm snapshot and record its MOR for cleanup — including when the
 * create fails.
 *
 * `ourSnapshots.push(mor)` used to run only after soapCreateSnapshot returned,
 * so a create that timed out (or succeeded without a parseable MOR) left the
 * pipeline with no handle on a snapshot vCenter went on to create anyway. That
 * is how a customer ended up with a growing orphan `proxcenter-warm-delta-1` on
 * a production VM. On failure we now resolve the snapshot by its exact name and
 * push whatever we find, so failure cleanup can remove it. The recovery has its
 * own try/catch: it must never mask the real error, which is always rethrown.
 */
export async function createWarmSnapshot(
  session: SoapSession,
  vmid: string,
  snapName: string,
  ourSnapshots: string[],
  onRecovered?: (mor: string) => Promise<void> | void,
  createTimeoutMs?: number,
): Promise<string> {
  const recover = async () => {
    try {
      for (const s of await soapFindSnapshotsByNamePrefix(session, vmid, snapName)) {
        if (ourSnapshots.includes(s.mor)) continue
        ourSnapshots.push(s.mor)
        await onRecovered?.(s.mor)
      }
    } catch { /* a failed recovery must never replace the real error */ }
  }

  let snapMor: string
  try {
    snapMor = await soapCreateSnapshot(session, vmid, snapName, "warm migration", false, { timeoutMs: createTimeoutMs })
  } catch (err) {
    await recover()
    throw err
  }
  if (!snapMor) {
    await recover()
    throw new Error(`CreateSnapshot (${snapName}) returned no snapshot reference; a snapshot may have been created on the source — verify and remove it manually`)
  }
  ourSnapshots.push(snapMor)
  return snapMor
}

/**
 * Remove every leftover `proxcenter-warm-*` snapshot from the source VM.
 *
 * Backstop for the MORs we never learned: a create that timed out can still
 * land on the source after cleanup ran through `ourSnapshots`. Safe to sweep by
 * name because the pipeline enforces one warm job per source VM (activeWarmVms),
 * so no other run owns a snapshot with this prefix. Never throws — cleanup runs
 * on the failure path and must not add a second failure. Returns how many
 * snapshots it confirmed removed.
 */
export async function sweepWarmSnapshots(
  session: SoapSession,
  vmid: string,
  log: (msg: string) => Promise<void>,
): Promise<number> {
  const safeLog = (msg: string) => Promise.resolve().then(() => log(msg)).catch(() => {})
  let removed = 0
  let leftovers: Array<{ name: string; mor: string }>
  try {
    leftovers = await soapFindSnapshotsByNamePrefix(session, vmid, `${SNAPSHOT_PREFIX}-`)
  } catch {
    return 0
  }
  for (const s of leftovers) {
    try {
      await soapRemoveSnapshot(session, s.mor, false, { timeoutMs: TERMINAL_SNAPSHOT_REMOVE_TIMEOUT_MS })
      removed++
      await safeLog(`Removed leftover warm snapshot "${s.name}" (${s.mor}) from the source VM`)
    } catch (e: any) {
      await safeLog(`Leftover warm snapshot "${s.name}" (${s.mor}) could not be confirmed removed (${e?.message || e}); remove it manually if it is still there`)
    }
  }
  return removed
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
  await registerJob(jobId, prisma)

  const libdir = config.vddkLibdir || "/usr/lib/vmware-vix-disklib"
  const budget = config.downtimeBudgetSec ?? 300
  const maxPasses = config.maxPasses ?? 5
  const cutoverMode = config.cutoverMode === "manual" ? "manual" : "auto"

  let soapSession: SoapSession | null = null
  let stopKeepAlive: (() => void) | null = null
  let targetVmid: number | null = config.targetVmid ?? null
  let nodeIp: SshTarget = ""                                   // resolved in planning; used by failure cleanup
  let pveConn: any = null
  let createdVmid: number | null = null             // set once THIS job created the target VM
  let cbtEnabledByUs = false                        // CBT was off on the source and we switched it on
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
    await appendStep(jobId, "planning", "Planning")
    await appendLog(jobId, "Warm migration: planning")

    if (!acquireVmLock(vmKey)) {
      throw new Error("A warm migration is already running for this source VM. Wait for it to finish or cancel it before starting another.")
    }
    acquiredVmLock = true

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

    pveConn = await getConnectionById(config.targetConnectionId)
    nodeIp = await getNodeSshEndpointForMigration(prisma, config.targetConnectionId, config.targetNode, (pveConn as any).baseUrl)

    soapSession = await soapLogin(esxiUrl, username, password, esxiConn.insecureTLS)
    await appendLog(jobId, `Authenticated to ${esxiHost} as ${username}`, "success")
    stopKeepAlive = startSoapKeepAlive(() => soapKeepAlive(soapSession!), SOAP_KEEPALIVE_INTERVAL_MS)

    const vmConfigXml = await soapGetVmConfig(soapSession, config.sourceVmId)
    const vmConfig: EsxiVmConfig = parseVmConfig(vmConfigXml)
    // Per-disk choices (#317, lot 2), resolved before anything is sized,
    // created or copied: an excluded disk vanishes from vmConfig.disks here,
    // so no later step (CBT verdict, allocation, passes, verify, attach) ever
    // sees it, and disk i of the kept list lands on diskPlan.kept[i].storage.
    const diskPlan = planDiskTargets(vmConfig.disks, config.disks, config.targetStorage)
    const planLine = describeDiskPlan(diskPlan, config.targetStorage)
    if (planLine) await appendLog(jobId, planLine)
    vmConfig.disks = diskPlan.kept.map(k => k.disk)
    for (const d of vmConfig.disks) {
      if (!d.datastoreName || !d.relativePath) throw new Error(`Disk "${d.label}" has no datastore path: ${d.fileName}`)
    }
    await updateJob(jobId, "planning", {
      sourceVmName: vmConfig.name,
      totalDisks: vmConfig.disks.length,
      totalBytes: BigInt(vmConfig.disks.reduce((s, d) => s + d.capacityBytes, 0)),
    })
    // Say it now rather than hours later at cutover: a guest without Tools cannot
    // be shut down cleanly, so the run will stop it hard and the final delta will
    // be crash-consistent. The decision itself is taken at cutover, on vSphere's
    // answer to ShutdownGuest, in case Tools come up in the meantime.
    const tools = vmwareToolsState(vmConfig)
    if (tools !== "running" && tools !== "unknown") {
      await appendLog(jobId, `VMware Tools are ${tools === "not-installed" ? "not installed" : "not running"} on the source: a clean shutdown will not be possible, so the source will be powered off hard at cutover (crash-consistent final delta)`, "warn")
    }
    // EL10 on a CPU type below x86-64-v3 does not boot (#1000): say it now.
    await warnIfEl10OnLowCpu({ session: soapSession, vmid: config.sourceVmId, guest: vmConfig, cpuType: config.cpuType, log: m => appendLog(jobId, m, "warn") })
    // vTPM awareness (roadmap#1): say it at planning time, hours before the
    // cutover, so the operator has the BitLocker recovery key ready.
    if (vmConfig.hasVtpm) await appendLog(jobId, vtpmPreflightWarning(), "warn")

    // Warm patches the target by byte offset, which is only valid on a raw
    // block device. A file-based target (dir/NFS qcow2) would be silently
    // corrupted by the dd-seek apply: refuse it up front, for every storage
    // of the plan. The types are kept: each disk is zeroed by its own.
    const storages = planStorages(diskPlan)
    const storageTypes = new Map<string, string>()
    for (const storage of storages) {
      const storageInfo = await pveFetch<any>(pveConn as any, `/storage/${encodeURIComponent(storage)}`)
      const storageType = storageInfo?.type || "dir"
      if (isFileBasedStorage(storageType)) {
        // Name the disks only when the plan spreads them: with one storage every disk goes there.
        const held = storages.length > 1
          ? ` and would hold ${diskPlan.kept.filter(k => k.storage === storage).map(k => `disk ${k.sourceIndex + 1}`).join(", ")}`
          : ""
        throw new Error(`Warm migration requires a block-storage target (LVM/LVM-thin/ZFS/Ceph RBD); "${storage}" is file-based (${storageInfo?.type})${held}. Pick a block storage or use a cold migration.`)
      }
      storageTypes.set(storage, storageType)
    }

    // Free space backstop, same rule as the cold engine (disks' capacity plus
    // 10 %), per storage of the plan. The dialog runs this check before
    // enabling the launch, but the cluster-auto node choice and direct API
    // calls reach here unchecked, and a zvol allocation that fails for space
    // would otherwise surface only as a PVE error after the node preflight
    // said "ready".
    for (const [storage, requiredBytes] of bytesPerStorage(diskPlan, d => d.capacityBytes)) {
      const space = await assertTargetStorageSpace(config.targetConnectionId, config.targetNode, storage, requiredBytes)
      await appendLog(jobId, `Target storage "${storage}": ${gib(space.availableBytes)} GB free, need ${gib(space.requiredBytes)} GB`, "info")
    }

    // VDDK preflight on the PVE node — actionable error before we touch anything.
    const pf = await checkVddkPreflight(config.targetConnectionId, nodeIp, libdir)
    if (!pf.ok) throw new Error(pf.error || "VDDK preflight failed")
    await appendLog(jobId, "VDDK preflight OK on Proxmox node", "success")

    // Leftover nbdkit readers of finished jobs hold a VMware snapshot and a
    // kernel NBD slot for nothing (roadmap#45: one sat idle for nine days).
    // Stop them before this job starts its own; a live job's reader is never
    // touched, and a sweep failure never fails the migration.
    await sweepOrphanReaders({
      connectionId: config.targetConnectionId, nodeIp, nodeName: config.targetNode, currentJobId: jobId,
      log: (msg, level) => appendLog(jobId, msg, level),
    }).catch(async (e: any) => { await appendLog(jobId, `Leftover reader sweep skipped: ${e?.message || e}`, "warn").catch(() => {}) })

    // Source-side counterpart of that preflight (#946). A provisioned node says
    // nothing about whether its VDDK can read THIS source: the generations are
    // supported N-2 against vSphere, and an ESXi 5.5 source used to reach the
    // copy and die on the first dd with an I/O error after zero bytes. The
    // version has been on the session since login, so this costs no round trip.
    // The dialog runs the same check, but a cluster-auto node choice and direct
    // API calls arrive here unchecked.
    const srcVersion = checkWarmSourceVersion({ sourceApiVersion: soapSession.apiVersion, vddkLibPath: pf.vddkLib })
    if (srcVersion.blocked) throw new Error(warmSourceVersionError(srcVersion))
    if (srcVersion.warning) await appendLog(jobId, warmSourceVersionWarning(srcVersion), "warn")

    // CBT eligibility: the "*" baseline is VMFS-only and needs no pre-existing snapshot.
    const elig = cbtEligibility({ hwVersion: vmConfig.vmxVersion, disks: vmConfig.disks })
    const useCbt = elig.eligible && vmConfig.snapshotCount === 0
    if (!useCbt) {
      await appendLog(jobId, `CBT unavailable (${elig.reason || "pre-existing snapshot"}) — using checksum block-diff fallback (downtime scales with disk size)`, "warn")
    }

    // Which VMkernel adapter of the source host carries the copy (roadmap#53):
    // the operator's choice from the dialog, otherwise the host's own default
    // (its vSphereBackupNFC-tagged adapter, else management). On a standalone
    // host the VDDK is pointed at that address; on a vCenter source the adapter
    // is tagged on the host so the NFC ticket names it. Then prove, from the
    // node, that the address answers on 902 (and 443 when the VDDK talks to the
    // host directly) before anything is allocated: once the copy leaves the
    // management network, nothing else says the node has a route to it.
    const copy = await resolveCopyPath({
      session: soapSession, vmid: config.sourceVmId, connectionHost: esxiHost,
      chosen: config.copyVmk ? { device: config.copyVmk } : undefined,
      log: (msg, level) => appendLog(jobId, msg, level),
    })
    for (const change of copy.hostChanges) await appendLog(jobId, `Source host ${copy.label.split(" on ").pop()}: ${change} (host network setting, kept after the migration)`, "warn")
    const reach = await checkNfcReachability(config.targetConnectionId, nodeIp, copy.nfcAddress, copy.direct ? [NFC_PORT, API_PORT] : [NFC_PORT])
    if (!reach.ok) throw new Error(describeUnreachable(reach, copy.label))
    await appendLog(jobId, `Copy network: ${copy.label}, port ${Object.keys(reach.ports).join(" and ")} reachable from ${config.targetNode}${copy.direct ? "" : " (VDDK connects through the vCenter)"}`, "success")

    // Headroom of the source datastores (roadmap#53): the snapshot this job
    // holds grows for the whole copy, and parallel jobs on one datastore each
    // hold their own. Informational; a thin datastore is a warning, not a stop.
    try {
      for (const ds of await soapGetDatastoreHeadroom(soapSession, parseVmDatastoreMors(vmConfigXml))) {
        await appendLog(jobId, describeHeadroom(ds), isThinHeadroom(ds) ? "warn" : "info")
      }
    } catch (e: any) {
      await appendLog(jobId, `Source datastore headroom not read (${e?.message || e})`, "warn")
    }

    // SSL thumbprint for the VDDK connection (fetched from the PVE node), of the
    // address the VDDK will actually dial: by IP when the copy is pinned to an
    // adapter, in which case the certificate's name never matches and the
    // thumbprint is the only thing the VDDK trusts.
    const tp = await executeSSH(config.targetConnectionId, nodeIp,
      `echo | openssl s_client -connect ${shellEscape(copy.server)}:443 2>/dev/null | openssl x509 -fingerprint -sha1 -noout`)
    const thumbprint = parseSha1Thumbprint(tp.output || "")

    if (isCancelled(jobId)) throw new Error("Migration cancelled")

    // ── enabling_cbt: enable CBT + provision the target VM shell and raw volumes ──
    await updateJob(jobId, "enabling_cbt")
    await appendStep(jobId, "prepare", "Preparing the source and the target")
    if (useCbt && vmConfig.changeTrackingEnabled === true) {
      // Someone else's CBT (a backup product, usually): use it, and leave it on.
      await appendLog(jobId, "CBT already enabled on source, left as is", "info")
    } else if (useCbt) {
      await soapEnableCbt(soapSession, config.sourceVmId)
      cbtEnabledByUs = true
      await appendLog(jobId, "CBT enabled on source", "success")
    }

    const overrides = { hardware: config.hardware, nics: config.nics }
    // The review step's Bus column (#1000), per kept disk in target order.
    const buses = diskPlan.kept.map(k => k.bus)
    const overridesLine = describeOverrides(overrides)
    if (overridesLine) await appendLog(jobId, overridesLine)
    // The id comes from reserveTargetVmid, so the jobs of a parallel batch
    // (roadmap#53) never share one. A create can still fail with "VM <id>
    // already exists" when a VM was made outside ProxCenter meanwhile: take a
    // fresh id and retry, unless the operator picked the vmid (their conflict).
    let pveParams = mapEsxiToPveConfig(vmConfig, targetVmid ?? 0, config.targetStorage, config.networkBridge, config.vlanTag, config.cpuType, overrides, { buses })
    let shellConf: Record<string, any> | undefined
    for (let attempt = 1; shellConf === undefined; attempt++) {
      if (targetVmid == null) targetVmid = await reserveTargetVmid(pveConn, config.targetConnectionId, jobId)
      pveParams = mapEsxiToPveConfig(vmConfig, targetVmid, config.targetStorage, config.networkBridge, config.vlanTag, config.cpuType, overrides, { buses })
      try {
        shellConf = await createTargetVmShell(pveConn, config.targetNode, pveParams)
      } catch (e: any) {
        const msg = String(e?.message || e)
        if (config.targetVmid != null || attempt >= 5 || !/already exists/i.test(msg)) throw e
        await appendLog(jobId, `VM ${targetVmid} was created on the cluster meanwhile (${msg}); taking a fresh id`, "info")
        targetVmid = null
      }
    }
    // From here THIS job owns the shell: failure cleanup may remove it (roadmap#57).
    createdVmid = targetVmid
    await updateJob(jobId, "enabling_cbt", { targetVmid })
    await appendLog(jobId, `Target VM ${targetVmid} created on ${config.targetNode} (${Object.keys(pveParams.nets).length} NIC(s))`, "success")
    if (pveParams.tpmstate0) await appendLog(jobId, vtpmCreatedLine(config.targetStorage), "info")

    // ── preparing_disks: allocate a raw block volume per disk on its own storage, zero the thick ones ──
    const provisioned = await provisionBlockTargets({
      jobId, connectionId: config.targetConnectionId, nodeIp, targetVmid, shellConf,
      disks: diskPlan.kept.map(k => ({ key: k.disk.deviceKey, capacityBytes: k.disk.capacityBytes, storage: k.storage, storageType: storageTypes.get(k.storage) ?? "" })),
      allocatedVolumes,
      zeroRateLimitMBps: await resolveWarmZeroRateLimit(config.zeroRateLimitMBps, config.targetConnectionId),
    })
    for (const [deviceKey, dev] of provisioned) {
      targetDev.set(deviceKey, dev)
      diskState.set(deviceKey, initDiskState(deviceKey))
    }

    // Read one disk of a snapshot through VDDK and apply its extents to the target.
    async function readAndApply(disk: EsxiDiskInfo, diskIndex: number, snapMor: string, extents: Extent[], pass: PassProgress): Promise<number> {
      const bytes = extents.reduce((s, e) => s + e.length, 0)
      if (extents.length === 0) return 0
      const sock = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.sock`
      const pwFile = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.pw`
      const opts: VddkOpts = { sock, libdir, server: copy.server, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName, snapshot: snapMor }
      const reader = await startVddkReader(config.targetConnectionId, nodeIp, opts, password)
      activeReaders.push(reader)
      try {
        await applyExtentsWithProgress({
          jobId, connectionId: config.targetConnectionId, nodeIp, nbdDev: reader.nbdDev, dev: targetDev.get(disk.deviceKey)!,
          extents, capacityBytes: disk.capacityBytes, label: "block apply failed", diskIndex, pass,
        })
        return bytes
      } finally {
        await stopVddkReader(config.targetConnectionId, nodeIp, reader).catch(() => {})
        const idx = activeReaders.indexOf(reader)
        if (idx >= 0) activeReaders.splice(idx, 1)
      }
    }

    /**
     * Wait out any consolidation still running on the source before asking for
     * a new snapshot. Root cause of the field incident: RemoveSnapshot_Task
     * reports success while vCenter keeps merging the delta, and a
     * CreateSnapshot issued during that window never completes — two 120 s
     * stalls in a row and a dead 14-hour migration.
     *
     * Fail-open: a VM flagged for an unrelated reason must stay migratable, so
     * an elapsed budget only produces a warning and the pass starts anyway. The
     * budget is consumed in short slices rather than one long call so a cancel
     * request is honoured within the slice instead of hours later.
     */
    async function waitOutSourceConsolidation(label: string, budgetMs = CONSOLIDATION_TIMEOUT_MS): Promise<void> {
      const t0 = Date.now()
      let announced = false
      const announce = () => {
        if (announced) return
        announced = true
        void appendLog(jobId, `Source is still consolidating a previous snapshot; waiting before the ${label} pass (merging a multi-terabyte delta can take hours). Cancel the job if you would rather stop here.`, "warn").catch(() => {})
      }
      let cleared = false
      while (!cleared && Date.now() - t0 < budgetMs) {
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
        cleared = await soapWaitForConsolidation(soapSession!, config.sourceVmId, Math.min(CONSOLIDATION_SLICE_MS, budgetMs), undefined, announce)
      }
      const waitedSec = Math.round((Date.now() - t0) / 1000)
      if (!cleared) {
        await appendLog(jobId, `Source is STILL consolidating after ${waitedSec}s; starting the ${label} pass anyway — vCenter may reject the snapshot`, "warn")
      } else if (announced) {
        await appendLog(jobId, `Source finished consolidating after ${waitedSec}s; starting the ${label} pass`, "info")
      }
    }

    // Run one CBT pass: snapshot, per-disk query+read+apply, record changeIds, remove the snapshot.
    async function runCbtPass(
      label: string, baseline: (deviceKey: number) => string, window: PassWindow,
      passOpts: { removeTimeoutMs?: number; createTimeoutMs?: number; consolidationTimeoutMs?: number } = {},
    ): Promise<number> {
      await waitOutSourceConsolidation(label, passOpts.consolidationTimeoutMs)
      const snapMor = await createWarmSnapshot(soapSession!, config.sourceVmId, `${SNAPSHOT_PREFIX}-${label}`, ourSnapshots,
        mor => appendLog(jobId, `CreateSnapshot (${label}) failed, but the snapshot ${mor} exists on the source — it is now tracked and will be cleaned up`, "warn"),
        passOpts.createTimeoutMs)
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
          // Cheap live write so the task readout can say "Disk n of m" while this
          // disk streams; keeps the pass's finer step label (e.g. delta_2).
          await updateJobLive(jobId, window.status, { currentStep: window.currentStep, currentDisk: i })
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
        // user snapshot taken under ours must survive — section 11). Waited out
        // in full by default: the next pass cannot snapshot a VM that is still
        // consolidating this one.
        await soapRemoveSnapshot(soapSession!, snapMor, false, { timeoutMs: passOpts.removeTimeoutMs }).catch(async (e: any) => {
          await appendLog(jobId, `Warning: warm snapshot ${snapMor} was not confirmed removed (${e?.message || e}); vCenter may still be consolidating it — check the source VM`, "warn")
        })
        const k = ourSnapshots.indexOf(snapMor)
        if (k >= 0) ourSnapshots.splice(k, 1)
      }
      return bytes
    }

    // Bytes copied over every pass, left on the job when it completes (warmFinalTransfer).
    let copiedBytes = 0

    // A Windows guest loses a static IP on Proxmox (new adapter): what it
    // reports through VMware Tools is read while it still runs, so the guest
    // conversion can set it again (#1000 follow-up). Empty without Tools.
    let staticIps: GuestStaticIpv4[] = []
    const readWindowsStaticIps = async (): Promise<GuestStaticIpv4[]> => {
      if (!isWindowsVm(vmConfig)) return []
      const ips = await soapGetGuestStaticIpv4(soapSession!, config.sourceVmId)
      if (ips.length > 0) await appendLog(jobId, `Guest network: static IPv4 configuration read from VMware Tools for ${ips.map(ip => `${ip.mac} (${ip.address}/${ip.prefixLength})`).join(", ")}`)
      return ips
    }

    // Source-side power operations for the confirmed power-off (see cleanShutdownAndConfirm).
    const powerOffOps: PowerOffOps = {
      requestShutdown: () => soapGuestShutdown(soapSession!, config.sourceVmId),
      waitPoweredOff: ms => soapWaitPoweredOff(soapSession!, config.sourceVmId, ms),
      hardPowerOff: () => soapPowerOffVm(soapSession!, config.sourceVmId),
      // No Tools means the guest can never honour ShutdownGuest: the source is
      // then powered off hard without the operator (see cleanShutdownAndConfirm).
      isGuestUnreachable: isVmwareToolsUnavailable,
    }

    if (useCbt) {
      // ── full_copy: pass 0 with the "*" baseline (10→80 on the locked scale) ──
      await updateJob(jobId, "full_copy", { progress: 10 })
      await appendStep(jobId, "full_copy", "Full copy")
      await appendLog(jobId, "Full copy (CBT allocated map)…")
      const t0 = Date.now()
      const fullBytes = await runCbtPass("full", () => "*", { status: "full_copy", currentStep: "full_copy", rangeStart: 10, rangeEnd: 80 })
      copiedBytes += fullBytes
      // The full pass applied a VMware-snapshot-consistent image of every disk:
      // from this point the target holds a bootable point-in-time copy worth hours
      // of transfer, so failure cleanup must keep these volumes, not free them (#612).
      markVolumesCopied(allocatedVolumes)
      const fullSec = Math.max(1, (Date.now() - t0) / 1000)
      let throughput = fullBytes / fullSec
      await updateJob(jobId, "full_copy", { progress: 80, bytesTransferred: BigInt(fullBytes), transferSpeed: `${(throughput / 1048576).toFixed(0)} MB/s` })
      await appendLog(jobId, `Full copy done: ${(fullBytes / 1073741824).toFixed(2)} GB at ${(throughput / 1048576).toFixed(0)} MB/s`, "success")

      // ── delta_sync: converge by downtime budget, or hold for the operator ──
      // The integrity check runs at cutover with the source off (roadmap#1): its
      // time is part of the downtime the budget is measured against.
      // The guest conversion chosen at launch (#1000) runs in the same window;
      // the projection counts it like the integrity check.
      const verifySec = estimateIntegritySecondsPerDisk(await resolveIntegritySettings(config.targetConnectionId)) * vmConfig.disks.length
        + (config.convertGuest === false ? 0 : GUEST_CONVERSION_ESTIMATE_SEC)
      const cfg: ConvergenceConfig = { downtimeBudgetSec: budget, maxPasses, shutdownSec: 20, bootSec: 30, verifySec, cutoverMode }
      if (cutoverMode === "manual") {
        await appendLog(jobId, `Manual cutover: replication will keep running and the migration will wait for you. Click "Cutover now" when your window opens.`, "info")
      }
      await appendStep(jobId, "delta", "Delta sync")
      let pass = 0
      while (true) {
        if (isCancelled(jobId)) throw new Error("Migration cancelled")
        if (isCutoverRequested(jobId)) { await appendLog(jobId, "Operator requested cutover — proceeding to final delta", "info"); break }
        const tk = Date.now()
        await updateJob(jobId, "delta_sync", { currentStep: `delta_${pass + 1}` })
        // Each delta pass advances through an equal slice of the 80→95 delta
        // window; a run that converges before maxPasses jumps to 95 at cutover.
        // A manual hold has no last pass to aim at, so it parks the bar at 90
        // rather than creeping to 95 and stalling there for hours.
        const deltaWindow: PassWindow = cutoverMode === "manual"
          ? { status: "delta_sync", currentStep: `delta_${pass + 1}`, rangeStart: 88, rangeEnd: 90 }
          : {
            status: "delta_sync", currentStep: `delta_${pass + 1}`,
            rangeStart: 80 + (15 * pass) / maxPasses, rangeEnd: 80 + (15 * (pass + 1)) / maxPasses,
          }
        // A failed pass leaves the baseline untouched, so it is retried rather
        // than thrown away with hours of replication (#1028).
        const deltaBytes = await runDeltaPassWithRetry(jobId, `Delta pass ${pass + 1}`,
          () => runCbtPass(`delta-${pass + 1}`, dk => diskState.get(dk)!.currentChangeId || "*", deltaWindow))
        if (deltaBytes === null) { await appendLog(jobId, "Operator requested cutover — proceeding to final delta", "info"); break }
        copiedBytes += deltaBytes
        const dsec = Math.max(1, (Date.now() - tk) / 1000)
        throughput = deltaBytes > 0 ? deltaBytes / dsec : throughput
        await appendLog(jobId, `Delta pass ${pass + 1}: ${(deltaBytes / 1048576).toFixed(1)} MB`)
        const decision = decideNextPass(pass, { deltaBytes, throughputBytesPerSec: throughput }, cfg)
        await updateJob(jobId, "delta_sync", { currentStep: `delta_${pass + 1}`, projectedDowntimeSec: decision.projectedDowntimeSec, progress: Math.round(deltaWindow.rangeEnd) })
        if (decision.action === "cutover") break
        if (decision.action === "operator-gate") {
          await awaitOperatorCutover(jobId, decision.projectedDowntimeSec, budget, maxPasses, { floorSec: cfg.shutdownSec + cfg.bootSec + verifySec })
          break
        }
        // A converged source yields empty passes; without pacing they would
        // snapshot vCenter in a tight loop for the whole hold. The wait is
        // sliced so a cutover request is still picked up within a second.
        if (cutoverMode === "manual" && !(await sleepUnlessCutover(jobId, HOLD_PASS_INTERVAL_MS))) {
          await appendLog(jobId, "Operator requested cutover — proceeding to final delta", "info")
          break
        }
        pass++
      }

      // ── cutover: confirmed power-off → final delta → verify → attach → boot ──
      await updateJob(jobId, "cutover", { progress: 95 })
      await appendStep(jobId, "cutover", "Cutover")
      staticIps = await readWindowsStaticIps()
      await cleanShutdownAndConfirm(jobId, powerOffOps,
        "Cutover: requesting clean guest shutdown (VMware Tools)…", "cutover")
      await appendLog(jobId, "Source powered off (confirmed) — applying final delta", "success")
      // Last pass, and the only one that runs on a powered-off source: every
      // wait here is guest downtime, so all three budgets are the short ones
      // (see CUTOVER_SNAPSHOT_CREATE_TIMEOUT_MS and TERMINAL_SNAPSHOT_REMOVE_TIMEOUT_MS).
      copiedBytes += await runCbtPass("cutover", dk => diskState.get(dk)!.currentChangeId || "*",
        { status: "cutover", currentStep: "cutover", rangeStart: 95, rangeEnd: 98 },
        {
          removeTimeoutMs: TERMINAL_SNAPSHOT_REMOVE_TIMEOUT_MS,
          createTimeoutMs: CUTOVER_SNAPSHOT_CREATE_TIMEOUT_MS,
          consolidationTimeoutMs: CUTOVER_CONSOLIDATION_TIMEOUT_MS,
        })
    } else {
      // ── checksum fallback: stop source, full block-diff vs the (zeroed) target ──
      // The early shutdown belongs to the full copy on this path, NOT the cutover:
      // a "cutover" badge at minute 0 read as "almost done" while the whole copy
      // was still ahead, and the generic shutdown line hid that the VM would stay
      // off for the entire transfer (#587 field feedback).
      await updateJob(jobId, "full_copy", { currentStep: "source_shutdown", progress: 10 })
      await appendStep(jobId, "full_copy", "Full copy (checksum, source powered off)")
      staticIps = await readWindowsStaticIps()
      await cleanShutdownAndConfirm(jobId, powerOffOps,
        "Checksum fallback: requesting clean guest shutdown of the source BEFORE the copy — the VM stays powered off until the migration completes (CBT unavailable)…", "full_copy")
      await updateJob(jobId, "full_copy", { progress: 10 })
      const snapMor = await createWarmSnapshot(soapSession!, config.sourceVmId, `${SNAPSHOT_PREFIX}-checksum`, ourSnapshots,
        mor => appendLog(jobId, `CreateSnapshot (checksum) failed, but the snapshot ${mor} exists on the source — it is now tracked and will be cleaned up`, "warn"))
      try {
        for (let i = 0; i < vmConfig.disks.length; i++) {
          const disk = vmConfig.disks[i]
          const sock = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.sock`
          const pwFile = `/tmp/proxcenter-vddk-${jobId}-${disk.deviceKey}.pw`
          const opts: VddkOpts = { sock, libdir, server: copy.server, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName, snapshot: snapMor }
          const reader = await startVddkReader(config.targetConnectionId, nodeIp, opts, password)
          activeReaders.push(reader)
          try {
            const dev = targetDev.get(disk.deviceKey)!
            // Per-disk progress windows: unlike runCbtPass there is no upfront
            // all-disk denominator here (the checksum scan needs each disk's
            // reader), so each disk gets an equal slice of the 10→80 window —
            // the first 30% for the scan, the rest for the apply.
            const win = checksumDiskWindows(i, vmConfig.disks.length)
            const capGB = (disk.capacityBytes / 1073741824).toFixed(1)
            // #587 field feedback: this scan ran ~25 min per 60 GB disk (hours on
            // multi-TB) in total silence — no log line, no progress — and read as
            // a hang. Announce it and stream its progress below.
            await appendLog(jobId, `Disk ${i + 1}: scanning source and target block checksums (${capGB} GB) — nothing is copied during this phase; it reads the whole disk and can take a long time`)
            let lastScanFlush = 0
            const extents = await detectChangedExtentsByChecksum(config.targetConnectionId, nodeIp, reader.nbdDev, dev, 256 * 1024 * 1024, disk.capacityBytes, {
              inactivityMs: APPLY_INACTIVITY_MS,
              onProgress: (scannedBlocks, totalBlocks) => {
                const now = Date.now()
                if (now - lastScanFlush < PROGRESS_LOG_INTERVAL_MS) return
                lastScanFlush = now
                const pct = scaleWarmProgress(win.scanStart, win.scanEnd, scannedBlocks, totalBlocks)
                const scanPct = totalBlocks > 0 ? Math.round((scannedBlocks / totalBlocks) * 100) : 100
                // Progress first, then the log line — appendLog stamps each entry
                // with the job's current progress (#502).
                void (async () => {
                  await updateJobLive(jobId, "full_copy", { currentStep: "full_copy", currentDisk: i, progress: pct, transferSpeed: null })
                  await appendLog(jobId, `Disk ${i + 1}: checksum scan ${scanPct}% (reading source and target)`)
                })().catch(() => {})
              },
            })
            await applyExtentsWithProgress({
              jobId, connectionId: config.targetConnectionId, nodeIp, nbdDev: reader.nbdDev, dev,
              extents, capacityBytes: disk.capacityBytes, label: "checksum apply failed", diskIndex: i,
              pass: {
                status: "full_copy", currentStep: "full_copy",
                rangeStart: win.scanEnd, rangeEnd: win.applyEnd,
                totalBytes: extents.reduce((s, e) => s + e.length, 0), doneBytes: 0,
                lastPct: Math.round(win.scanEnd),
              },
            })
            copiedBytes += extents.reduce((s, e) => s + e.length, 0)
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
        // Terminal on this path too: the checksum fallback takes exactly one
        // snapshot, so nothing downstream waits on the consolidation.
        await soapRemoveSnapshot(soapSession!, snapMor, false, { timeoutMs: TERMINAL_SNAPSHOT_REMOVE_TIMEOUT_MS }).catch(async (e: any) => {
          await appendLog(jobId, `Warning: warm snapshot ${snapMor} was not confirmed removed (${e?.message || e}); vCenter may still be consolidating it — check the source VM`, "warn").catch(() => {})
        })
        const k = ourSnapshots.indexOf(snapMor)
        if (k >= 0) ourSnapshots.splice(k, 1)
      }
    }

    // ── verify (sampled regions, blocking) ──
    // The no-loss property is algorithmic (CBT + post-shutdown final delta); this
    // check catches what the algorithm cannot see (a transport or a storage that
    // lied). The source is now powered off, so its current disk == the cutover
    // state (no snapshot param). First, last and N spread regions of every disk
    // are hashed on both sides; a difference FAILS the job before the disks are
    // attached (roadmap#1). The baseline and the intermediate deltas never run
    // it: only this final copy is the one handed over. Knobs: the target PVE connection (Migrations tab).
    await updateJob(jobId, "verify", { progress: 98 })
    await appendStep(jobId, "verify", "Integrity check")
    const integrity = await resolveIntegritySettings(config.targetConnectionId)
    const fault = faultInjectionFromEnv()
    for (let i = 0; i < vmConfig.disks.length; i++) {
      const disk = vmConfig.disks[i]
      const dev = targetDev.get(disk.deviceKey)!
      const sock = `/tmp/proxcenter-vddk-${jobId}-vrfy-${disk.deviceKey}.sock`
      const pwFile = `/tmp/proxcenter-vddk-${jobId}-vrfy-${disk.deviceKey}.pw`
      await verifyWarmDiskIntegrity({
        jobId, connectionId: config.targetConnectionId, nodeIp, diskIndex: i, dev,
        capacityBytes: disk.capacityBytes, settings: integrity, fault,
        openReader: async () => {
          const reader = await startVddkReader(config.targetConnectionId, nodeIp,
            { sock, libdir, server: copy.server, user: username, passwordFile: pwFile, thumbprint, moref: config.sourceVmId, diskPath: disk.fileName }, password)
          return { nbdDev: reader.nbdDev, close: () => stopVddkReader(config.targetConnectionId, nodeIp, reader) }
        },
      })
    }

    // ── guest conversion (#1000): the operator's latest choice, read back from
    // the job row (the "Cutover now" dialog writes it there), else the launch value ──
    const latest = await readJobConfig(jobId).catch(() => ({} as Record<string, any>))
    const convertGuest = typeof latest.convertGuest === "boolean" ? latest.convertGuest : config.convertGuest !== false
    let bootParams = pveParams
    let converted = false
    const isWindows = isWindowsVm(vmConfig)
    if (convertGuest) {
      await updateJob(jobId, "verify", { currentStep: "guest_conversion", progress: 98 })
      await appendStep(jobId, "conversion", "Guest conversion")
      const result = await convertGuestAtCutover({
        jobId, connectionId: config.targetConnectionId, nodeIp,
        name: vmConfig.name, firmware: vmConfig.firmware === "efi" ? "efi" : "bios", isWindows, guestOs: vmConfig.guestOS,
        memoryMB: vmConfig.memoryMB, devices: vmConfig.disks.map(d => targetDev.get(d.deviceKey) ?? ""),
        staticIps,
        nics: guestNicsFromNets(pveParams.nets, i => {
          const slot = vmConfig.nics[i]?.pciSlot
          return slot ? [`ens${slot}`] : []
        }),
        log: (msg, level) => appendLog(jobId, msg, level), isCancelled: () => isCancelled(jobId),
      })
      if (result.converted) {
        converted = true
        bootParams = mapEsxiToPveConfig(vmConfig, targetVmid, config.targetStorage, config.networkBridge, config.vlanTag, config.cpuType, overrides, { buses, guestConverted: true })
        await appendLog(jobId, `Guest converted in ${result.seconds ?? 0}s${result.os ? ` (${result.os})` : ""}: VirtIO drivers installed, VMware Tools removed or scheduled for removal; the target boots from VirtIO SCSI with VirtIO NICs`, "success")
        for (const line of result.notes ?? []) await appendLog(jobId, line.msg, line.level)
      } else {
        const notApplied = conversionNotAppliedMessage(result)
        await appendLog(jobId, notApplied.msg, notApplied.level)
        // #1173: the review step's VirtIO choices were made for a converted
        // guest. A Windows left without the drivers would not see those disks
        // and NICs: they go back to the hardware it has drivers for.
        if (isWindows) {
          const inbox = withoutVirtioChoices(overrides, buses)
          const fallback = mapEsxiToPveConfig(vmConfig, targetVmid, config.targetStorage, config.networkBridge, config.vlanTag, config.cpuType, inbox.overrides, { buses: inbox.buses })
          const changes = describeHardwareChanges(pveParams, fallback)
          if (changes.length > 0) {
            bootParams = fallback
            await appendLog(jobId, `The VirtIO hardware chosen for this guest needs the drivers the conversion did not install, so it is replaced by hardware Windows has drivers for: ${changes.join(", ")}`, "warn")
          }
        }
      }
    } else {
      await appendLog(jobId, "Guest conversion not requested for this cutover: the guest keeps the hardware it boots on without new drivers", "info")
    }
    const unusable = isWindows && !converted ? virtioDevices(bootParams) : []
    if (unusable.length > 0) {
      await appendLog(jobId, `Windows has no VirtIO driver yet and does not see ${unusable.join(", ")}: install virtio-win-guest-tools.exe from the VirtIO ISO in the guest`, "warn")
    }
    if (staticIps.length > 0 && !converted) {
      await appendLog(jobId, `Guest network: Windows sees a new network adapter on Proxmox and the guest was not converted, so its static IPv4 configuration (${staticIps.map(ip => `${ip.address}/${ip.prefixLength}`).join(", ")}) must be set again from the console`, "warn")
    }

    await appendStep(jobId, "finish", "Attach and start")
    await unmapTargetVolumes(config.targetConnectionId, nodeIp, allocatedVolumes)
    await attachDisksAndBoot({
      jobId, pveConn, node: config.targetNode, vmid: targetVmid, diskCount: vmConfig.disks.length,
      diskSlots: bootParams.diskSlots, bootDiskSlot: bootParams.bootDiskSlot, allocatedVolumes,
      startAfterMigration: config.startAfterMigration, convertDisksToQcow2: config.convertDisksToQcow2 === true,
      targetStorage: config.targetStorage,
      ...(bootParams !== pveParams && { nets: bootParams.nets }),
    })

    // The source is powered off for good: give it back CBT the way we found it.
    await restoreSourceCbt(jobId, soapSession, config.sourceVmId, cbtEnabledByUs)

    await updateJob(jobId, "completed", { progress: 100, ...warmFinalTransfer(vmConfig.disks.map(d => d.capacityBytes), copiedBytes) })
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
    // After the volumes: the VM goes only when it holds no completed copy (#612),
    // and CBT only once our snapshots are gone, which vSphere requires.
    if (createdVmid != null && pveConn) {
      await removeTargetVmOnFailure({ jobId, pveConn, node: config.targetNode, vmid: createdVmid, allocatedVolumes })
    }
    await restoreSourceCbt(jobId, soapSession, config.sourceVmId, cbtEnabledByUs)
    throw err
  } finally {
    // The VMID reserved for this job is either created on the cluster or unused now.
    releaseVmids(jobId)
    stopHeartbeat()
    stopKeepAlive?.()
    if (soapSession) await soapLogout(soapSession).catch(() => {})
    unregisterJob(jobId)
    if (acquiredVmLock) releaseVmLock(vmKey)
  }
}

/**
 * Switch CBT back off on the source when this job switched it on. Never throws:
 * a source that keeps CBT is harmless, a cleanup that masks the real error is not.
 */
async function restoreSourceCbt(jobId: string, session: SoapSession | null, sourceVmId: string, enabledByUs: boolean): Promise<void> {
  if (!enabledByUs || !session) return
  try {
    await soapDisableCbt(session, sourceVmId)
    await appendLog(jobId, "CBT disabled on source again (it was off before the migration)", "info").catch(() => {})
  } catch (e: any) {
    await appendLog(jobId, `Could not disable CBT on the source again: ${e?.message || e}. It was off before the migration; switch it off in vSphere if you do not want it.`, "warn").catch(() => {})
  }
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
  nodeIp: SshTarget,
): Promise<void> {
  // nodeIp is the value resolved during planning (empty if we failed before that,
  // in which case nothing was allocated on the node and there is nothing to free).
  for (const r of activeReaders) {
    if (nodeIp) await stopVddkReader(config.targetConnectionId, nodeIp, r).catch(() => {})
  }
  // A launch that timed out can still have started nbdkit on the node, with the
  // ESXi password file next to it; no handle tracks it (#1028).
  const sweep = buildJobReaderSweepCmd(jobId)
  if (nodeIp && sweep) await executeSSH(config.targetConnectionId, nodeIp, sweep).catch(() => {})
  if (session) {
    for (const mor of [...ourSnapshots]) {
      await soapRemoveSnapshot(session, mor, false, { timeoutMs: TERMINAL_SNAPSHOT_REMOVE_TIMEOUT_MS }).catch(() => {})
    }
    // Backstop for the MORs we never learned (a create that timed out can still
    // land afterwards): sweep anything named proxcenter-warm-* off the source.
    // One warm job per source VM, so nothing else owns these.
    await sweepWarmSnapshots(session, config.sourceVmId,
      msg => appendLog(jobId, msg, "warn")).catch(() => {})
  }
  // Unmap every RBD volume (a kept one too), then free the volumes the VM never referenced (orphans). volumesToFree also
  // covers a volume created by an allocation that reported a failure, and skips the
  // slots whose allocation never started.
  await unmapTargetVolumes(config.targetConnectionId, nodeIp, allocatedVolumes)
  for (const v of volumesToFree(allocatedVolumes)) {
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

// Re-exports: the API routes and the unit tests keep importing these from this module.
export { cancelWarmMigrationJob, requestWarmCutover, requestWarmForcePowerOff, gateReason, __isCutoverRequestedForTest, __isForcePowerOffRequestedForTest, __awaitOperatorCutoverForTest, __sleepUnlessCutoverForTest } from "./job-control"
export { buildThickZeroScript, ZERO_PARALLEL_CHUNKS, markVolumesCopied } from "./target-provision"
export { scaleWarmProgress, checksumDiskWindows } from "./apply"
export type { WarmStatus, WarmMigrationConfig } from "./types"
