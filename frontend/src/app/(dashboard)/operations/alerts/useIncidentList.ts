'use client'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { IncidentList } from '@/lib/incidents/types'

export const INCIDENT_PAGE_SIZE = 20

export type IncidentStatusFilter = 'all' | 'open' | 'resolved' | 'closed'

/** One page of the incident register, newest first; `enabled` false makes no call. */
export function useIncidentList(status: IncidentStatusFilter, page: number, enabled = true) {
  const params = new URLSearchParams({ limit: String(INCIDENT_PAGE_SIZE), offset: String((page - 1) * INCIDENT_PAGE_SIZE) })

  if (status !== 'all') params.set('status', status)

  return useSWRFetch<IncidentList>(enabled ? `/api/v1/incidents?${params}` : null, { revalidateOnFocus: false })
}
