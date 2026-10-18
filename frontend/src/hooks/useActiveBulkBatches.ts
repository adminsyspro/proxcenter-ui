import { useSWRFetch } from "./useSWRFetch"
import { useRefreshInterval } from "./useRefreshInterval"

export interface ActiveBulkBatch {
  id: string
  status: string
  sourceConnectionId: string
  sourceType: string | null
  total: number
  counts: { queued: number; running: number; completed: number; failed: number; cancelled: number }
}

/**
 * Bulk migrations still in flight (roadmap#53), for their taskbar entries.
 * Read from the server, not from page state, so the entries survive a reload
 * and show on every page. A user without vm.migrate gets a 403 and no entry.
 */
export function useActiveBulkBatches() {
  const refreshInterval = useRefreshInterval(15000)
  return useSWRFetch<{ data: ActiveBulkBatch[] }>("/api/v1/migrations/batches?active=1", { refreshInterval })
}
