import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

export function useOrchestratorAlerts(enabled: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWRFetch(
    enabled ? '/api/v1/orchestrator/alerts?limit=200' : null,
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
