import type { FrameworkAssessment } from '@/lib/compliance/frameworkAssessment'

export function buildReportUrl(frameworkId: string, connectionId: string): string {
  return `/api/v1/compliance/frameworks/${frameworkId}/report?connectionId=${encodeURIComponent(connectionId)}`
}

export function coverageLabel(a: Pick<FrameworkAssessment, 'assessedControls' | 'totalControls'>): string {
  return `${a.assessedControls} / ${a.totalControls}`
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}
