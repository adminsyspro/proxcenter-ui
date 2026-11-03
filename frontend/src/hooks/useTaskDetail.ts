import { useSWRFetch } from './useSWRFetch'

/** How often a running PVE task is asked about while it is shown. */
export const TASK_POLL_MS = 2000

export function useTaskDetail(
  connectionId: string | undefined,
  node: string | undefined,
  upid: string | undefined,
  isRunning: boolean
) {
  const url = connectionId && node && upid
    ? `/api/v1/tasks/${connectionId}/${node}/${encodeURIComponent(upid)}`
    : null

  return useSWRFetch(url, {
    refreshInterval: isRunning ? TASK_POLL_MS : 0,
    revalidateOnFocus: false,
  })
}
