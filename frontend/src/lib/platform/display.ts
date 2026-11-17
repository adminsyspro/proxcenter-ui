// Pure presentation helpers of the Platform status tab.

import type { OrchestratorTask, ServiceState } from './types'

/** Dot colours, the same as every status dot in the product. */
export const STATE_COLOR: Record<ServiceState, string> = {
  up: '#4caf50',
  degraded: '#ff9800',
  down: '#f44336',
  unknown: '#9e9e9e'
}

export type TaskState = 'ok' | 'failing' | 'running' | 'idle'

export const TASK_COLOR: Record<TaskState, string> = {
  ok: '#4caf50',
  failing: '#f44336',
  running: '#2196f3',
  idle: '#9e9e9e'
}

/** A task is judged on its LAST run: one old failure does not keep it red. */
export function taskState(task: OrchestratorTask): TaskState {
  if (task.running) return 'running'
  if (task.last_error) return 'failing'

  return task.runs > 0 ? 'ok' : 'idle'
}

/** Failing tasks first, then by name: what needs attention is on page one. */
export function sortTasks(tasks: OrchestratorTask[]): OrchestratorTask[] {
  return [...tasks].sort((a, b) => Number(Boolean(b.last_error)) - Number(Boolean(a.last_error)) || a.name.localeCompare(b.name))
}

/** "@every 1h0m0s" reads "1h", "@every 1m30s" reads "1m30s"; a cron line is left as it is. */
export function formatSchedule(spec: string): string {
  if (!spec.startsWith('@every ')) return spec
  const trimmed = spec.slice(7).replace(/(\D)0[ms](?=\d|$)/g, '$1').replace(/(\D)0s$/, '$1')

  return trimmed || spec.slice(7)
}

export function percent(used: number, total: number): number {
  if (!(total > 0)) return 0

  return Math.min(100, Math.max(0, (used / total) * 100))
}

/** warning from 75 %, error from 90 %: the thresholds of the resource bars. */
export function usageSeverity(pct: number): 'success' | 'warning' | 'error' {
  if (pct >= 90) return 'error'

  return pct >= 75 ? 'warning' : 'success'
}

/** Load average against the core count: at or above 1 per core the host is saturated. */
export function loadSeverity(load: number, cpus: number): 'success' | 'warning' | 'error' {
  if (!(cpus > 0)) return 'success'
  const perCore = load / cpus

  if (perCore >= 1) return 'error'

  return perCore >= 0.7 ? 'warning' : 'success'
}

export function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`

  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1]
]

/** "3 minutes ago" / "in 2 hours" in the viewer's language. */
export function relativeTime(iso: string | null | undefined, nowMs: number, locale: string): string | null {
  const at = iso ? Date.parse(iso) : Number.NaN

  if (!Number.isFinite(at)) return null
  const seconds = Math.round((at - nowMs) / 1000)
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') return fmt.format(Math.trunc(seconds / size), unit)
  }

  return null
}
