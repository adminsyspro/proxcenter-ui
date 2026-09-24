/**
 * The command line vzdump prints as the first line of every backup task
 * ("INFO: starting new backup job: vzdump 100 101 --storage pbs --mode snapshot"),
 * parsed, and the same shape rebuilt from a backup job, so a task can be matched
 * to the job that started it (issue #1003).
 *
 * PVE never exposes which job a run belongs to: pvescheduler hands `job-id` to
 * vzdump, but PVE::VZDump::Common::command_line() leaves it out of that line.
 * What the line does carry is every vzdump option of the job, in Perl hash order
 * (so it changes between tasks), with values quoted by PVE::Tools::shellquote,
 * plus `--quiet 1` for a scheduled run.
 */

export interface VzdumpInvocation {
  vmids: number[]
  all: boolean
  pool: string | null
  exclude: number[]
  node: string | null
  quiet: boolean
  /** Every other option, normalised, compared as an unordered map. */
  options: Record<string, string>
}

const START_MARKER = 'starting new backup job: '

/**
 * Job metadata PVE strips before calling vzdump (never part of a run), with the
 * legacy `starttime`/`dow` schedule and `stdout` older jobs may still carry.
 */
const JOB_ONLY_KEYS = [
  'id', 'type', 'enabled', 'schedule', 'comment', 'repeat-missed', 'next-run', 'job-id', 'starttime', 'dow', 'stdout',
]

/** Selection and placement: compared on their own, not as options. */
const SELECTION_KEYS = ['all', 'vmid', 'pool', 'exclude', 'node', 'quiet']

/**
 * Left out of the comparison on both sides: `tmpdir`, `dumpdir` and `script`
 * are restricted to root@pam, so a run started with an API token cannot replay
 * them; `mailnotification` is deprecated and rejected by PVE 9.
 */
const UNMATCHED_KEYS = ['tmpdir', 'dumpdir', 'script', 'mailnotification']

/** Keys an immediate run must not send: everything that is not a replayable vzdump option. */
export const NOT_REPLAYED_KEYS: readonly string[] = [...JOB_ONLY_KEYS, ...SELECTION_KEYS, ...UNMATCHED_KEYS]

const IGNORED = new Set(NOT_REPLAYED_KEYS)

/** vzdump options PVE stores as property strings (`k=v,k=v`), printed with sorted keys. */
const PROPERTY_STRING_KEYS = new Set(['prune-backups', 'fleecing', 'performance'])

interface SplitState {
  out: string[]
  cur: string
  inToken: boolean
  quote: "'" | '"' | null
}

/** One character while inside a quoted run; returns the index to resume from (past an escaped char). */
function consumeQuotedChar(state: SplitState, input: string, i: number): number {
  const c = input[i]

  if (c === state.quote) state.quote = null
  else if (c === '\\' && state.quote === '"' && i + 1 < input.length) state.cur += input[++i]
  else state.cur += c

  return i
}

/** One character outside a quoted run; returns the index to resume from (past an escaped char). */
function consumeUnquotedChar(state: SplitState, input: string, i: number): number {
  const c = input[i]

  if (c === "'" || c === '"') {
    state.quote = c
    state.inToken = true
  } else if (c === '\\' && i + 1 < input.length) {
    state.cur += input[++i]
    state.inToken = true
  } else if (/\s/.test(c)) {
    if (state.inToken) state.out.push(state.cur)
    state.cur = ''
    state.inToken = false
  } else {
    state.cur += c
    state.inToken = true
  }

  return i
}

/**
 * Split a shell-quoted line the way /bin/sh would for the subset PVE emits:
 * blanks separate words, '…' and "…" quote, adjacent quoted parts join
 * (PVE quotes an embedded ' as '"'"').
 */
export function shellSplit(input: string): string[] {
  const state: SplitState = { out: [], cur: '', inToken: false, quote: null }

  let i = 0
  while (i < input.length) {
    const consumed = state.quote ? consumeQuotedChar(state, input, i) : consumeUnquotedChar(state, input, i)
    i = consumed + 1
  }
  if (state.inToken) state.out.push(state.cur)

  return state.out
}

function scalar(value: unknown): string {
  if (value === true) return '1'
  if (value === false) return '0'
  if (Array.isArray(value)) return value.map(scalar).join('\n')

  return String(value).trim()
}

function parsePropertyString(value: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const part of value.split(',')) {
    const item = part.trim()
    if (!item) continue
    const eq = item.indexOf('=')
    if (eq < 0) map[item] = ''
    else map[item.slice(0, eq)] = item.slice(eq + 1)
  }

  return map
}

/** Normalise one option value so a job value and a printed value compare equal. */
export function normalizeVzdumpValue(key: string, value: unknown): string {
  if (PROPERTY_STRING_KEYS.has(key)) {
    const map =
      typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .filter(([, v]) => v !== undefined && v !== null && v !== '')
              .map(([k, v]) => [k, scalar(v)]),
          )
        : parsePropertyString(String(value))

    return Object.keys(map)
      .sort((a, b) => a.localeCompare(b))
      .map(k => (map[k] === '' ? k : `${k}=${map[k]}`))
      .join(',')
  }
  if (key === 'mailto') return String(value).split(/[,;\s]+/).filter(Boolean).join(',')

  return scalar(value)
}

function parseVmidList(value: unknown): number[] {
  return String(value)
    .split(/[,;\s]+/)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
}

const byNumber = (a: number, b: number) => a - b

function buildInvocation(vmids: number[], raw: Record<string, unknown>): VzdumpInvocation {
  const options: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null || value === '' || IGNORED.has(key)) continue
    options[key] = normalizeVzdumpValue(key, value)
  }

  return {
    vmids: [...vmids].sort(byNumber),
    all: raw.all !== undefined && scalar(raw.all) === '1',
    pool: raw.pool ? String(raw.pool) : null,
    exclude: raw.exclude ? parseVmidList(raw.exclude).sort(byNumber) : [],
    node: raw.node ? String(raw.node) : null,
    quiet: raw.quiet !== undefined && scalar(raw.quiet) === '1',
    options,
  }
}

/** Parse the first line of a vzdump task log; null for any other line. */
export function parseVzdumpCommandLine(line: string): VzdumpInvocation | null {
  const at = line.indexOf(START_MARKER)
  if (at < 0) return null

  const tokens = shellSplit(line.slice(at + START_MARKER.length))
  if (tokens[0] !== 'vzdump') return null

  const vmids: number[] = []
  const raw: Record<string, string> = {}
  let i = 1

  for (; i < tokens.length && !tokens[i].startsWith('--'); i++) vmids.push(...parseVmidList(tokens[i]))

  for (; i < tokens.length; i++) {
    if (!tokens[i].startsWith('--')) continue
    const key = tokens[i].slice(2)
    const next = tokens[i + 1]
    let value = '1'
    if (next !== undefined && !next.startsWith('--')) {
      value = next
      i++
    }
    // Repeated options (exclude-path) are printed once per value.
    raw[key] = key in raw ? `${raw[key]}\n${value}` : value
  }

  return buildInvocation(vmids, raw)
}

/** The invocation a backup job produces, from its GET /cluster/backup entry. */
export function jobInvocation(job: Record<string, any>): VzdumpInvocation {
  return buildInvocation(job.vmid !== undefined && job.vmid !== '' ? parseVmidList(job.vmid) : [], job)
}
