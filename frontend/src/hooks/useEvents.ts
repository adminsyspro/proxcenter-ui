import { useSWRFetch } from './useSWRFetch'

export function useEvents(refreshInterval = 30000) {
  return useSWRFetch('/api/v1/events?limit=500', { refreshInterval })
}
