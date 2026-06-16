import { useSWRFetch } from "./useSWRFetch"
import { useRefreshInterval } from "./useRefreshInterval"
import type { SharedTask } from "@/lib/tasks/sharedTask"

/**
 * Poll the tenant-scoped shared migration tasks for the ProxCenter footer.
 * Pauses on a hidden tab (via useRefreshInterval). On a transient error, SWR
 * retains the last-good data so the footer does not flicker to empty.
 */
export function useSharedTasks() {
  const refreshInterval = useRefreshInterval(30000)
  return useSWRFetch<{ data: SharedTask[] }>("/api/v1/tasks/shared", { refreshInterval })
}
