import { useSWRFetch } from './useSWRFetch'

export function useCephPerformance(connId: string | null, liveMode: boolean) {
  return useSWRFetch(
    liveMode && connId ? `/api/v1/connections/${encodeURIComponent(connId)}/ceph` : null,
    { refreshInterval: liveMode ? 5000 : 0 }
  )
}

export function useCephRRD(connId: string | null, timeframe: string, liveMode: boolean) {
  return useSWRFetch(
    connId ? `/api/v1/connections/${encodeURIComponent(connId)}/ceph/rrd?timeframe=${timeframe}` : null,
    { refreshInterval: liveMode ? 30000 : 0 }
  )
}
