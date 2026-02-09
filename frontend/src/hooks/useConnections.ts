import { useSWRFetch } from './useSWRFetch'

export function useConnections(type?: 'pve' | 'pbs') {
  const url = type ? `/api/v1/connections?type=${type}` : '/api/v1/connections'
  return useSWRFetch(url, { revalidateOnFocus: true })
}

export function usePVEConnections() {
  return useConnections('pve')
}

export function usePBSConnections() {
  return useConnections('pbs')
}
