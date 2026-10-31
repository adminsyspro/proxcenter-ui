// src/lib/incidents/slaCoverage.ts
//
// Which guest alerts of an incident reach the SLA report. The report of the
// Default tenant only carries the outages of the guests an enabled policy of
// that tenant covers: a vm_down raised for a guest that only another tenant's
// policy covers stays in the register, out of the timeline and the report.
// Node and cluster outages never enter the report.

import { upstreamStatus } from '@/lib/availability/orchestrator'
import { evaluatePolicy } from '@/lib/availability/policies'
import type { QueryResponse } from '@/lib/availability/types'
import { DEFAULT_TENANT_ID, getTenantPrisma } from '@/lib/tenant'

import type { IncidentAlert } from './types'

/** Policies read for the coverage; more than the policies page shows, bounded all the same. */
const POLICIES_MAX = 200

export interface SlaCoverage {
  /** The visible vm_down alerts that no enabled Default policy covers. */
  uncovered: string[]
  /** Whether one alert at least puts the incident in the SLA report. */
  report: boolean
}

const guestKey = (connectionId: string, vmid: number) => `${connectionId}|${vmid}`

/** The guests the enabled policies of the Default tenant cover now, as `connection|vmid` keys. */
async function coveredGuests(now: Date): Promise<Set<string>> {
  const policies = await getTenantPrisma(DEFAULT_TENANT_ID).slaPolicy.findMany({
    where: { enabled: true },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: POLICIES_MAX,
  })
  // The shortest period: only the guests each policy resolves to are read.
  const evaluations = await Promise.all(policies.map(p =>
    evaluatePolicy({ tenantId: DEFAULT_TENANT_ID, scope: null }, p.id, '1h', now).catch((e: unknown): QueryResponse | null => {
      if (upstreamStatus(e) === 404) return null
      throw e
    })))

  return new Set(evaluations.flatMap(ev => (ev?.results ?? []).map(r => guestKey(r.ref.connection_id, r.ref.vmid ?? 0))))
}

/** The coverage of the alerts given, the visible alerts of one incident. */
export async function slaCoverage(alerts: readonly IncidentAlert[], now = new Date()): Promise<SlaCoverage> {
  const guests = alerts.filter(a => a.type === 'vm_down' && a.connection_id && a.resource_id)

  if (guests.length === 0) return { uncovered: [], report: false }

  const covered = await coveredGuests(now)
  const uncovered = guests.filter(a => !covered.has(guestKey(a.connection_id as string, a.resource_id as number))).map(a => a.id)

  return { uncovered, report: uncovered.length < guests.length }
}
