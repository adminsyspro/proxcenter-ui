// src/lib/availability/windows.ts
//
// What the maintenance window routes share: the public shape of a window row
// and the perimeter check of its target.

import type { AvailabilityScope } from './types'
import { windowTargetInScope, type WindowInput } from './validate'

export interface WindowRow {
  id: string
  scope: string
  connectionId: string | null
  node: string | null
  vmid: number | null
  policyId: string | null
  startsAt: Date
  endsAt: Date
  reason: string
  createdBy: string
  createdAt: Date
}

export function windowView(row: WindowRow) {
  return {
    id: row.id,
    scope: row.scope,
    connectionId: row.connectionId,
    node: row.node,
    vmid: row.vmid,
    policyId: row.policyId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  }
}

export function windowData(input: WindowInput) {
  return {
    scope: input.scope,
    connectionId: input.connectionId,
    node: input.node,
    vmid: input.vmid,
    policyId: input.policyId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    reason: input.reason,
  }
}

/**
 * The code refusing the target of a window, null when it lies in the
 * perimeter. A policy window needs a policy of the tenant (`policyExists`).
 */
export async function windowTargetError(
  scope: AvailabilityScope | null,
  connectionIds: readonly string[],
  input: WindowInput,
  policyExists: (id: string) => Promise<boolean>,
): Promise<string | null> {
  if (input.scope === 'policy') {
    return input.policyId !== null && (await policyExists(input.policyId)) ? null : 'target_out_of_scope'
  }
  if (await windowTargetInScope(scope, connectionIds, input)) return null
  return input.scope === 'guest' ? 'guest_out_of_scope' : 'target_out_of_scope'
}
