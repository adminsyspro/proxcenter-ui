import useSWR from 'swr'
import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

export function useDRSStatus(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/status' : null, fetcher, { refreshInterval })
}

const recsFetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to fetch')
  const data = await res.json()

  // Auto-dismiss stale recommendations in background
  if (Array.isArray(data)) {
    const stale = data.filter((r: any) => r.status === 'stale')
    if (stale.length > 0) {
      for (const r of stale) {
        fetch(`/api/v1/orchestrator/drs/recommendations/${r.id}/reject`, { method: 'POST' }).catch(() => {})
      }
      // Return only non-stale recommendations
      return data.filter((r: any) => r.status !== 'stale')
    }
  }

  return data
}

export function useDRSRecommendations(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(45000)
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/recommendations?validate=true' : null, recsFetcher, { refreshInterval })
}

export function useDRSMigrations(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(15000)
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/migrations?active=true' : null, fetcher, { refreshInterval })
}

export function useDRSAllMigrations(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/migrations' : null, fetcher, { refreshInterval })
}

export function useDRSMetrics(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWR(isEnterprise ? '/api/v1/orchestrator/metrics' : null, fetcher, { refreshInterval })
}

export function useDRSSettings(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/settings' : null, fetcher)
}

export function useDRSRules(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/rules' : null, fetcher)
}

// Migration progress polling - uses SWR with conditional refresh
export function useMigrationProgress(migrationId: string | null, isActive: boolean) {
  return useSWRFetch(
    isActive && migrationId
      ? `/api/v1/orchestrator/drs/migrations/${migrationId}/progress`
      : null,
    { refreshInterval: isActive ? 2000 : 0 }
  )
}
