import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')
  return res.json()
})

export function useReplicationHealth(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/replication/status' : null, fetcher, { refreshInterval: 15000 })
}

export function useReplicationJobs(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/replication/jobs' : null, fetcher, { refreshInterval: 10000 })
}

export function useRecoveryPlans(isEnterprise: boolean) {
  return useSWR(isEnterprise ? '/api/v1/orchestrator/replication/plans' : null, fetcher, { refreshInterval: 30000 })
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
