// The background compliance reports the notification bell lists: finished
// (with their PDF) or failed, until the user removes them or the server has
// dropped the PDF. Read from the ProxCenter tasks the report watcher updates.
import type { PCTask } from '@/contexts/ProxCenterTasksContext'
import { REPORT_JOB_TTL_MS } from '@/lib/compliance/report/reportJobConstants'

export interface ReportBellItem {
  taskId: string
  label: string
  connectionName?: string
  status: 'done' | 'error'
  error?: string
  downloadUrl?: string
  finishedAt: number
}

export function reportBellItems(tasks: PCTask[], now: number = Date.now()): ReportBellItem[] {
  return tasks
    .filter(t => t.type === 'report' && (t.status === 'done' || t.status === 'error') && !t.dismissed)
    .map(t => ({
      taskId: t.id,
      label: t.label,
      connectionName: t.detail,
      status: t.status as 'done' | 'error',
      error: t.error,
      downloadUrl: t.status === 'done' ? t.downloadUrl : undefined,
      finishedAt: t.finishedAt ?? t.createdAt,
    }))
    // Offered only while the server still holds the report (a failure leaves with it).
    .filter(item => now - item.finishedAt < REPORT_JOB_TTL_MS)
    .sort((a, b) => b.finishedAt - a.finishedAt)
}
