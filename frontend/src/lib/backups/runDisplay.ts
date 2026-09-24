/** Presentation mapping of the backup run history (issue #1003), kept out of JSX so it is tested. */

import type { GuestStatus, PostStep } from './vzdumpLog'
import type { RunSummary } from './vzdumpRuns'

export type ChipColor = 'success' | 'warning' | 'error' | 'info'

export interface StatusChip {
  color: ChipColor
  key: string
  /** "failed/total" to append to the label, or null. */
  count: string | null
}

export function runStatusChip(run: Pick<RunSummary, 'status' | 'statusDetail'>): StatusChip {
  const { failed, total, step } = run.statusDetail
  const count = total > 1 ? `${failed}/${total}` : null

  switch (run.status) {
    case 'ok':
      return { color: 'success', key: 'backups.runs.status.ok', count: null }
    case 'warning':
      return { color: 'warning', key: 'backups.runs.status.warning', count: null }
    case 'running':
      return { color: 'info', key: 'backups.runs.status.running', count: null }
    case 'post_step_failed':
      return { color: 'warning', key: `backups.runs.status.post.${step ?? 'other'}`, count }
    case 'partial':
      return { color: 'error', key: 'backups.runs.status.partial', count }
    default:
      return { color: 'error', key: 'backups.runs.status.failed', count: null }
  }
}

export function guestStatusChip(g: { status: GuestStatus; step: PostStep | null }): StatusChip {
  switch (g.status) {
    case 'ok':
      return { color: 'success', key: 'backups.runs.status.ok', count: null }
    case 'ok_warnings':
      return { color: 'warning', key: 'backups.runs.status.warning', count: null }
    case 'running':
      return { color: 'info', key: 'backups.runs.status.running', count: null }
    case 'post_step_failed':
      return { color: 'warning', key: `backups.runs.status.post.${g.step ?? 'other'}`, count: null }
    default:
      return { color: 'error', key: 'backups.runs.status.failed', count: null }
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDurationSec(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '—'
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`

  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`
}

export function logLineKind(text: string): 'error' | 'warning' | 'info' {
  if (/^(TASK )?ERROR:/.test(text)) return 'error'
  if (/^(WARN(ING)?:|TASK WARNINGS:)/.test(text)) return 'warning'

  return 'info'
}

export function isProgressLine(text: string): boolean {
  return /^INFO:\s+\d+% \(/.test(text)
}
