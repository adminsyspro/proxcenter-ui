import { useSWRFetch } from './useSWRFetch'

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
    refreshInterval: isRunning ? 2000 : 0,
    revalidateOnFocus: false,
  })
}
