import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

export function useTaskEvents(limit = 50) {
  const refreshInterval = useRefreshInterval(30000)


return useSWRFetch(`/api/v1/events?limit=${limit}&source=tasks`, { refreshInterval })
}
