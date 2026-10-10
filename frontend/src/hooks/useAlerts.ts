import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

// Statuses the orchestrator filters on itself. "all" and "silenced" (a label
// the proxy adds) need the unfiltered feed.
const SERVER_FILTERED_STATUSES = new Set(['active', 'acknowledged', 'resolved'])

export function useOrchestratorAlerts(enabled: boolean, status?: string) {
  const refreshInterval = useRefreshInterval(30000)
  // The status goes to the server so the list holds every alert the summary
  // counts, instead of filtering a window of the newest rows (#1086).
  const statusParam = status && SERVER_FILTERED_STATUSES.has(status) ? `&status=${status}` : ''

  return useSWRFetch(
    enabled ? `/api/v1/orchestrator/alerts?limit=1000${statusParam}` : null,
    { refreshInterval }
  )
}

export function useAlertsSummary(enabled: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWRFetch(
    enabled ? '/api/v1/orchestrator/alerts/summary' : null,
    { refreshInterval }
  )
}

export function useAlertRules(enabled: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWRFetch(
    enabled ? '/api/v1/orchestrator/alerts/rules' : null,
    { refreshInterval }
  )
}

export function useAlertThresholds(enabled: boolean = true) {
  return useSWRFetch(
    enabled ? '/api/v1/settings/alerts/thresholds' : null
  )
}
