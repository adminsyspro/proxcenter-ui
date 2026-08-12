/**
 * PVE firewall log levels — single source of truth.
 *
 * These nine values are what Proxmox accepts for the `log` parameter of a
 * firewall rule (cluster, host, VM/CT and security group rules alike) and
 * for the `log_level_in` / `log_level_out` firewall options. The order
 * mirrors the Proxmox web UI: `nolog` first (the default: no logging at
 * all), then the syslog severities from the most to the least severe.
 *
 * Kept in a React-free module so both the value list and the resolver can
 * be unit tested, and re-exported from `shared.tsx` for the components
 * that already import their firewall constants from there.
 */
export const LOG_LEVELS = ['nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

/** PVE's own default. Never send an empty string as a log level. */
export const DEFAULT_LOG_LEVEL: LogLevel = 'nolog'

/**
 * Coerce whatever PVE returned (or nothing at all) into a level a `<Select>`
 * can render. A missing or unrecognised value falls back to `nolog` rather
 * than leaking an out-of-range value into MUI, which would render an empty
 * control and warn in the console.
 */
export function resolveLogLevel(value?: string | null): LogLevel {
  const candidate = (value ?? '').trim().toLowerCase()

  return (LOG_LEVELS as readonly string[]).includes(candidate) ? (candidate as LogLevel) : DEFAULT_LOG_LEVEL
}

/**
 * How a rule's log level reads in a rules table: the level itself, or a dash
 * when the rule logs nothing. `nolog` is noise in a list — most rules carry
 * it — so it collapses to `-` (rendered dimmed) exactly like an absent,
 * empty or unrecognised value, which all mean "no logging" too.
 *
 * The single source of truth for the display form: the `=== 'nolog'` check
 * belongs here, not inlined in each of the five rules tables.
 */
export function formatLogLevel(value?: string | null): string {
  const level = resolveLogLevel(value)

  return level === 'nolog' ? '-' : level
}
