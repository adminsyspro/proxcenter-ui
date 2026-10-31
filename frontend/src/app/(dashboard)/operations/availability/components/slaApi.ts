import type { Summary } from '@/lib/availability/types'

/** Bounds of a target, as the route enforces them (lib/availability/validate, server only). */
export const TARGET_MIN = 90
export const TARGET_MAX = 99.999

/** A refusal of the SLA routes: the short code of the body, or `generic`. */
export class SlaApiError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

const KNOWN_CODES = [
  'guest_out_of_scope',
  'connection_not_measured',
  'target_out_of_scope',
  'name_taken',
  'invalid_target',
  'invalid_window',
  'invalid_name',
  'invalid_reason',
  'invalid_body',
  'invalid_guests',
  'invalid_selector',
  'invalid_scope',
  'invalid_target_ref',
  'invalid_fields',
  'forbidden',
  'not_found',
  'feature_required',
  'orchestrator_unavailable',
] as const

/** The code a refusal falls back to when its body carries none. */
const STATUS_CODES: Record<number, string> = { 503: 'orchestrator_unavailable', 403: 'forbidden' }

/** The code to show for a failed write, collapsed to `generic` when it has no text of its own. */
export function errorCodeOf(error: unknown): string {
  const code = error instanceof SlaApiError ? error.code : ''

  return (KNOWN_CODES as readonly string[]).includes(code) ? code : 'generic'
}

/** One write on a SLA route; a refusal throws a SlaApiError carrying the code of the body. */
export async function slaRequest(url: string, method: 'POST' | 'PUT' | 'DELETE', body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (res.ok) return

  let code = STATUS_CODES[res.status] ?? 'generic'

  try {
    const json = await res.json()

    if (typeof json?.error === 'string') code = json.error
  } catch {
    // No JSON body: the status decides.
  }

  throw new SlaApiError(code)
}

export type PolicyStatus = 'met' | 'atRisk' | 'violated' | 'unmeasured'

/** Share of the allowed down time that must be left for a policy to read as met. */
export const AT_RISK_BUDGET_SHARE = 0.25

/**
 * The state of a policy over the period: unmeasured without an availability,
 * violated under the target, at risk when the budget left is 25% or less of
 * what the target allows, met otherwise.
 */
export function policyStatus(summary: Summary | null, target: number): PolicyStatus {
  if (!summary || summary.availability === null) return 'unmeasured'
  if (summary.availability < target) return 'violated'

  const budget = summary.budget

  if (budget && budget.remaining_seconds <= budget.allowed_seconds * AT_RISK_BUDGET_SHARE) return 'atRisk'

  return 'met'
}

export interface PolicyItem {
  id: string
  name: string
  target: number
  guests: { connectionId: string; vmid: number }[]
  tags: string[]
  pools: string[]
  enabled: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  summary: Summary | null
  guestCount: number
  /** Guests on a connection the registry does not measure: they have no figure. */
  unmeasuredGuests?: number
}

export interface PoliciesResponse {
  data: PolicyItem[]
  total: number
  page: number
  pageSize: number
  defaultTarget: number
}

export interface WindowItem {
  id: string
  scope: 'connection' | 'node' | 'guest' | 'policy'
  connectionId: string | null
  node: string | null
  vmid: number | null
  policyId: string | null
  startsAt: string
  endsAt: string
  reason: string
  createdBy: string
  createdAt: string
}

export interface WindowsResponse {
  data: WindowItem[]
  total: number
  page: number
  pageSize: number
}
