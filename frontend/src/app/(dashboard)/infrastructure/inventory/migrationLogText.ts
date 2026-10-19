// Plain-text form of migration log lines, for the copy button of the log
// panels (roadmap#53): one line per entry, `HH:MM:SS level [vm] message`,
// the VM only when the lines mix several VMs (bulk follow-up).

export interface MigrationLogLine {
  ts: string
  level: string
  msg: string
  vmName?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local wall-clock time of the entry, as the panels show it. */
export function logClock(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '--:--:--'
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function migrationLogText(lines: MigrationLogLine[]): string {
  return lines.map(l => l.level === 'step'
    // A phase header (#1000) stands out in the copied text too.
    ? `${logClock(l.ts)} ==${l.vmName ? ` [${l.vmName}]` : ''} ${l.msg} ==`
    : `${logClock(l.ts)} ${l.level || 'info'}${l.vmName ? ` [${l.vmName}]` : ''} ${l.msg}`).join('\n')
}
