import type { PCTask } from '@/contexts/ProxCenterTasksContext'
import type { FrameworkAssessment } from '@/lib/compliance/frameworkAssessment'
import type { NodeCheckResult } from '@/lib/compliance/nodeBreakdown'
import { FRAMEWORK_LOGO_DIR, FRAMEWORK_LOGO_FILES } from '@/lib/compliance/frameworks/logos'

// Public URL of each framework badge, derived from the shared file map so the
// Frameworks tab and the PDF report use the same assets.
export const FRAMEWORK_LOGOS: Record<string, string> = Object.fromEntries(
  Object.entries(FRAMEWORK_LOGO_FILES).map(([id, file]) => [id, `${FRAMEWORK_LOGO_DIR}/${file}`]),
)

export function coverageLabel(a: Pick<FrameworkAssessment, 'assessedControls' | 'totalControls'>): string {
  return `${a.assessedControls} / ${a.totalControls}`
}

export interface BreakdownSegment {
  key: 'satisfied' | 'partial' | 'failed'
  color: string
  pct: number
  count: number
}

export function breakdownSegments(
  a: Pick<FrameworkAssessment, 'satisfied' | 'partial' | 'failed' | 'assessedControls'>,
): BreakdownSegment[] {
  const total = a.assessedControls
  const calc = (count: number) => total > 0 ? Math.round((count / total) * 100) : 0
  return [
    { key: 'satisfied', color: '#22c55e', pct: calc(a.satisfied), count: a.satisfied },
    { key: 'partial',   color: '#f59e0b', pct: calc(a.partial),   count: a.partial },
    { key: 'failed',    color: '#ef4444', pct: calc(a.failed),    count: a.failed },
  ]
}

/** Downloads a file the server sends as an attachment, without leaving the page. */
export function triggerUrlDownload(url: string): void {
  const link = document.createElement('a')
  link.href = url
  link.download = ''
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Where the report-job watcher follows a background report, and where its PDF is. */
export function reportJobTaskUrls(jobId: string): { statusUrl: string; downloadUrl: string } {
  const statusUrl = `/api/v1/compliance/report-jobs/${encodeURIComponent(jobId)}`

  return { statusUrl, downloadUrl: `${statusUrl}/download` }
}

/** The ProxCenter taskbar row of a background report just started. */
export function reportJobTask(jobId: string, label: string, connectionName?: string): PCTask {
  return {
    id: `report-${jobId}`,
    type: 'report',
    label,
    detail: connectionName,
    progress: 0,
    status: 'running',
    createdAt: Date.now(),
    ...reportJobTaskUrls(jobId),
  }
}

export function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

/** Returns the donut color for a given score (null = not assessed). */
export function gaugeColor(score: number | null): string {
  if (score === null) return '#94a3b8'
  return scoreColor(score)
}

const STATUS_ORDER: Record<string, number> = {
  fail: 0,
  warning: 1,
  partial: 2,
  pass: 3,
  satisfied: 4,
  skip: 5,
}

function statusRank(status: string): number {
  const key = status.toLowerCase()
  return STATUS_ORDER[key] ?? 3
}

/** Sorts checks so failing/warning come first, then pass, then skip. */
export function sortNodeChecks(checks: NodeCheckResult[]): NodeCheckResult[] {
  return [...checks].sort((a, b) => statusRank(a.status) - statusRank(b.status))
}

/** Count of non-pass, non-skip checks (fail + warning + partial). */
export function nodeFailCount(checks: NodeCheckResult[]): number {
  return checks.filter(c => {
    const key = c.status.toLowerCase()
    return key !== 'pass' && key !== 'satisfied' && key !== 'skip'
  }).length
}
