import { fetchOrchestratorAlertsByStatus } from '@/lib/alerts/orchestratorAlertFeed'
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
  // Every open alert, like the bell and the alerts page (#1086).
  const fetchStatus = async (status: 'active' | 'acknowledged') => {
    const list: RawOrchestratorAlert[] = await fetchOrchestratorAlertsByStatus(status)

    return inScope ? list.filter(inScope) : list
  }

  try {
    const [active, acknowledged] = await Promise.all([
      fetchStatus('active'),
      fetchStatus('acknowledged'),
    ])

    return { active, acknowledged }
  } catch {
    return {}
  }
}
