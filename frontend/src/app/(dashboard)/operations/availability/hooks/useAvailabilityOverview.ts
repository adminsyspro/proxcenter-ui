'use client'

import type { CurrentState, Result, Summary } from '@/lib/availability/types'
import type { Period } from '@/lib/availability/period'
import { useSWRFetch } from '@/hooks/useSWRFetch'

import { availabilityErrorKind } from './errorKind'

export interface ConnectionOverview {
  id: string
  name: string
  cluster: Result | null
  nodes: Result[]
  summary: Summary
}

export interface OverviewTiles {
  nodesUp: number
  nodesTotal: number
  clustersQuorate: number
  clustersTotal: number
  nodesMaintenance: number
  coveredGuestsDown: number | null
  coverage: number | null
}

/** Body of GET /api/v1/availability/overview. */
export interface OverviewResponse {
  period: Period
  from: string
  to: string
  connections: ConnectionOverview[]
  current: { states: CurrentState[]; collectedAt: Record<string, string> }
  tiles: OverviewTiles
}

/** The "state and availability" tab data, refreshed every 30 s. A failure (503 included) leaves `data` unset. */
export function useAvailabilityOverview(period: Period) {
  return useSWRFetch<OverviewResponse>(`/api/v1/availability/overview?period=${period}`, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
    // A refusal does not change by asking again: no backoff retry on 403.
    onErrorRetry: (error, key, config, revalidate, opts) => {
      if (availabilityErrorKind(error) === 'forbidden') return

      // Same default policy as SWR: exponential backoff, 5 s base.
      const timeout = ~~((Math.random() + 0.5) * (1 << Math.min(opts.retryCount, 8))) * (config.errorRetryInterval ?? 5000)

      setTimeout(() => revalidate(opts), timeout)
    },
  })
}
