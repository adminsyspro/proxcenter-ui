import useSWR from 'swr'
import { useSWRFetch } from './useSWRFetch'

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

export function useDRSStatus(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/status' : null, fetcher, { refreshInterval: 10000 })
}

export function useDRSRecommendations(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/recommendations' : null, fetcher, { refreshInterval: 15000 })
}

export function useDRSMigrations(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/migrations?active=true' : null, fetcher, { refreshInterval: 10000 })
}

export function useDRSAllMigrations(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/drs/migrations' : null, fetcher, { refreshInterval: 30000 })
}

export function useDRSMetrics(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/metrics' : null, fetcher, { refreshInterval: 30000 })
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
