import { useSWRFetch } from './useSWRFetch'

export function useRunningTasks(refreshInterval = 10000) {
  return useSWRFetch('/api/v1/tasks/running', { refreshInterval })
}
