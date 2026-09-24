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
const RE_ERROR = /^ERROR: /
const RE_PRUNE_ERROR = /^ERROR: prune '/

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
  let m: RegExpMatchArray | null

  if ((m = t.match(RE_NAME)) && s.name === null) s.name = m[1].trim()
  if ((m = t.match(RE_PBS_ARCHIVE))) s.archive = m[1]
  if ((m = t.match(RE_LOCAL_ARCHIVE))) s.archive = m[1]
  if ((m = t.match(RE_NAMESPACE))) s.namespace = m[1] || null
  if ((m = t.match(RE_TRANSFERRED))) s.transferredBytes = parseSize(m[1], m[2])
  if ((m = t.match(RE_PXAR))) d.pxarTotal = add(d.pxarTotal, parseSize(m[1], m[2]))
  if ((m = t.match(RE_REUSED))) {
    s.reusedBytes = add(s.reusedBytes, parseSize(m[1], m[2]))
    d.reusedLines++
    d.reusedPercentLine = Number(m[3])
  }
  if ((m = t.match(RE_ZERO))) s.zeroBytes = parseSize(m[1], m[2])
  if ((m = t.match(RE_ARCHIVE_SIZE))) s.archiveSizeBytes = parseSize(m[1], m[2])
  if ((m = t.match(RE_TOTAL_WRITTEN))) s.transferredBytes = Number(m[1])
  if ((m = t.match(RE_STARTED_AT))) d.naiveStart = naiveEpoch(m[1])
  if (RE_DATA_WRITTEN.test(t)) d.dataWritten = true
  if (RE_WARN.test(t)) s.warnings.push(t)
  if (RE_ERROR.test(t)) s.errors.push(t)
}

function postStep(reason: string, errors: string[]): PostStep {
  if (reason.includes('error pruning backups') || errors.some(e => RE_PRUNE_ERROR.test(e))) return 'prune'
  if (reason.includes('protected flag')) return 'protected'
  if (/hook/i.test(reason)) return 'hook'

  return 'other'
}

function finalise(d: Draft, offset: number | null, opts: ParseOptions): GuestSection {
  const s = d.section

  if (s.transferredBytes === null && d.pxarTotal !== null) s.transferredBytes = d.pxarTotal
  if (s.reusedBytes !== null) {
    if (d.reusedLines === 1 && d.reusedPercentLine !== null) s.reusedPercent = d.reusedPercentLine
    else if (s.transferredBytes) s.reusedPercent = Math.round((s.reusedBytes / s.transferredBytes) * 1000) / 10
  }

  if (offset !== null) {
    if (d.naiveStart !== null) s.start = d.naiveStart - offset
    if (d.naiveEnd !== null) s.end = d.naiveEnd - offset
  }
  if (s.durationSec === null && s.start !== null && s.end !== null) s.durationSec = s.end - s.start

  if (d.closed === 'finished') {
    s.status = s.warnings.length > 0 ? 'ok_warnings' : 'ok'
  } else if (d.closed === 'failed') {
    const reason = s.reason ?? ''
    if (d.dataWritten) {
      s.status = 'post_step_failed'
      s.step = postStep(reason, s.errors)
    } else {
      s.status = 'failed'
    }
  } else if (opts.running) {
    s.status = 'running'
  } else {
    s.status = 'failed'
    s.reason = opts.exitStatus || 'unknown'
  }

  return s
}

/** Parse a whole vzdump task log (the `{n, t}` array PVE returns). */
export function parseVzdumpLog(lines: TaskLogLine[], opts: ParseOptions = {}): ParsedVzdumpLog {
  const drafts: Draft[] = []
  const jobLines: TaskLogLine[] = []
  let commandLine: string | null = null
  let taskError: string | null = null
  let taskWarnings = 0
  let current: Draft | null = null
  let last: Draft | null = null

  for (const line of lines) {
    const t = line.t ?? ''
    let m: RegExpMatchArray | null

    if (commandLine === null && RE_COMMAND.test(t)) commandLine = t

    if ((m = t.match(RE_START))) {
      current = newDraft(Number(m[1]), m[2] as 'qemu' | 'lxc')
      drafts.push(current)
      current.section.lines.push(line)
      continue
    }

    if ((m = t.match(RE_FAIL))) {
      const vmid = Number(m[1])
      // A guest that never started (unknown vmid, lock) only has this line.
      const d: Draft = current && current.section.vmid === vmid ? current : newDraft(vmid, null)
      if (d !== current) drafts.push(d)
      d.section.lines.push(line)
      d.section.errors.push(t)
      d.section.reason = m[2].trim()
      d.closed = 'failed'
      last = d
      current = null
      continue
    }

    if ((m = t.match(RE_FINISH)) && current && current.section.vmid === Number(m[1])) {
      current.section.lines.push(line)
      current.section.durationSec = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4])
      current.closed = 'finished'
      last = current
      current = null
      continue
    }

    if ((m = t.match(RE_ENDED_AT)) && !current && last) {
      last.section.lines.push(line)
      last.naiveEnd = naiveEpoch(m[1])
      continue
    }

    if (current) {
      current.section.lines.push(line)
      readMetrics(current, t)
      continue
    }

    jobLines.push(line)
    if ((m = t.match(RE_TASK_ERROR))) taskError = m[1].trim()
    if ((m = t.match(RE_TASK_WARNINGS))) taskWarnings = Number(m[1])
  }

  const firstNaive = drafts.find(d => d.naiveStart !== null)?.naiveStart ?? null
  let offset: number | null = null
  if (typeof opts.utcOffsetSec === 'number' && Number.isFinite(opts.utcOffsetSec)) offset = opts.utcOffsetSec
  else if (opts.taskStart && firstNaive !== null) offset = Math.floor((firstNaive - opts.taskStart) / 900) * 900

  return {
    commandLine,
    guests: drafts.map(d => finalise(d, offset, opts)),
    jobLines,
    taskError,
    taskWarnings,
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
