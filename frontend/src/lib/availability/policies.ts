// src/lib/availability/policies.ts
//
// What the SLA policy routes share: the public shape of a policy row, the
// perimeter check of its selector, the evaluation of one policy by the
// orchestrator and the unique-name refusal.

import type { Prisma } from '@prisma/client'

import { getMeasuredConnections, queryAvailability } from './orchestrator'
import type { Period } from './period'
import { periodBounds } from './period'
import type { AvailabilityScope, GuestKey, QueryResponse, Result } from './types'
import { guestsInScope, poolsInScope, scopedClusterGuests, type GuestType, type PolicyInput } from './validate'

export const PAGE_SIZE = 20

export interface PolicyRow {
  id: string
  name: string
  target: number
  guests: Prisma.JsonValue
  tags: string[]
  pools: string[]
  enabled: boolean
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export interface PolicyView {
  id: string
  name: string
  target: number
  guests: GuestKey[]
  tags: string[]
  pools: string[]
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** The stored guests, keeping only well-formed entries. */
function storedGuests(raw: Prisma.JsonValue): GuestKey[] {
  if (!Array.isArray(raw)) return []
  const out: GuestKey[] = []
  for (const g of raw) {
    if (g && typeof g === 'object' && !Array.isArray(g) && typeof g.connectionId === 'string' && typeof g.vmid === 'number') {
      out.push({ connectionId: g.connectionId, vmid: g.vmid })
    }
  }
  return out
}

export function policyView(row: PolicyRow): PolicyView {
  return {
    id: row.id,
    name: row.name,
    target: row.target,
    guests: storedGuests(row.guests),
    tags: row.tags,
    pools: row.pools,
    enabled: row.enabled,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** The Prisma data of a validated policy body. */
export function policyData(input: PolicyInput) {
  return {
    name: input.name,
    target: input.target,
    guests: input.guests as unknown as Prisma.InputJsonValue,
    tags: input.tags,
    pools: input.pools,
    enabled: input.enabled,
  }
}

/** Every ticked guest and every pool selector in the perimeter. */
export async function policyInScope(
  scope: AvailabilityScope | null,
  connectionIds: readonly string[],
  input: PolicyInput,
): Promise<boolean> {
  return poolsInScope(scope, input.pools) && (await guestsInScope(scope, connectionIds, input.guests))
}

/**
 * Whether a ticked guest lies on a connection the registry does not measure:
 * such a guest would have no figure at all. A guest the policy holds already
 * is let through, so that a policy whose connection was unticked meanwhile can
 * still be edited. No guest, no question to the orchestrator.
 */
export async function guestsOnUnmeasured(guests: readonly GuestKey[], kept: readonly GuestKey[] = []): Promise<boolean> {
  const held = new Set(kept.map(g => `${g.connectionId}:${g.vmid}`))
  const added = guests.filter(g => !held.has(`${g.connectionId}:${g.vmid}`))
  if (added.length === 0) return false
  const measured = new Set(await getMeasuredConnections())
  return added.some(g => !measured.has(g.connectionId))
}

/** The stored guests of a policy row. */
export function rowGuests(row: Pick<PolicyRow, 'guests'>): GuestKey[] {
  return storedGuests(row.guests)
}

/** One policy evaluated over the period, within the caller's perimeter. */
export function evaluatePolicy(
  access: { tenantId: string; scope: AvailabilityScope | null },
  policyId: string,
  period: Period,
  now: Date,
): Promise<QueryResponse> {
  const { from, to, slotSeconds } = periodBounds(period, now)
  return queryAvailability({
    from, to, slot_seconds: slotSeconds, tenant_id: access.tenantId, scope: access.scope, policy_id: policyId,
  })
}

export type NamedResult = Result & { name: string | null; type: GuestType | null }

/**
 * The results of a policy with the name and type of each guest, read from the
 * live guest list of its cluster within the perimeter, so the client never
 * resolves a name itself. A deleted guest, one outside the perimeter or one
 * of a cluster that cannot be listed gets null for both.
 */
export async function withGuestNames(scope: AvailabilityScope | null, results: readonly Result[]): Promise<NamedResult[]> {
  const connections = [...new Set(results.filter(r => r.ref.kind === 'guest').map(r => r.ref.connection_id))]
  const lists = await Promise.all(connections.map(id => scopedClusterGuests(scope, id)))
  const byConnection = new Map(connections.map((id, i) => [id, lists[i]]))
  return results.map(r => {
    const info = r.ref.kind === 'guest' && r.ref.vmid !== undefined ? byConnection.get(r.ref.connection_id)?.get(r.ref.vmid) : undefined
    return { ...r, name: info?.name ?? null, type: info?.type ?? null }
  })
}

/** Prisma's unique-constraint violation: two writes raced on the same name. */
export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: unknown } | null)?.code === 'P2002'
}

/** A policy or window id is a cuid; anything else is not a row we would find. */
export function isRowId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)
}
