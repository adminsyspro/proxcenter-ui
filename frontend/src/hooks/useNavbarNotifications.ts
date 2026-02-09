import useSWR from 'swr'
import { useSWRFetch } from './useSWRFetch'

export function useActiveAlerts(isEnterprise: boolean, refreshInterval = 30000) {
  return useSWRFetch(
    isEnterprise ? '/api/v1/orchestrator/alerts?status=active&limit=10' : null,
    { refreshInterval }
  )
}

export function useDRSRecommendations(isEnterprise: boolean, hasDRS: boolean, refreshInterval = 30000) {
  return useSWRFetch(
    isEnterprise && hasDRS ? '/api/v1/orchestrator/drs/recommendations' : null,
    { refreshInterval }
  )
}

export function useVersionCheck(refreshInterval = 3600000) {
  return useSWRFetch('/api/v1/version/check', { refreshInterval })
}

// Custom fetcher for orchestrator health that handles syncing state
const healthFetcher = async (url: string) => {
  const res = await fetch(url)
  if (res.ok) {
    const json = await res.json()
    return { status: json.status || 'healthy', components: json.components || null }
  }
  return { status: 'error', components: null }
}

export function useOrchestratorHealth(isEnterprise: boolean, refreshInterval = 30000) {
  return useSWR(
    isEnterprise ? '/api/v1/orchestrator/health' : null,
    healthFetcher,
    { refreshInterval }
  )
}
