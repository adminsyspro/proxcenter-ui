/**
 * Split a vzdump task log into one section per guest, extract what each guest's
 * backup did, and derive an honest status (issue #1003).
 *
 * A task status like `job errors` says nothing about what failed. vzdump prunes
 * AFTER the archive is complete, so a guest whose data was written and whose
 * prune (or protected flag, or hook script) failed is reported as
 * "Backup OK, <step> failed" instead of a plain failure.
 *
 * Times in the log are node-local ("Backup started at 2026-09-24 15:30:02") and
 * carry no zone. They are converted with the node's UTC offset when the caller
 * knows it (`utcOffsetSec`, from GET /nodes/{node}/time); otherwise with the
 * offset between the first of them and the task start epoch, floored to 15
 * minutes — floored, not rounded, because the first guest can start minutes
 * after the task (vzdump waits for its global lock), never before. Without
 * either they stay null.
 */

export interface TaskLogLine {
  n: number
  t: string
}

export type GuestStatus = 'ok' | 'ok_warnings' | 'post_step_failed' | 'failed' | 'running'
export type PostStep = 'prune' | 'protected' | 'hook' | 'other'

export interface GuestSection {
  vmid: number
  type: 'qemu' | 'lxc' | null
  name: string | null
  start: number | null
  end: number | null
  durationSec: number | null
  archive: string | null
  namespace: string | null
  transferredBytes: number | null
  reusedBytes: number | null
  reusedPercent: number | null
  zeroBytes: number | null
  archiveSizeBytes: number | null
  warnings: string[]
  errors: string[]
  status: GuestStatus
  step: PostStep | null
  reason: string | null
  lines: TaskLogLine[]
}

export interface ParsedVzdumpLog {
  commandLine: string | null
  guests: GuestSection[]
  jobLines: TaskLogLine[]
  taskError: string | null
  taskWarnings: number
}

/**
 * What the run history needs from a parsed log: per guest its vmid and derived
 * status, plus the task error. Small enough to cache for every task of a
 * cluster; a ParsedVzdumpLog is one too.
 */
export interface TaskLogSummary {
  guests: Array<Pick<GuestSection, 'vmid' | 'status' | 'step' | 'reason'>>
  taskError: string | null
}

export interface ParseOptions {
  taskStart?: number | null
  running?: boolean
  exitStatus?: string | null
  /** The node's UTC offset (local − UTC, seconds); wins over the task-start heuristic. */
  utcOffsetSec?: number | null
}

const RE_COMMAND = /starting new backup job: /
const RE_START = /Starting Backup of VM (\d+) \((qemu|lxc)\)/
const RE_FINISH = /Finished Backup of VM (\d+) \((\d+):(\d{2}):(\d{2})\)/
const RE_FAIL = /Backup of VM (\d+) failed - (.*)$/
const RE_STARTED_AT = /Backup started at (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
const RE_ENDED_AT = /(?:Backup finished at|Failed at) (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/
const RE_NAME = /(?:VM|CT) Name: (.*)$/
const RE_PBS_ARCHIVE = /creating Proxmox Backup Server archive '([^']+)'/
const RE_LOCAL_ARCHIVE = /creating vzdump archive '([^']+)'/
const RE_NAMESPACE = /Starting backup: \[([^\]]*)\]:/
const RE_TRANSFERRED = /transferred ([\d.]+) (\w+) in \d+ seconds/
const RE_PXAR = /: had to backup [\d.]+ \w+ of ([\d.]+) (\w+)/
const RE_REUSED = /backup was done incrementally, reused ([\d.]+) (\w+) \(([\d.]+)%\)/
const RE_ZERO = /backup is sparse: ([\d.]+) (\w+) \([\d.]+%\) total zero data/
const RE_ARCHIVE_SIZE = /archive file size: ([\d.]+)\s*(\w+)/
const RE_TOTAL_WRITTEN = /Total bytes written: (\d+)/
const RE_DATA_WRITTEN = /transferred [\d.]+ \w+ in \d+ seconds|archive file size:|had to backup|Total bytes written:|End Time:/
const RE_TASK_ERROR = /^TASK ERROR: (.*)$/
const RE_TASK_WARNINGS = /^TASK WARNINGS: (\d+)/
const RE_WARN = /^WARN(?:ING)?: /

const UNIT: Record<string, number> = {
  B: 1,
  KIB: 1024, KB: 1024,
  MIB: 1024 ** 2, MB: 1024 ** 2,
  GIB: 1024 ** 3, GB: 1024 ** 3,
  TIB: 1024 ** 4, TB: 1024 ** 4,
}

/** Bytes from a number and a unit as vzdump / PBS print them (all 1024-based). */
export function parseSize(num: string, unit: string): number | null {
  const factor = UNIT[unit.toUpperCase()]
  const n = Number(num)

  return factor && Number.isFinite(n) ? Math.round(n * factor) : null
}

/** "2026-09-24 15:30:02" read as if it were UTC (the node's zone is applied later). */
function naiveEpoch(text: string): number {
  const [d, t] = text.split(' ')
  const [y, mo, da] = d.split('-').map(Number)
  const [h, mi, s] = t.split(':').map(Number)

  return Date.UTC(y, mo - 1, da, h, mi, s) / 1000
}

interface Draft {
  section: GuestSection
  closed: 'finished' | 'failed' | null
  dataWritten: boolean
  naiveStart: number | null
  naiveEnd: number | null
  reusedLines: number
  reusedPercentLine: number | null
  pxarTotal: number | null
}

function newDraft(vmid: number, type: 'qemu' | 'lxc' | null): Draft {
  return {
    section: {
      vmid, type, name: null, start: null, end: null, durationSec: null, archive: null, namespace: null,
      transferredBytes: null, reusedBytes: null, reusedPercent: null, zeroBytes: null, archiveSizeBytes: null,
      warnings: [], errors: [], status: 'running', step: null, reason: null, lines: [],
    },
    closed: null,
    dataWritten: false,
    naiveStart: null,
    naiveEnd: null,
    reusedLines: 0,
    reusedPercentLine: null,
    pxarTotal: null,
  }
}

function add(a: number | null, b: number | null): number | null {
  if (b === null) return a

  return (a ?? 0) + b
}

function readMetrics(d: Draft, t: string): void {
  const s = d.section

  const name = t.match(RE_NAME)
  if (name && s.name === null) s.name = name[1].trim()

  const pbsArchive = t.match(RE_PBS_ARCHIVE)
  if (pbsArchive) s.archive = pbsArchive[1]

  const localArchive = t.match(RE_LOCAL_ARCHIVE)
  if (localArchive) s.archive = localArchive[1]

  const namespace = t.match(RE_NAMESPACE)
  if (namespace) s.namespace = namespace[1] || null

  const transferred = t.match(RE_TRANSFERRED)
  if (transferred) s.transferredBytes = parseSize(transferred[1], transferred[2])

  const pxar = t.match(RE_PXAR)
  if (pxar) d.pxarTotal = add(d.pxarTotal, parseSize(pxar[1], pxar[2]))

  const reused = t.match(RE_REUSED)
  if (reused) {
    s.reusedBytes = add(s.reusedBytes, parseSize(reused[1], reused[2]))
    d.reusedLines++
    d.reusedPercentLine = Number(reused[3])
  }

  const zero = t.match(RE_ZERO)
  if (zero) s.zeroBytes = parseSize(zero[1], zero[2])

  const archiveSize = t.match(RE_ARCHIVE_SIZE)
  if (archiveSize) s.archiveSizeBytes = parseSize(archiveSize[1], archiveSize[2])

  const totalWritten = t.match(RE_TOTAL_WRITTEN)
  if (totalWritten) s.transferredBytes = Number(totalWritten[1])

  const startedAt = t.match(RE_STARTED_AT)
  if (startedAt) d.naiveStart = naiveEpoch(startedAt[1])

  if (RE_DATA_WRITTEN.test(t)) d.dataWritten = true
  if (RE_WARN.test(t)) s.warnings.push(t)
  if (t.startsWith('ERROR: ')) s.errors.push(t)
}

function postStep(reason: string, errors: string[]): PostStep {
  if (reason.includes('error pruning backups') || errors.some(e => e.startsWith("ERROR: prune '"))) return 'prune'
  if (reason.includes('protected flag')) return 'protected'
  if (/hook/i.test(reason)) return 'hook'

  return 'other'
}

function applyDerivedMetrics(d: Draft): void {
  const s = d.section

  if (s.transferredBytes === null && d.pxarTotal !== null) s.transferredBytes = d.pxarTotal
  if (s.reusedBytes === null) return
  if (d.reusedLines === 1 && d.reusedPercentLine !== null) s.reusedPercent = d.reusedPercentLine
  else if (s.transferredBytes) s.reusedPercent = Math.round((s.reusedBytes / s.transferredBytes) * 1000) / 10
}

function applyTimes(d: Draft, offset: number | null): void {
  const s = d.section

  if (offset !== null) {
    if (d.naiveStart !== null) s.start = d.naiveStart - offset
    if (d.naiveEnd !== null) s.end = d.naiveEnd - offset
  }
  if (s.durationSec === null && s.start !== null && s.end !== null) s.durationSec = s.end - s.start
}

function deriveStatus(d: Draft, opts: ParseOptions): void {
  const s = d.section

  if (d.closed === 'finished') {
    s.status = s.warnings.length > 0 ? 'ok_warnings' : 'ok'
    return
  }
  if (d.closed === 'failed') {
    const reason = s.reason ?? ''
    if (d.dataWritten) {
      s.status = 'post_step_failed'
      s.step = postStep(reason, s.errors)
    } else {
      s.status = 'failed'
    }
    return
  }
  if (opts.running) {
    s.status = 'running'
    return
  }
  s.status = 'failed'
  s.reason = opts.exitStatus || 'unknown'
}

function finalise(d: Draft, offset: number | null, opts: ParseOptions): GuestSection {
  applyDerivedMetrics(d)
  applyTimes(d, offset)
  deriveStatus(d, opts)

  return d.section
}

interface ParseCursor {
  drafts: Draft[]
  jobLines: TaskLogLine[]
  commandLine: string | null
  taskError: string | null
  taskWarnings: number
  current: Draft | null
  last: Draft | null
}

/** A guest's first log line ("Starting Backup of VM …"); true when this line was one. */
function tryStart(cursor: ParseCursor, line: TaskLogLine, t: string): boolean {
  const m = t.match(RE_START)
  if (!m) return false

  cursor.current = newDraft(Number(m[1]), m[2] as 'qemu' | 'lxc')
  cursor.drafts.push(cursor.current)
  cursor.current.section.lines.push(line)

  return true
}

/** A guest's failure line; true when this line was one. */
function tryFail(cursor: ParseCursor, line: TaskLogLine, t: string): boolean {
  const m = t.match(RE_FAIL)
  if (!m) return false

  const vmid = Number(m[1])
  // A guest that never started (unknown vmid, lock) only has this line.
  const d: Draft = cursor.current && cursor.current.section.vmid === vmid ? cursor.current : newDraft(vmid, null)
  if (d !== cursor.current) cursor.drafts.push(d)
  d.section.lines.push(line)
  d.section.errors.push(t)
  d.section.reason = m[2].trim()
  d.closed = 'failed'
  cursor.last = d
  cursor.current = null

  return true
}

/** The current guest's finish line; true when this line was one. */
function tryFinish(cursor: ParseCursor, line: TaskLogLine, t: string): boolean {
  const m = t.match(RE_FINISH)
  if (!m || !cursor.current || cursor.current.section.vmid !== Number(m[1])) return false

  cursor.current.section.lines.push(line)
  cursor.current.section.durationSec = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4])
  cursor.current.closed = 'finished'
  cursor.last = cursor.current
  cursor.current = null

  return true
}

/** The last-closed guest's end time, printed after its finish/fail line; true when this line was one. */
function tryEndedAt(cursor: ParseCursor, line: TaskLogLine, t: string): boolean {
  const m = t.match(RE_ENDED_AT)
  if (!m || cursor.current || !cursor.last) return false

  cursor.last.section.lines.push(line)
  cursor.last.naiveEnd = naiveEpoch(m[1])

  return true
}

/** A line outside any guest section: task-level output. */
function readJobLine(cursor: ParseCursor, line: TaskLogLine, t: string): void {
  cursor.jobLines.push(line)
  const err = t.match(RE_TASK_ERROR)
  if (err) cursor.taskError = err[1].trim()
  const warn = t.match(RE_TASK_WARNINGS)
  if (warn) cursor.taskWarnings = Number(warn[1])
}

function processLine(cursor: ParseCursor, line: TaskLogLine): void {
  const t = line.t ?? ''

  if (cursor.commandLine === null && RE_COMMAND.test(t)) cursor.commandLine = t

  if (tryStart(cursor, line, t)) return
  if (tryFail(cursor, line, t)) return
  if (tryFinish(cursor, line, t)) return
  if (tryEndedAt(cursor, line, t)) return

  if (cursor.current) {
    cursor.current.section.lines.push(line)
    readMetrics(cursor.current, t)

    return
  }

  readJobLine(cursor, line, t)
}

/** Parse a whole vzdump task log (the `{n, t}` array PVE returns). */
export function parseVzdumpLog(lines: TaskLogLine[], opts: ParseOptions = {}): ParsedVzdumpLog {
  const cursor: ParseCursor = {
    drafts: [], jobLines: [], commandLine: null, taskError: null, taskWarnings: 0, current: null, last: null,
  }

  for (const line of lines) processLine(cursor, line)

  const firstNaive = cursor.drafts.find(d => d.naiveStart !== null)?.naiveStart ?? null
  let offset: number | null = null
  if (typeof opts.utcOffsetSec === 'number' && Number.isFinite(opts.utcOffsetSec)) offset = opts.utcOffsetSec
  else if (opts.taskStart && firstNaive !== null) offset = Math.floor((firstNaive - opts.taskStart) / 900) * 900

  return {
    commandLine: cursor.commandLine,
    guests: cursor.drafts.map(d => finalise(d, offset, opts)),
    jobLines: cursor.jobLines,
    taskError: cursor.taskError,
    taskWarnings: cursor.taskWarnings,
  }
}

/** Every line of a parsed log back in its original order. */
export function rawLines(log: ParsedVzdumpLog): TaskLogLine[] {
  return [...log.jobLines, ...log.guests.flatMap(g => g.lines)].sort((a, b) => a.n - b.n)
}

/**
 * UTC offset (seconds, local − UTC) of an IANA zone at an instant, so a log
 * written before a DST change is read with the offset it was written with.
 * Null for an unknown zone.
 */
export function zoneOffsetAt(timeZone: string, epochSec: number): number | null {
  if (!timeZone || !Number.isFinite(epochSec)) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(epochSec * 1000))
    const n = (type: string) => Number(parts.find(p => p.type === type)?.value)
    const wall = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) / 1000
    const offset = wall - Math.floor(epochSec)

    return Number.isFinite(offset) ? offset : null
  } catch {
    return null
  }
}

/** The compact part of a parsed log the run history works from. */
export function summarizeVzdumpLog(log: TaskLogSummary): TaskLogSummary {
  return {
    guests: log.guests.map(g => ({ vmid: g.vmid, status: g.status, step: g.step, reason: g.reason })),
    taskError: log.taskError,
  }
}
