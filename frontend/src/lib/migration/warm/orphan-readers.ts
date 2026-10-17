// Sweep of leftover nbdkit readers on a warm node (roadmap#45).
//
// A field node still ran an idle `nbdkit` (holding its own VMware snapshot)
// left by a migration nine days earlier. Every reader this product starts is
// named after its job (`/tmp/proxcenter-vddk-<jobId>-…` for VMware,
// `/tmp/proxcenter-xapi-<jobId>-…` for XCP-ng), so the owner of a process is
// read from its socket path and the database says whether that job is still
// running. Only a reader whose job is TERMINAL is killed: a live job on the
// same node (another warm run, or a peer ProxCenter replica) keeps its reader,
// and so does a job this server has no row for, which it cannot judge.

import { prisma as globalPrisma } from "@/lib/db/prisma"
import { executeSSH } from "@/lib/ssh/exec"
import { TERMINAL_STATUSES } from "@/lib/tasks/sharedTask"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"

export type ReaderFamily = "vddk" | "xapi"

export interface ReaderProcess {
  pid: number
  jobId: string
  family: ReaderFamily
  sock: string
}

/**
 * List every nbdkit this product started on the node, one `<pid> <argv>` line
 * each. `-f` matches the whole command line; the pattern opens with a
 * one-character class so the shell running this very command (whose argv
 * carries the pattern) can never match itself, the same trick as the reader
 * teardown. No match is exit 1 for pgrep, not a failure here.
 */
export function buildOrphanReaderListCmd(): string {
  return `pgrep -a -f '^[n]bdkit .* -U /tmp/proxcenter-(vddk|xapi)-' 2>/dev/null || true`
}

// pgrep -a prints the argv space-joined and unquoted (the single quotes of the
// launch command were consumed by the shell). A job id is a cuid: letters and
// digits only, so the first '-' after it ends it.
const READER_LINE_RE = /^(\d+)\s+nbdkit\s.*?\s-U\s+(\/tmp\/proxcenter-(vddk|xapi)-([A-Za-z0-9_]+)-\S*)/

/** Parse the list command's output; lines that do not carry a job-named socket are ignored. */
export function parseReaderProcesses(output: string | undefined): ReaderProcess[] {
  const out: ReaderProcess[] = []
  for (const raw of (output ?? "").split("\n")) {
    const m = READER_LINE_RE.exec(raw.trim())
    if (!m) continue
    out.push({ pid: Number(m[1]), sock: m[2], family: m[3] as ReaderFamily, jobId: m[4] })
  }
  return out
}

export interface ReaderVerdict {
  /** Job finished (completed/failed/cancelled): the reader has no owner any more. */
  orphans: ReaderProcess[]
  /** Job still running somewhere: never touched. */
  live: ReaderProcess[]
  /** No row for this id on this server: left alone, it cannot be judged. */
  unknown: ReaderProcess[]
}

/** Split the readers by what the database says of their job. `currentJobId` is always live. */
export function classifyReaders(readers: ReaderProcess[], statusByJob: Map<string, string>, currentJobId: string): ReaderVerdict {
  const v: ReaderVerdict = { orphans: [], live: [], unknown: [] }
  for (const r of readers) {
    if (r.jobId === currentJobId) { v.live.push(r); continue }
    const status = statusByJob.get(r.jobId)
    if (status === undefined) v.unknown.push(r)
    else if ((TERMINAL_STATUSES as readonly string[]).includes(status)) v.orphans.push(r)
    else v.live.push(r)
  }
  return v
}

/** A socket path this product creates, nothing else: it goes into a shell pattern below. */
const READER_SOCK_RE = /^\/tmp\/proxcenter-(vddk|xapi)-[A-Za-z0-9_]+-[A-Za-z0-9_.-]+$/

/**
 * Kill the given readers by pid and remove the temp files of their jobs.
 *
 * Every signal is sent only after re-reading that pid's /proc cmdline and
 * finding `nbdkit` serving THAT reader's own socket: the SIGTERM, and again
 * the SIGKILL a second later for a reader wedged in the plugin (what a
 * nine-day-old leftover is). A pid recycled between the listing and either
 * signal, or reused during the one-second grace, is never signalled; neither
 * is the nbdkit of another job that happens to get the same pid.
 */
export function buildOrphanReaderKillCmd(orphans: ReaderProcess[]): string | null {
  const seen = new Set<number>()
  const targets = orphans.filter(o => {
    if (!Number.isInteger(o.pid) || o.pid <= 1 || seen.has(o.pid) || !READER_SOCK_RE.test(o.sock)) return false
    seen.add(o.pid)
    return true
  })
  if (targets.length === 0) return null
  const jobs = [...new Set(targets.map(o => `${o.family}-${o.jobId}`))].filter(j => /^[a-z]+-[A-Za-z0-9_]+$/.test(j))
  const files = jobs.map(j => `/tmp/proxcenter-${j}-*`).join(" ")
  return [
    // chk PID SOCK: the process is nbdkit and serves exactly SOCK.
    `chk() { c=$(tr '\\0' ' ' 2>/dev/null < /proc/$1/cmdline) || return 1; case "$c" in "nbdkit "*" -U $2 "*) return 0;; esac; return 1; }`,
    ...targets.map(o => `chk ${o.pid} '${o.sock}' && kill ${o.pid} 2>/dev/null`),
    `sleep 1`,
    ...targets.map(o => `chk ${o.pid} '${o.sock}' && kill -9 ${o.pid} 2>/dev/null`),
    files ? `rm -f ${files}` : "true",
  ].join("; ")
}

export interface OrphanReaderSweepResult {
  killed: ReaderProcess[]
  kept: ReaderProcess[]
}

/**
 * Run the sweep at the start of a warm job, before this job starts its own
 * readers. Best effort: a listing or kill failure is logged and never fails
 * the migration. The database lookup goes through the global client because
 * a reader may belong to a job of another tenant; the row's status is all
 * that is read. The job log is read by the tenant that runs this migration,
 * so it never names another migration (id, status or socket path, which
 * carries the id): only counts, pids and the node. The detail goes to the
 * server log, for the administrator.
 */
export async function sweepOrphanReaders(a: {
  connectionId: string
  nodeIp: SshTarget
  nodeName: string
  currentJobId: string
  log: (msg: string, level?: "info" | "warn") => Promise<void>
  prisma?: { migrationJob: { findMany: (args: any) => Promise<Array<{ id: string; status: string }>> } }
}): Promise<OrphanReaderSweepResult> {
  const prisma = a.prisma ?? (globalPrisma as any)
  const result: OrphanReaderSweepResult = { killed: [], kept: [] }
  const listed = await executeSSH(a.connectionId, a.nodeIp, buildOrphanReaderListCmd())
  if (!listed.success) {
    await a.log(`Could not list leftover nbdkit readers on ${a.nodeName} (${listed.error || listed.output || "no output"}); continuing`, "warn")
    return result
  }
  const readers = parseReaderProcesses(listed.output)
  if (readers.length === 0) return result

  const ids = [...new Set(readers.map(r => r.jobId))]
  const rows = await prisma.migrationJob.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } })
  const statusByJob = new Map<string, string>(rows.map((r: { id: string; status: string }) => [r.id, r.status]))
  const verdict = classifyReaders(readers, statusByJob, a.currentJobId)
  result.kept.push(...verdict.live, ...verdict.unknown)

  const others = verdict.live.filter(r => r.jobId !== a.currentJobId)
  if (others.length > 0) {
    console.info(`[warm] ${a.currentJobId}: nbdkit readers of running migrations left on ${a.nodeName}: ${others.map(r => `${r.pid} (${r.jobId}, ${statusByJob.get(r.jobId)})`).join(", ")}`)
    await a.log(`${others.length} nbdkit reader(s) of other running migrations on ${a.nodeName} (pid ${others.map(r => r.pid).join(", ")}); left running`)
  }
  if (verdict.unknown.length > 0) {
    console.warn(`[warm] ${a.currentJobId}: nbdkit readers with no migration record on ${a.nodeName}: ${verdict.unknown.map(r => `${r.pid} (${r.sock})`).join(", ")}`)
    await a.log(`${verdict.unknown.length} nbdkit reader(s) on ${a.nodeName} belong to no migration this server knows (pid ${verdict.unknown.map(r => r.pid).join(", ")}); left running`, "warn")
  }
  if (verdict.orphans.length === 0) return result

  const kill = buildOrphanReaderKillCmd(verdict.orphans)
  if (!kill) return result
  const killed = await executeSSH(a.connectionId, a.nodeIp, kill, 60_000)
  if (!killed.success) {
    await a.log(`Could not stop the leftover nbdkit readers on ${a.nodeName} (${killed.error || killed.output || "no output"}); continuing`, "warn")
    result.kept.push(...verdict.orphans)
    return result
  }
  result.killed.push(...verdict.orphans)
  console.warn(`[warm] ${a.currentJobId}: stopped leftover nbdkit readers on ${a.nodeName}: ${verdict.orphans.map(r => `${r.pid} (${r.jobId}, ${statusByJob.get(r.jobId)})`).join(", ")}`)
  await a.log(`Stopped ${verdict.orphans.length} leftover nbdkit reader(s) of finished migrations on ${a.nodeName}: pid ${verdict.orphans.map(r => r.pid).join(", ")}, socket and password files removed`, "warn")
  return result
}
