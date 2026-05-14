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

export function useVersionCheck(refreshInterval = 3600000, enabled = true) {
  // `enabled` lets the caller skip the GitHub round-trip entirely for
  // tenants — they can't act on a provider-level update notification, so
  // hitting GitHub every hour for them is pure waste.
  return useSWRFetch(enabled ? '/api/v1/version/check' : null, { refreshInterval })
}

/**
 * Active deployments (template/blueprint deploys in progress).
 *
 * Used by the navbar TasksDropdown so a tenant can minimize the deploy
 * wizard and still track the job from the taskbar. Polls every 5s when
 * the dropdown is open, slower when it's closed (mirroring useRunningTasks).
 */
export function useActiveDeployments() {
  const refreshInterval = useRefreshInterval(5000)


return useSWRFetch('/api/v1/templates/deployments?activeOnly=true', { refreshInterval })
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
