import { alertsApi } from '@/lib/orchestrator/client'

export type OrchestratorAlertStatus = 'active' | 'acknowledged' | 'resolved'

const PAGE_SIZE = 500

// Open alerts are fetched in full, however old they are: the orchestrator
// sorts by last_seen_at and never refreshes an event alert, so a window of the
// newest rows silently drops the oldest open ones (#1086). This cap only
// guards against a runaway table.
const OPEN_ALERTS_CAP = 10000

// Resolved alerts are history: the newest ones are enough for the list and
// for the "resolved today" counter.
export const RESOLVED_ALERTS_WINDOW = 1000

/**
 * Fetch the orchestrator alerts of one status, paging until the orchestrator's
 * total (or `max`) is reached. Rows of another status are dropped, so callers
 * can trust the status of what they get back.
 */
export async function fetchOrchestratorAlertsByStatus(
  status: OrchestratorAlertStatus,
  opts: { connectionId?: string; max?: number } = {},
): Promise<any[]> {
  const max = opts.max ?? (status === 'resolved' ? RESOLVED_ALERTS_WINDOW : OPEN_ALERTS_CAP)
  const rows: any[] = []

  for (let offset = 0; offset < max; offset += PAGE_SIZE) {
    const limit = Math.min(PAGE_SIZE, max - offset)
    const response = await alertsApi.getAlerts({ connection_id: opts.connectionId, status, limit, offset })
    const body = response.data as any
    const page: any[] = body?.data || (Array.isArray(body) ? body : [])

    rows.push(...page)

    const total = typeof body?.total === 'number' ? body.total : undefined

    if (page.length < limit || (total !== undefined && offset + page.length >= total)) break
  }

  return rows.filter(a => a.status === status)
}

/**
 * Fetch every open alert (active and acknowledged) plus the recent resolved
 * history, or only the statuses asked for.
 */
export async function fetchOrchestratorAlerts(
  statuses: OrchestratorAlertStatus[] = ['active', 'acknowledged', 'resolved'],
  opts: { connectionId?: string } = {},
): Promise<any[]> {
  const lists = await Promise.all(statuses.map(s => fetchOrchestratorAlertsByStatus(s, opts)))

  return lists.flat()
}

/**
 * Keep the most recent row per fingerprint AND status. The status is part of
 * the key so that an older resolved or acknowledged occurrence never hides an
 * alert that is still active, which made the list, the summary and the bell
 * disagree (#1086). `statusOf` lets callers key on the orchestrator status of
 * an alert they re-labelled as silenced.
 */
export function dedupeOrchestratorAlerts<T extends { last_seen_at?: string }>(
  alerts: T[],
  fingerprintOf: (a: T) => string,
  statusOf: (a: T) => string | undefined,
): T[] {
  const latest = new Map<string, T>()

  for (const a of alerts) {
    const key = `${fingerprintOf(a)}|${statusOf(a) || ''}`
    const existing = latest.get(key)

    if (!existing || new Date(a.last_seen_at || 0) > new Date(existing.last_seen_at || 0)) latest.set(key, a)
  }

  return Array.from(latest.values())
}
