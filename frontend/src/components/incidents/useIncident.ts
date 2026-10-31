'use client'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { SlaCoverage } from '@/lib/incidents/slaCoverage'
import type { IncidentAlert, IncidentView } from '@/lib/incidents/types'

/** A refusal of the incident routes: the code of the `{error, code}` body, or `GENERIC`. */
export class IncidentApiError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

const ERROR_KEYS: Record<string, string> = {
  ALERT_IN_INCIDENT: 'alertInIncident',
  INCIDENT_CLOSED: 'closed',
  INCIDENT_NOT_RESOLVED: 'notResolved',
  ALERT_ALREADY_ATTACHED: 'alreadyAttached',
  INCIDENT_NOT_FOUND: 'notFound',
}

/** The key of `incidents.errors` that words a failed write; `generic` when the code has no text of its own. */
export function incidentErrorKey(error: unknown): string {
  return (error instanceof IncidentApiError && ERROR_KEYS[error.code]) || 'generic'
}

/** One write on an incident route; a refusal throws an IncidentApiError carrying the code of the body. */
export async function incidentRequest<T = unknown>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let json: any = null

  try {
    json = await res.json()
  } catch {
    // an empty or non JSON body carries no code
  }

  if (!res.ok) throw new IncidentApiError(typeof json?.code === 'string' ? json.code : 'GENERIC')

  return json as T
}

/**
 * Runs one write of the panel: the refresh and the parent notification follow, a refusal comes back as
 * the text to show (null when it went through). `silent` keeps the error out of the panel banner, for a
 * dialog that shows it itself.
 */
export type RunFn = (fn: () => Promise<unknown>, silent?: boolean) => Promise<string | null>

/** One incident with its alerts, comments and actions. */
export function useIncident(id: string | null) {
  return useSWRFetch<IncidentView>(id ? `/api/v1/incidents/${encodeURIComponent(id)}` : null, { revalidateOnFocus: false })
}

/** The alerts that could join an incident; idle while `enabled` is false. */
export function useCandidates(id: string | null, enabled: boolean) {
  return useSWRFetch<{ alerts: IncidentAlert[] }>(
    id && enabled ? `/api/v1/incidents/${encodeURIComponent(id)}/candidates` : null,
    { revalidateOnFocus: false },
  )
}

/**
 * Which alerts of the incident reach the SLA report; read again when its
 * alerts change. Idle without a view.
 */
export function useIncidentCoverage(view: IncidentView | undefined) {
  const alerts = view ? view.alerts.map(a => a.id).join(',') : ''

  return useSWRFetch<SlaCoverage>(
    view ? `/api/v1/incidents/${encodeURIComponent(view.id)}/coverage?alerts=${encodeURIComponent(alerts)}` : null,
    { revalidateOnFocus: false },
  )
}
