import { alertsApi } from '@/lib/orchestrator/client'
import type { RawOrchestratorAlert } from '@/lib/alerts/dashboardAlertMerge'

/**
 * Orchestrator alerts the dashboard merges into its own evaluation: the active
 * ones to display, and the acknowledged ones whose local copies it hides
 * (#1012). `inScope` is the caller's RBAC gate, since the merge only knows
 * node NAMES, which cannot tell two clusters apart. Any orchestrator error
 * yields nothing: the dashboard still renders its own alerts.
 */
export async function fetchDashboardOrchAlerts(
  inScope?: (alert: RawOrchestratorAlert) => boolean,
): Promise<{ active?: RawOrchestratorAlert[]; acknowledged?: RawOrchestratorAlert[] }> {
  const fetchStatus = async (status: 'active' | 'acknowledged', limit: number) => {
    const response = await alertsApi.getAlerts({ status, limit })
    const data = response.data as any
    const list: RawOrchestratorAlert[] = data?.data || (Array.isArray(data) ? data : [])

    return inScope ? list.filter(inScope) : list
  }

  try {
    const [active, acknowledged] = await Promise.all([
      fetchStatus('active', 100),
      fetchStatus('acknowledged', 500),
    ])

    return { active, acknowledged }
  } catch {
    return {}
  }
}
