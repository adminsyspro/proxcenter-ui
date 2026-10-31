'use client'

import useSWR from 'swr'

import { useIncidentsEnabled } from '@/components/incidents/useIncidentsEnabled'
import { redirectToLoginOnce } from '@/hooks/useSWRFetch'
import type { IncidentAlert, IncidentSummary, OutageQuery } from '@/lib/incidents/types'

export type Outage = OutageQuery

/** What the register holds for one outage: the alerts of the period and the incident that covers them. */
export interface OutageMatch {
  alerts: IncidentAlert[]
  incident: IncidentSummary | null
}

async function fetchMatches(outages: Outage[]): Promise<OutageMatch[]> {
  const res = await fetch('/api/v1/incidents/for-outages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outages }),
  })

  if (!res.ok) {
    if (res.status === 401) redirectToLoginOnce()
    throw new Error(`API error: ${res.status}`)
  }

  const json = await res.json()

  return outages.map((_, i) => json.matches?.[i] ?? { alerts: [], incident: null })
}

/** The incident side of the outages of a bar, one match each, loaded when the bar is looked at: idle without outage or when the register is not on offer. */
export function useOutageMatches(outages: Outage[]): { matches?: OutageMatch[]; isLoading: boolean } {
  const enabled = useIncidentsEnabled()
  const key = enabled && outages.length > 0
    ? ['for-outages', ...outages.flatMap(o => [o.connection_id, o.kind, o.node, o.vmid, o.from, o.to])]
    : null

  const { data, isLoading } = useSWR<OutageMatch[]>(key, () => fetchMatches(outages), {
    dedupingInterval: 30_000,
    revalidateOnFocus: false,
    revalidateOnMount: true,
  })

  return { matches: data, isLoading }
}
