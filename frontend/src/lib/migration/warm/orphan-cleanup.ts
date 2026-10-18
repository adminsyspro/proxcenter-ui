/**
 * What a warm run (VMware or XCP-ng) leaves on its SOURCE when the server dies
 * under it.
 *
 * A warm run cleans up after itself when it fails (cleanupOnFailure in
 * warm-pipeline.ts, the catch of xcpng-warm-pipeline.ts), but a restart kills
 * the process before that code runs:
 * the startup sweep (orphan-sweep.ts) only fails the row. The source VM keeps
 * its `proxcenter-warm-*` snapshot, whose delta grows on the production
 * datastore for as long as nobody notices, and the CBT the run switched on.
 * Seen on the lab on 17/10 (roadmap#53): a batch survives a restart, so its
 * interrupted job must not leave this behind.
 *
 * This runs after the sweep, for each job it failed, and only acts on what the
 * job recorded: the snapshot prefix belongs to warm runs (one per source VM),
 * and CBT is switched off only when the job's log says this run switched it
 * on. The target VM is never touched: it may hold hours of copied data (#612);
 * the job log says where it is so the operator decides.
 */
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { soapConsolidateVmDisks, soapLogin, soapLogout, soapWaitForConsolidation } from "@/lib/vmware/soap"
import { soapDisableCbt } from "@/lib/vmware/cbt"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"
import { ORPHANED_JOB_ERROR } from "@/lib/migration/orphan-sweep"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getNodeSshEndpointForMigration } from "@/lib/migration/pve-tasks"
import { sweepWarmSnapshots } from "./warm-pipeline"
import { sweepOrphanReaders } from "./orphan-readers"
import { unmapTargetVolumes } from "./finish"
import { executeSSH } from "@/lib/ssh/exec"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"
import type { AllocatedVolume } from "@/lib/migration/pvesm-alloc"
import { XCPNG_SNAPSHOT_PREFIX } from "./xcpng-warm-pipeline"
import { xapiDestroySnapshot, xapiDisableCbt, xapiFindSnapshotsByPrefix, xapiGetVmConfig, xapiLogin, xapiLogout, xapiVmRefByUuid } from "@/lib/xcpng/xapi-client"
import { splitCreds } from "@/lib/xcpng/source"

/** Budget of the disk consolidation; it runs in the background of a boot. */
const CONSOLIDATE_TIMEOUT_MS = 60 * 60 * 1000

/** Log line the warm pipeline writes when it switched CBT on (warm-pipeline.ts, enabling_cbt). */
export const CBT_ENABLED_BY_RUN = "CBT enabled on source"
/** XCP-ng warm (xcpng-warm-pipeline.ts, enabling_cbt): CBT switched on for every disk... */
export const CBT_ENABLED_BY_RUN_XCPNG = "CBT enabled on source disks"
/** ...or for some of them only, without naming which. */
export const CBT_PARTLY_ENABLED_BY_RUN_XCPNG = /^CBT enabled on \d+ of \d+ source disk\(s\), already on for the others/

type Level = "info" | "success" | "warn" | "error"

interface LogLine { ts: string; msg: string; level: Level }

export interface WarmOrphanCleanupDeps {
  prisma?: typeof globalPrisma
  now?: () => Date
}

async function appendLogs(prisma: typeof globalPrisma, id: string, lines: Array<{ msg: string; level: Level }>, now: () => Date) {
  if (lines.length === 0) return
  const job = await prisma.migrationJob.findUnique({ where: { id }, select: { logs: true } })
  const logs = ((job?.logs as unknown as LogLine[] | null) ?? []).concat(lines.map(l => ({ ts: now().toISOString(), ...l })))
  await prisma.migrationJob.update({ where: { id }, data: { logs: logs as any } })
}

type Lines = Array<{ msg: string; level: Level }>

/** "Disk 0: target CephStoragePool:vm-109-disk-0 → /dev/rbd3 (15.0 GB)" (target-provision.ts, both engines). */
const TARGET_MAPPING_RE = /^Disk \d+: target (\S+) → (\/dev\/rbd\d+) /

/** Volumes of the run still mapped through krbd, from its log, as AllocatedVolume entries. */
export function mappedTargetVolumesFromLog(logs: unknown): AllocatedVolume[] {
  const out: AllocatedVolume[] = []
  for (const l of (logs as LogLine[] | null) ?? []) {
    const m = TARGET_MAPPING_RE.exec(l?.msg ?? "")
    if (m) out.push({ volumeId: m[1], devicePath: m[2], rbdMapped: true })
  }
  return out
}

/**
 * Release the krbd mappings the run left on the target node (roadmap#57
 * helper, the one the engines use on failure): only the devices the run
 * logged, only while the node still maps them to that VM's own image
 * (`vm-<vmid>-disk-N`), and never while the target VM runs. A device the
 * restart left mapped otherwise stays on the node until someone notices.
 */
async function unmapTargetRbd(a: { connectionId: string; nodeIp: SshTarget; node: string; vmid: number; logs: unknown }, lines: Lines): Promise<void> {
  const logged = mappedTargetVolumesFromLog(a.logs)
  if (logged.length === 0) return
  const status = await executeSSH(a.connectionId, a.nodeIp, `qm status ${Number(a.vmid)} 2>&1`)
  if (/status:\s*running/.test(status.output || "")) {
    lines.push({ msg: `Target VM ${a.vmid} is running: its RBD mappings on ${a.node} are left alone`, level: "info" })
    return
  }
  const shown = await executeSSH(a.connectionId, a.nodeIp, "rbd showmapped --format json 2>/dev/null")
  let mapped: Array<{ name?: string; device?: string }> = []
  try { mapped = JSON.parse(shown.output || "[]") } catch { mapped = [] }
  const ownImage = new RegExp(`^vm-${Number(a.vmid)}-disk-\\d+$`)
  const ours = logged.filter(v => mapped.some(m => m.device === v.devicePath && ownImage.test(m.name ?? "") && v.volumeId.endsWith(`:${m.name}`)))
  if (ours.length === 0) return
  await unmapTargetVolumes(a.connectionId, a.nodeIp, ours)
  const released = ours.filter(v => !v.rbdMapped)
  const kept = ours.filter(v => v.rbdMapped)
  if (released.length) lines.push({ msg: `Released the RBD mapping(s) of target VM ${a.vmid} on ${a.node}: ${released.map(v => `${v.devicePath} (${v.volumeId})`).join(", ")}`, level: "info" })
  if (kept.length) lines.push({ msg: `Could not release ${kept.map(v => v.devicePath).join(", ")} on ${a.node} (still in use?); run "rbd unmap" on the node once the VM is checked`, level: "warn" })
}

/** Which warm engine ran the job, from its persisted config; null when it was not a warm run. */
function warmEngineOf(config: Record<string, any>): "vmware" | "xcpng" | null {
  if (config.migrationType !== "warm") return null
  if (config.sourceType === "vmware" || config.sourceType === "vcenter") return "vmware"
  if (config.sourceType === "xcpng") return "xcpng"
  return null
}

/** vSphere side: warm snapshots, a merge left pending, the CBT this run switched on. */
async function cleanVmwareSource(job: { sourceVmId: string; logs: unknown }, conn: { baseUrl: string; apiTokenEnc: string | null; insecureTLS: boolean }, lines: Lines): Promise<void> {
  const creds = decryptSecret(conn.apiTokenEnc!)
  const colonIdx = creds.indexOf(":")
  const username = colonIdx > 0 ? creds.substring(0, colonIdx) : "root"
  const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds

  const session = await soapLogin(conn.baseUrl.replace(/\/$/, ""), username, password, conn.insecureTLS)
  try {
    const removed = await sweepWarmSnapshots(session, job.sourceVmId, async msg => { lines.push({ msg, level: "warn" }) })
    if (removed === 0) lines.push({ msg: "No warm snapshot left on the source VM after the restart", level: "info" })
    // One probe, no wait: false means vSphere still flags a pending merge.
    if (!(await soapWaitForConsolidation(session, job.sourceVmId, 0, 0))) {
      try {
        await soapConsolidateVmDisks(session, job.sourceVmId, { timeoutMs: CONSOLIDATE_TIMEOUT_MS })
        lines.push({ msg: "Consolidated the source VM disks (vSphere flagged a pending merge after the snapshot removal)", level: "info" })
      } catch (e: any) {
        lines.push({ msg: `Could not consolidate the source VM disks (${e?.message || e}): run "Consolidate" on the VM in vSphere before migrating it again.`, level: "warn" })
      }
    }
    const logs = (job.logs as unknown as LogLine[] | null) ?? []
    if (logs.some(l => l.msg === CBT_ENABLED_BY_RUN)) {
      try {
        await soapDisableCbt(session, job.sourceVmId)
        lines.push({ msg: "CBT disabled on source again (it was off before the migration)", level: "info" })
      } catch (e: any) {
        lines.push({ msg: `Could not disable CBT on the source again: ${e?.message || e}. It was off before the migration; switch it off in vSphere if you do not want it.`, level: "warn" })
      }
    }
  } finally {
    await soapLogout(session).catch(() => {})
  }
}

/**
 * XCP-ng side: the warm snapshots (snapshot VMs and their VDIs) and the CBT
 * this run switched on. The run logs CBT_ENABLED_BY_RUN_XCPNG only when it
 * switched CBT on for every disk; when some disks already had it, the log
 * does not say which ones were ours, so CBT is left as is and the log says so.
 */
async function cleanXcpngSource(job: { sourceVmId: string; logs: unknown }, conn: { baseUrl: string; apiTokenEnc: string | null; insecureTLS: boolean }, lines: Lines): Promise<void> {
  const { user, password } = splitCreds(decryptSecret(conn.apiTokenEnc!), "root")
  const session = await xapiLogin(conn.baseUrl, user, password, conn.insecureTLS)
  try {
    const vmRef = await xapiVmRefByUuid(session, job.sourceVmId)
    const snaps = await xapiFindSnapshotsByPrefix(session, vmRef, `${XCPNG_SNAPSHOT_PREFIX}-`)
    for (const ref of snaps) {
      try {
        await xapiDestroySnapshot(session, ref)
        lines.push({ msg: `Removed leftover warm snapshot ${ref} and its disks from the source VM`, level: "warn" })
      } catch (e: any) {
        lines.push({ msg: `Could not remove warm snapshot ${ref} (${e?.message || e}); delete it on the XCP-ng pool`, level: "warn" })
      }
    }
    if (snaps.length === 0) lines.push({ msg: "No warm snapshot left on the source VM after the restart", level: "info" })
    const logs = (job.logs as unknown as LogLine[] | null) ?? []
    if (logs.some(l => l.msg === CBT_ENABLED_BY_RUN_XCPNG)) {
      const vm = await xapiGetVmConfig(session, job.sourceVmId)
      let failed = 0
      for (const d of vm.disks) {
        if (!d.vdiRef) continue
        await xapiDisableCbt(session, d.vdiRef).catch(() => { failed++ })
      }
      lines.push(failed === 0
        ? { msg: "CBT disabled on the source disks again (it was off before the migration)", level: "info" }
        : { msg: `Could not disable CBT on ${failed} source disk(s) again. It was off before the migration; switch it off on the XCP-ng pool if you do not want it.`, level: "warn" })
    } else if (logs.some(l => CBT_PARTLY_ENABLED_BY_RUN_XCPNG.test(l.msg))) {
      lines.push({ msg: "CBT was switched on by this run for some source disks only and stays on: check the disks on the XCP-ng pool if you do not want it.", level: "warn" })
    }
  } finally {
    await xapiLogout(session).catch(() => {})
  }
}

/**
 * Clean the source of one swept job. Never throws: boot must not depend on a
 * source hypervisor being reachable, and the job log says what could not be done.
 */
export async function cleanupOrphanedWarmSource(jobId: string, deps: WarmOrphanCleanupDeps = {}): Promise<void> {
  const prisma = deps.prisma ?? globalPrisma
  const now = deps.now ?? (() => new Date())
  const lines: Lines = []
  let hypervisor = "vSphere"
  try {
    const job = await prisma.migrationJob.findUnique({ where: { id: jobId } })
    if (!job || job.status !== "failed" || job.error !== ORPHANED_JOB_ERROR) return
    const config = (job.config ?? {}) as Record<string, any>
    const kind = warmEngineOf(config)
    if (!kind) return
    if (kind === "xcpng") hypervisor = "the XCP-ng pool"

    if (job.targetVmid) {
      lines.push({ msg: `Target VM ${job.targetVmid} on ${job.targetNode} was left as the interrupted run made it. Delete it in Proxmox if you do not keep it; a retry creates a new VM.`, level: "warn" })
    }

    // A newer run of the same VM owns whatever proxcenter-warm-* is there now.
    const newer = await prisma.migrationJob.findFirst({
      where: { id: { not: job.id }, sourceConnectionId: job.sourceConnectionId, sourceVmId: job.sourceVmId, status: { notIn: [...TERMINAL_STATUSES, "queued"] } },
      select: { id: true },
    })
    if (newer) return

    // The run's nbdkit reader outlives the server on the target node and keeps
    // the source disk open (NFC session on vSphere, NBD export on XCP-ng): the
    // snapshot then cannot go cleanly. Stop it first (a reader is only killed
    // when its job is terminal, which this one now is).
    let nodeIp: Awaited<ReturnType<typeof getNodeSshEndpointForMigration>> | null = null
    try {
      const pveConn = await getConnectionById(job.targetConnectionId, job.tenantId)
      nodeIp = await getNodeSshEndpointForMigration(prisma, job.targetConnectionId, job.targetNode, pveConn.baseUrl)
      await sweepOrphanReaders({
        connectionId: job.targetConnectionId, nodeIp, nodeName: job.targetNode, currentJobId: "",
        log: async (msg, level) => { lines.push({ msg, level: level ?? "info" }) },
        prisma,
      })
    } catch (e: any) {
      lines.push({ msg: `Could not stop the copy reader of this run on ${job.targetNode} (${e?.message || e}); the next warm job on that node will.`, level: "warn" })
    }
    if (nodeIp && job.targetVmid) {
      await unmapTargetRbd({ connectionId: job.targetConnectionId, nodeIp, node: job.targetNode, vmid: job.targetVmid, logs: job.logs }, lines)
        .catch((e: any) => { lines.push({ msg: `Could not release the RBD mappings of target VM ${job.targetVmid} on ${job.targetNode} (${e?.message || e})`, level: "warn" }) })
    }

    const conn = await prisma.connection.findUnique({
      where: { id: job.sourceConnectionId },
      select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })
    if (!conn?.apiTokenEnc || conn.type !== (kind === "xcpng" ? "xcpng" : "vmware")) return
    await (kind === "xcpng" ? cleanXcpngSource(job, conn, lines) : cleanVmwareSource(job, conn, lines))
  } catch (e: any) {
    lines.push({ msg: `Could not clean the source VM after the restart (${e?.message || e}): remove any proxcenter-warm-* snapshot from it in ${hypervisor}.`, level: "warn" })
  } finally {
    await appendLogs(prisma, jobId, lines, now).catch(() => {})
  }
}

/** cleanupOrphanedWarmSource for every job the startup sweep failed, one after the other. */
export async function cleanupOrphanedWarmSources(jobIds: string[], deps: WarmOrphanCleanupDeps = {}): Promise<void> {
  for (const id of jobIds) await cleanupOrphanedWarmSource(id, deps)
}
