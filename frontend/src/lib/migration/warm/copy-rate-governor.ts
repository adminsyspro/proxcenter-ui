// Copy rate cap of a running warm reader (copy-rate.ts).
//
// One governor runs per capped reader. Every round it refreshes the job's
// heartbeat (`copyActiveAt`), reads the caps that apply (the batch's, or the
// single migration's own, and the source host's from the source connection),
// counts the copies that share them, and rewrites the reader's rate file over
// SSH when the share changes. Everything it shares goes through the database,
// so copies run by another server instance count too, and a copy whose
// instance died stops counting after HEARTBEAT_TTL_MS. No Proxmox API call.

import { prisma as globalPrisma } from "@/lib/db/prisma"
import { executeSSH } from "@/lib/ssh/exec"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"

import { sourceHostKey } from "../migration-limits"
import { copyRateAt, copyRateShare, describeCopyRate, parseCopyRateLimit, type CopyRateLimit } from "./copy-rate"
import { buildRateFileWriteCmd } from "./rate-file"

/** Rounds of a governor. */
export const COPY_RATE_INTERVAL_MS = 10_000
/** A copy whose heartbeat is older than this no longer shares a cap. */
export const HEARTBEAT_TTL_MS = 30_000

interface JobRow { id: string; batchId: string | null; sourceConnectionId: string; config: unknown }

export interface GovernorDb {
  migrationJob: {
    findUnique: (args: any) => Promise<JobRow | null>
    findMany: (args: any) => Promise<JobRow[]>
    update: (args: any) => Promise<unknown>
  }
  migrationBatch: { findUnique: (args: any) => Promise<{ copyRateLimit: unknown } | null> }
  connection: { findUnique: (args: any) => Promise<{ migrationCopyRateLimitPerHostMBps: number | null } | null> }
}

const defaultDb = (): GovernorDb => globalPrisma as unknown as GovernorDb

/**
 * Last cap written to each job's log by this process, so the line opening
 * every pass (one per sync, every minute while a migration waits) is only
 * written when the cap changed since the previous pass.
 */
const announced = new Map<string, number>()

/**
 * Governors running per job in this process: a job reading several disks at
 * once (XCP-ng without a changed block list) keeps its heartbeat until the
 * last of its readers stops.
 */
const running = new Map<string, number>()

const JOB_SELECT = { id: true, batchId: true, sourceConnectionId: true, config: true }

function plural(n: number): string {
  return `${n} cop${n === 1 ? "y" : "ies"}`
}

/** The share a copy of `jobId` may read at, and why, for the job log. */
export async function resolveCopyRateShare(db: GovernorDb, jobId: string, now: Date): Promise<{ mbps: number; reason: string }> {
  const job = await db.migrationJob.findUnique({ where: { id: jobId }, select: JOB_SELECT })
  if (!job) return { mbps: 0, reason: "no cap" }

  let own: CopyRateLimit | undefined
  if (job.batchId) {
    const batch = await db.migrationBatch.findUnique({ where: { id: job.batchId }, select: { copyRateLimit: true } })
    own = parseCopyRateLimit(batch?.copyRateLimit) ?? undefined
  } else {
    own = parseCopyRateLimit((job.config as Record<string, unknown> | null)?.copyRateLimit) ?? undefined
  }
  const conn = await db.connection.findUnique({ where: { id: job.sourceConnectionId }, select: { migrationCopyRateLimitPerHostMBps: true } })
  const hostCap = conn?.migrationCopyRateLimitPerHostMBps && conn.migrationCopyRateLimitPerHostMBps > 0 ? conn.migrationCopyRateLimitPerHostMBps : 0

  const active = await db.migrationJob.findMany({
    where: {
      copyActiveAt: { gte: new Date(now.getTime() - HEARTBEAT_TTL_MS) },
      OR: [...(job.batchId ? [{ batchId: job.batchId }] : []), { sourceConnectionId: job.sourceConnectionId }],
    },
    select: JOB_SELECT,
  })
  // The job itself counts even before its first heartbeat lands.
  const peers = active.some(j => j.id === job.id) ? active : [...active, job]
  const myHost = sourceHostKey(job.sourceConnectionId, job.config)
  const batchCopies = job.batchId ? peers.filter(j => j.batchId === job.batchId).length : 1
  const hostCopies = peers.filter(j => sourceHostKey(j.sourceConnectionId, j.config) === myHost).length

  const ownMbps = copyRateAt(own, now)
  const ownShare = copyRateShare([{ mbps: ownMbps, copies: batchCopies }])
  const hostShare = copyRateShare([{ mbps: hostCap, copies: hostCopies }])
  const mbps = copyRateShare([{ mbps: ownMbps, copies: batchCopies }, { mbps: hostCap, copies: hostCopies }])
  if (mbps === 0) return { mbps, reason: "no cap" }
  if (hostShare > 0 && (ownShare === 0 || hostShare < ownShare)) {
    return { mbps, reason: `source host cap ${describeCopyRate(hostCap)} shared by ${plural(hostCopies)}` }
  }
  if (!job.batchId) return { mbps, reason: `migration cap ${describeCopyRate(ownMbps)}` }
  return { mbps, reason: `batch cap ${describeCopyRate(ownMbps)} shared by ${plural(batchCopies)}` }
}

export interface CopyRateGovernor {
  /** Share the reader must start at (its `rate=`), 0 = unlimited. */
  initialMbps: number
  /** Start the rounds, once the reader is attached. */
  start(): void
  /** Stop the rounds and clear the heartbeat. Never throws. */
  stop(): Promise<void>
}

/**
 * Create the governor of one capped reader: computes its initial share and
 * marks the copy active. A database or SSH failure never fails the copy: the
 * last share stays in force, and a failed write is logged once until one
 * succeeds again.
 */
export async function startCopyRateGovernor(a: {
  jobId: string
  sock: string
  run: (cmd: string) => Promise<{ success: boolean; error?: string }>
  log: (msg: string, level?: "info" | "warn") => Promise<void>
  db?: GovernorDb
  now?: () => Date
  intervalMs?: number
}): Promise<CopyRateGovernor> {
  const db = a.db ?? defaultDb()
  const now = a.now ?? (() => new Date())
  const intervalMs = a.intervalMs ?? COPY_RATE_INTERVAL_MS
  const beat = () => db.migrationJob.update({ where: { id: a.jobId }, data: { copyActiveAt: now() } }).catch(() => {})

  let current = 0
  try {
    const first = await resolveCopyRateShare(db, a.jobId, now())
    current = first.mbps
    const changed = announced.has(a.jobId) ? announced.get(a.jobId) !== current : current > 0
    announced.set(a.jobId, current)
    if (changed) await a.log(`Copy rate cap ${describeCopyRate(current)} (${first.reason})`, "info").catch(() => {})
  } catch {
    current = 0
  }
  await beat()
  running.set(a.jobId, (running.get(a.jobId) ?? 0) + 1)

  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let warned = false

  const round = async () => {
    await beat()
    let next: { mbps: number; reason: string }
    try {
      next = await resolveCopyRateShare(db, a.jobId, now())
    } catch {
      return
    }
    if (next.mbps === current || stopped) {
      // Nothing to write: a past outage is over as far as this copy goes.
      warned = false
      return
    }
    const res = await a.run(buildRateFileWriteCmd(a.sock, next.mbps)).catch((e: any) => ({ success: false, error: String(e?.message || e) }))
    // A write held up by a slow node must not let the heartbeat lapse for the peers.
    await beat()
    if (!res.success) {
      if (!warned) await a.log(`Could not change the copy rate cap to ${describeCopyRate(next.mbps)} (${res.error || "no reason"}); the copy goes on at ${describeCopyRate(current)}`, "warn").catch(() => {})
      warned = true
      return
    }
    warned = false
    current = next.mbps
    announced.set(a.jobId, current)
    await a.log(`Copy rate cap now ${describeCopyRate(current)} (${next.reason})`, "info").catch(() => {})
  }

  const schedule = () => {
    if (stopped) return
    // The next round is planned once this one is over, never on a fixed interval.
    timer = setTimeout(() => {
      inFlight = round().finally(() => { inFlight = undefined; schedule() })
    }, intervalMs)
  }

  return {
    initialMbps: current,
    start: () => { if (!stopped && !timer) schedule() },
    stop: async () => {
      if (stopped) return
      stopped = true
      if (timer) clearTimeout(timer)
      await inFlight?.catch(() => {})
      const left = (running.get(a.jobId) ?? 1) - 1
      if (left > 0) {
        running.set(a.jobId, left)
        return
      }
      running.delete(a.jobId)
      await db.migrationJob.update({ where: { id: a.jobId }, data: { copyActiveAt: null } }).catch(() => {})
    },
  }
}

/**
 * The governor of a reader the pipelines open, or null on a pass that is not
 * capped (the final cutover pass): the reader then starts unlimited and the
 * copy does not count against any cap. The rate file is written on the target
 * node, where the reader runs.
 */
export async function openCopyRateGovernor(a: {
  capped: boolean
  jobId: string
  connectionId: string
  nodeIp: SshTarget
  sock: string
  log: (msg: string, level?: "info" | "warn") => Promise<void>
  db?: GovernorDb
}): Promise<CopyRateGovernor | null> {
  if (!a.capped) return null
  return startCopyRateGovernor({ jobId: a.jobId, sock: a.sock, log: a.log, db: a.db, run: cmd => executeSSH(a.connectionId, a.nodeIp, cmd) })
}
