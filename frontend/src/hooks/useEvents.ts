import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

export function useEvents() {
  const refreshInterval = useRefreshInterval(30000)


return useSWRFetch('/api/v1/events?limit=500', { refreshInterval })
}
