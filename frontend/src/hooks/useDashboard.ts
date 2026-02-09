import { useSWRFetch } from './useSWRFetch'

export function useDashboard(refreshInterval = 30000) {
  return useSWRFetch('/api/v1/dashboard', { refreshInterval })
}
