'use client'

import useSWR from 'swr'
import { dequal } from 'dequal'

import { fetcher } from '@/hooks/useSWRFetch'
import type { IncidentSummary } from '@/lib/incidents/types'

const BASE = '/api/v1/incidents/by-alerts?ids='

// Ids per call: keeps the URL well under the 8 KB a proxy accepts (the route itself takes 500).
export const BATCH_SIZE = 100

const NONE: Record<string, IncidentSummary> = {}

/** The key and the calls both derive from the sorted ids, so a reordering asks for nothing new. */
async function fetchBatches(url: string): Promise<{ incidents: Record<string, IncidentSummary> }> {
  const ids = url.slice(BASE.length).split(',')
  const batches: string[][] = []

  for (let i = 0; i < ids.length; i += BATCH_SIZE) batches.push(ids.slice(i, i + BATCH_SIZE))

  const results = await Promise.all(batches.map(b => fetcher(`${BASE}${b.join(',')}`)))

  return { incidents: Object.assign({}, ...results.map(r => r.incidents)) }
}

/** The incident each of these alerts belongs to; alerts without one are absent from the map. */
export function useAlertIncidents(alertIds: string[], enabled: boolean): Record<string, IncidentSummary> {
  const key = enabled && alertIds.length > 0 ? `${BASE}${[...alertIds].sort().join(',')}` : null
  const { data } = useSWR<{ incidents: Record<string, IncidentSummary> }>(key, fetchBatches, { compare: dequal, revalidateOnFocus: false })

  return data?.incidents ?? NONE
}
