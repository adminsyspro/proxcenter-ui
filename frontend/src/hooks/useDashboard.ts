import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

export function useDashboard() {
  const refreshInterval = useRefreshInterval(30000)


return useSWRFetch('/api/v1/dashboard', { refreshInterval })
}
