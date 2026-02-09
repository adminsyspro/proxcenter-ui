import { useSWRFetch } from './useSWRFetch'

export function useTaskEvents(limit = 50, refreshInterval = 30000) {
  return useSWRFetch(`/api/v1/events?limit=${limit}&source=tasks`, { refreshInterval })
}
