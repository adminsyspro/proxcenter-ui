import { useSWRFetch } from './useSWRFetch'

export function useJobs(enabled: boolean, refreshInterval?: number) {
  return useSWRFetch(
    enabled ? '/api/v1/orchestrator/jobs' : null,
    { refreshInterval }
  )
}
