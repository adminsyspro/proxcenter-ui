// src/lib/incidents/validate.ts
//
// Bodies of the incident writes. The bounds are the ones of the orchestrator
// (see the incidents package); a refusal is the short code invalid_body, so a
// request never learns more than that. The author is never read from a body.

import type { ActionPatch, IncidentPatch, OutageKind, OutageQuery } from './types'

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: 'invalid_body' }

export const TITLE_MAX = 200
export const COMMENT_MAX = 4000
export const POSTMORTEM_MAX = 4000
export const ACTION_MAX = 500
/** Same bound as the orchestrator (incidentMaxOutages). */
export const OUTAGES_MAX = 200
/** Same bound as the orchestrator (incidentMaxAlertIDs). */
export const ALERT_IDS_MAX = 500

const OUTAGE_KINDS: readonly OutageKind[] = ['node', 'guest', 'cluster']

/** The JSON body of a request; null when it is missing or not JSON, which every parser refuses. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

const invalid = (): { ok: false; code: 'invalid_body' } => ({ ok: false, code: 'invalid_body' })

function record(body: unknown): Record<string, unknown> | null {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

/** A string of `min`..`max` characters once trimmed, null otherwise. */
function boundedText(v: unknown, min: number, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= min && t.length <= max ? t : null
}

export function parseCommentBody(body: unknown): Parsed<{ body: string; internal: boolean }> {
  const b = record(body)
  if (!b) return invalid()
  const text = boundedText(b.body, 1, COMMENT_MAX)
  if (text === null) return invalid()
  if (b.internal !== undefined && typeof b.internal !== 'boolean') return invalid()
  return { ok: true, value: { body: text, internal: b.internal === true } }
}

export function parseIncidentPatch(body: unknown): Parsed<IncidentPatch> {
  const b = record(body)
  if (!b) return invalid()
  const value: IncidentPatch = {}
  if (b.title !== undefined) {
    const title = boundedText(b.title, 1, TITLE_MAX)
    if (title === null) return invalid()
    value.title = title
  }
  for (const key of ['root_cause', 'impact'] as const) {
    if (b[key] === undefined) continue
    const text = boundedText(b[key], 0, POSTMORTEM_MAX)
    if (text === null) return invalid()
    value[key] = text
  }
  if (Object.keys(value).length === 0) return invalid()
  return { ok: true, value }
}

export function parseActionBody(body: unknown): Parsed<{ text: string }> {
  const b = record(body)
  if (!b) return invalid()
  const text = boundedText(b.text, 1, ACTION_MAX)
  return text === null ? invalid() : { ok: true, value: { text } }
}

export function parseActionPatch(body: unknown): Parsed<ActionPatch> {
  const b = record(body)
  if (!b) return invalid()
  const value: ActionPatch = {}
  if (b.text !== undefined) {
    const text = boundedText(b.text, 1, ACTION_MAX)
    if (text === null) return invalid()
    value.text = text
  }
  if (b.done !== undefined) {
    if (typeof b.done !== 'boolean') return invalid()
    value.done = b.done
  }
  if (Object.keys(value).length === 0) return invalid()
  return { ok: true, value }
}

/** The title of a creation is optional (the orchestrator derives one from the alert). */
export function parseCreateBody(body: unknown): Parsed<{ title: string; alert_id: string }> {
  const b = record(body)
  if (!b) return invalid()
  const alertId = boundedText(b.alert_id, 1, 200)
  if (alertId === null) return invalid()
  let title = ''
  if (b.title !== undefined && b.title !== '') {
    const t = boundedText(b.title, 1, TITLE_MAX)
    if (t === null) return invalid()
    title = t
  }
  return { ok: true, value: { title, alert_id: alertId } }
}

export function parseAttachBody(body: unknown): Parsed<{ alert_id: string }> {
  const b = record(body)
  if (!b) return invalid()
  const alertId = boundedText(b.alert_id, 1, 200)
  return alertId === null ? invalid() : { ok: true, value: { alert_id: alertId } }
}

function isTimestamp(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v))
}

export function parseOutages(body: unknown): Parsed<OutageQuery[]> {
  const b = record(body)
  if (!b || !Array.isArray(b.outages) || b.outages.length > OUTAGES_MAX) return invalid()
  const outages: OutageQuery[] = []
  for (const raw of b.outages) {
    const o = record(raw)
    if (!o) return invalid()
    const connectionId = boundedText(o.connection_id, 1, 64)
    if (connectionId === null) return invalid()
    if (!OUTAGE_KINDS.includes(o.kind as OutageKind)) return invalid()
    if (o.node !== undefined && (typeof o.node !== 'string' || o.node.length > 64)) return invalid()
    if (o.vmid !== undefined && (!Number.isInteger(o.vmid) || (o.vmid as number) < 0)) return invalid()
    if (!isTimestamp(o.from) || !isTimestamp(o.to)) return invalid()
    outages.push({
      connection_id: connectionId,
      kind: o.kind as OutageKind,
      node: (o.node as string | undefined) ?? '',
      vmid: (o.vmid as number | undefined) ?? 0,
      from: o.from,
      to: o.to,
    })
  }
  return { ok: true, value: outages }
}

/** The ids of a by-alerts query, comma separated; null when over the bound. */
export function parseAlertIds(raw: string | null): string[] | null {
  const ids = (raw ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return ids.length > ALERT_IDS_MAX ? null : ids
}
