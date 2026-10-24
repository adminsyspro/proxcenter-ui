// A PVE firewall log endpoint over in-memory files, as PVE::Firewall::Helpers
// dump_fw_logfile reads them (ui#1190): without since/until the current file
// only, else every file, rotated ones first, each line filtered by its time.
// `start`/`limit` count the kept lines from the oldest, limit 0 keeps all, and
// an empty read answers PVE's "no content" placeholder.

import { logLineTime } from '@/lib/firewall/logParse'

import type { LogPage, LogPageQuery, LogPageReader } from '@/lib/firewall/logWindow'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n: number) => String(n).padStart(2, '0')

/** A host DROP line logged at `sec` (epoch seconds, UTC), told apart by its source port. */
export function fwLine(sec: number, sport = 1): string {
  const d = new Date(sec * 1000)
  const ts = `${pad(d.getUTCDate())}/${MONTHS[d.getUTCMonth()]}/${d.getUTCFullYear()}:${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} +0000`

  return `0 6 PVEFW-HOST-IN ${ts} DROP: IN=vmbr0 SRC=10.42.0.102 DST=10.42.0.101 PROTO=TCP SPT=${sport} DPT=9997 SYN `
}

/** The logger's own line opening a file at `sec`. */
export const loggerLine = (sec: number) => fwLine(sec).replace(/^0 6 PVEFW-HOST-IN (\S+ \S+) .*$/, '0 5 - $1 starting pvefw logger')

/** `files` oldest first, the current file last; `vmid` keeps that guest's lines, as the guest log does. */
export function pveFirewallLog(files: string[][], vmid?: number): LogPageReader & { calls: LogPageQuery[] } {
  const calls: LogPageQuery[] = []

  const read = async (q: LogPageQuery): Promise<LogPage> => {
    calls.push(q)
    const windowed = q.since !== undefined || q.until !== undefined
    const lines = (windowed ? files.flat() : files.at(-1) ?? []).filter(t => {
      if (vmid !== undefined && !t.startsWith(`${vmid} `)) return false
      if (!windowed) return true
      const sec = Math.floor((logLineTime(t) ?? 0) / 1000)

      return !(q.since && sec < q.since) && !(q.until && sec > q.until)
    })

    if (lines.length === 0) return { total: 1, lines: [{ n: 1, t: 'no content' }] }

    const start = q.start ?? 0
    const kept = lines.slice(start, q.limit === 0 ? undefined : start + q.limit)

    return { total: lines.length, lines: kept.map((t, i) => ({ n: start + i + 1, t })) }
  }

  return Object.assign(read, { calls })
}
