import useSWR from 'swr'
import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

export function useActiveAlerts(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWRFetch(
    isEnterprise ? '/api/v1/orchestrator/alerts?status=active&limit=10' : null,
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

export function useOrchestratorHealth(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWR(
    isEnterprise ? '/api/v1/orchestrator/health' : null,
    healthFetcher,
    { refreshInterval }
  )
}
