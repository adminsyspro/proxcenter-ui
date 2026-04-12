import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

export function useRunningTasks() {
  const refreshInterval = useRefreshInterval(15000)
  return useSWRFetch('/api/v1/tasks/running', { refreshInterval, dedupingInterval: 10000 })
}
