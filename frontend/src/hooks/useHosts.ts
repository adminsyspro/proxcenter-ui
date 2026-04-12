import { useSWRFetch } from './useSWRFetch'

export function useHostsByConnection(connId: string | null | undefined) {
  return useSWRFetch(
    connId ? `/api/v1/hosts?connId=${encodeURIComponent(connId)}` : null,
    { revalidateOnFocus: false, dedupingInterval: 30000 }
  )
}
