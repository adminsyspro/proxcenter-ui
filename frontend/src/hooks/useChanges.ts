import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'

export function useChanges(params?: {
  limit?: number
  resourceType?: string
  connectionId?: string
  action?: string
  resourceId?: string
  node?: string
  from?: string
  to?: string
}) {
  const refreshInterval = useRefreshInterval(30000)
  const searchParams = new URLSearchParams()

  if (params?.limit) searchParams.set('limit', String(params.limit))
  if (params?.resourceType) searchParams.set('resourceType', params.resourceType)
  if (params?.connectionId) searchParams.set('connectionId', params.connectionId)
  if (params?.action) searchParams.set('action', params.action)
  if (params?.resourceId) searchParams.set('resourceId', params.resourceId)
  if (params?.node) searchParams.set('node', params.node)
  if (params?.from) searchParams.set('from', params.from)
  if (params?.to) searchParams.set('to', params.to)

  const query = searchParams.toString()

  return useSWRFetch(`/api/v1/changes${query ? `?${query}` : ''}`, { refreshInterval })
}

export function useRecentChanges(limit = 10) {
  const refreshInterval = useRefreshInterval(15000)

  return useSWRFetch(`/api/v1/changes/recent?limit=${limit}`, { refreshInterval })
}
