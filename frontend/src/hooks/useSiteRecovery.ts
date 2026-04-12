import useSWR from 'swr'
import { useRefreshInterval } from './useRefreshInterval'

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

export function useReplicationHealth(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(15000)
  return useSWR(isEnterprise ? '/api/v1/orchestrator/replication/status' : null, fetcher, { refreshInterval })
}

export function useReplicationJobs(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(15000)
  return useSWR(isEnterprise ? '/api/v1/orchestrator/replication/jobs' : null, fetcher, { refreshInterval })
}

export function useRecoveryPlans(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(30000)
  return useSWR(isEnterprise ? '/api/v1/orchestrator/replication/plans' : null, fetcher, { refreshInterval })
}

export function useReplicationJobLogs(jobId: string | null, isActive: boolean) {
  return useSWR(
    jobId && isActive ? `/api/v1/orchestrator/replication/jobs/${jobId}/logs` : null,
    fetcher,
    { refreshInterval: isActive ? 5000 : 0 }
  )
}

export function useRecoveryHistory(planId: string | null) {
  return useSWR(
    planId ? `/api/v1/orchestrator/replication/plans/${planId}/history` : null,
    fetcher
  )
}
