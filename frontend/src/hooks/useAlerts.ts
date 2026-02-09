import { useSWRFetch } from './useSWRFetch'

export function useOrchestratorAlerts(enabled: boolean, refreshInterval = 30000) {
  return useSWRFetch(
    enabled ? '/api/v1/orchestrator/alerts?limit=200' : null,
    { refreshInterval }
  )
}

export function useAlertsSummary(enabled: boolean, refreshInterval = 30000) {
  return useSWRFetch(
    enabled ? '/api/v1/orchestrator/alerts/summary' : null,
    { refreshInterval }
  )
}

export function useAlertRules(enabled: boolean, refreshInterval = 30000) {
  return useSWRFetch(
    enabled ? '/api/v1/orchestrator/alerts/rules' : null,
    { refreshInterval }
  )
}

export function useAlertThresholds(enabled: boolean) {
  return useSWRFetch(
    enabled ? '/api/v1/orchestrator/alerts/thresholds' : null
  )
}
