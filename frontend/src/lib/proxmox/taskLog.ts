import type { PveConn } from '@/lib/connections/getConnection'
import type { TaskLogLine } from '@/lib/backups/vzdumpLog'
import { pveFetch } from '@/lib/proxmox/client'

/** PVE returns 50 lines by default; long tasks need paging (multi-TiB migrations, big vzdump jobs). */
export const TASK_LOG_BATCH = 5000
/** Safety cap so a runaway log cannot loop forever. */
export const TASK_LOG_MAX_LINES = 100_000

function logPath(node: string, upid: string, start: number, limit: number): string {
  return `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/log?start=${start}&limit=${limit}`
}

/** The whole log of a PVE task, paged in batches of TASK_LOG_BATCH lines. */
export async function fetchTaskLog(
  conn: PveConn,
  node: string,
  upid: string,
  maxLines = TASK_LOG_MAX_LINES,
): Promise<TaskLogLine[]> {
  let logs: TaskLogLine[] = []
  let start = 0

  while (logs.length < maxLines) {
    const batch = await pveFetch<TaskLogLine[]>(conn, logPath(node, upid, start, TASK_LOG_BATCH))
    if (!Array.isArray(batch) || batch.length === 0) break
    logs = logs.concat(batch)
    if (batch.length < TASK_LOG_BATCH) break
    start += batch.length
  }

  return logs.slice(0, maxLines)
}

/** The first line of a task log, or null when the log is empty. */
export async function fetchTaskFirstLine(conn: PveConn, node: string, upid: string): Promise<string | null> {
  const batch = await pveFetch<TaskLogLine[]>(conn, logPath(node, upid, 0, 1))

  return Array.isArray(batch) && batch[0]?.t ? batch[0].t : null
}
