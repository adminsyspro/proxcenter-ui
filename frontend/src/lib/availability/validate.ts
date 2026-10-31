// src/lib/availability/validate.ts
//
// Bodies of the SLA policy and maintenance window writes, and the check that
// what they target lies in the caller's perimeter. Every refusal is a short
// code: a tenant must not learn a name outside its scope from an error.
//
// A guest of a connection the tenant sees only in part (vDC) is checked
// against the live guest list of the cluster, like the guest routes do
// (lib/vdc/guestScope): it must sit in a pool of the perimeter, the same rule
// as AllowsGuest in the orchestrator.
// The orchestrator filters by the same perimeter when it resolves a policy;
// this check refuses the write up front instead of storing a dead entry.

import { getConnectionById } from '@/lib/connections/getConnection'
import { safeLog } from '@/lib/log/sanitize'
import { pveFetch } from '@/lib/proxmox/client'

import { TARGET_MAX, TARGET_MIN } from './limits'
import { allowsNode, connScope } from './scope'
import type { AvailabilityScope, GuestKey } from './types'

export { TARGET_MAX, TARGET_MIN }

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export const NAME_MAX = 120
/** Same bound as the orchestrator (availability.MaxObjects). */
export const GUESTS_MAX = 5000
export const LABELS_MAX = 100
export const REASON_MAX = 500
export const WINDOW_MAX_MS = 31 * 24 * 3600 * 1000

export const WINDOW_SCOPES = ['connection', 'node', 'guest', 'policy'] as const
export type WindowScope = (typeof WINDOW_SCOPES)[number]

// Connection ids are cuids; node names follow the PVE rule.
const CONNECTION_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/
const NODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,63}$/

export interface PolicyInput {
  name: string
  target: number
  guests: GuestKey[]
  tags: string[]
  pools: string[]
  enabled: boolean
}

export interface WindowInput {
  scope: WindowScope
  connectionId: string | null
  node: string | null
  vmid: number | null
  policyId: string | null
  startsAt: Date
  endsAt: Date
  reason: string
}

const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isVmid(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 1_000_000_000
}

export function isConnectionId(v: unknown): v is string {
  return typeof v === 'string' && CONNECTION_ID_RE.test(v)
}

/** A list of labels (tags, pools): trimmed, deduplicated, bounded. null when malformed. */
function parseLabels(v: unknown): string[] | null {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > LABELS_MAX) return null
  const out = new Set<string>()
  for (const item of v) {
    if (typeof item !== 'string') return null
    const label = item.trim()
    if (!label || label.length > 128) return null
    out.add(label)
  }
  return [...out]
}

function parseGuests(v: unknown): GuestKey[] | null {
  if (v === undefined) return []
  if (!Array.isArray(v) || v.length > GUESTS_MAX) return null
  const seen = new Map<string, GuestKey>()
  for (const item of v) {
    if (!isRecord(item) || !isConnectionId(item.connectionId) || !isVmid(item.vmid)) return null
    seen.set(`${item.connectionId}:${item.vmid}`, { connectionId: item.connectionId, vmid: item.vmid })
  }
  return [...seen.values()]
}

export const PAGE_MAX = 10_000

/** The `page` query parameter: absent is 1, else a whole number from 1 to 10000; null when invalid. */
export function parsePage(value: string | null): number | null {
  if (value === null || value === '') return 1
  if (!/^\d{1,5}$/.test(value)) return null
  const page = Number(value)
  return page >= 1 && page <= PAGE_MAX ? page : null
}

export function isValidTarget(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= TARGET_MIN && v <= TARGET_MAX
}

export function parsePolicyBody(body: unknown): Parsed<PolicyInput> {
  if (!isRecord(body)) return fail('invalid_body')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > NAME_MAX) return fail('invalid_name')
  if (!isValidTarget(body.target)) return fail('invalid_target')
  const guests = parseGuests(body.guests)
  if (guests === null) return fail('invalid_guests')
  const tags = parseLabels(body.tags)
  const pools = parseLabels(body.pools)
  if (tags === null || pools === null) return fail('invalid_selector')
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return fail('invalid_body')
  return { ok: true, value: { name, target: body.target, guests, tags, pools, enabled: body.enabled !== false } }
}

// ISO 8601 with an explicit offset: a time without one would be read in the
// server's zone, not the user's.
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string' || !ISO_WITH_OFFSET.test(v)) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function parseWindowBody(body: unknown): Parsed<WindowInput> {
  if (!isRecord(body)) return fail('invalid_body')
  const scope = body.scope
  if (typeof scope !== 'string' || !(WINDOW_SCOPES as readonly string[]).includes(scope)) return fail('invalid_scope')
  const startsAt = parseDate(body.startsAt)
  const endsAt = parseDate(body.endsAt)
  if (!startsAt || !endsAt || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > WINDOW_MAX_MS) {
    return fail('invalid_window')
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason || reason.length > REASON_MAX) return fail('invalid_reason')

  const value: WindowInput = {
    scope: scope as WindowScope, connectionId: null, node: null, vmid: null, policyId: null, startsAt, endsAt, reason,
  }
  if (scope === 'policy') {
    if (typeof body.policyId !== 'string' || !CONNECTION_ID_RE.test(body.policyId)) return fail('invalid_target_ref')
    value.policyId = body.policyId
    return { ok: true, value }
  }
  if (!isConnectionId(body.connectionId)) return fail('invalid_target_ref')
  value.connectionId = body.connectionId
  if (scope === 'node') {
    if (typeof body.node !== 'string' || !NODE_RE.test(body.node)) return fail('invalid_target_ref')
    value.node = body.node
  }
  if (scope === 'guest') {
    if (!isVmid(body.vmid)) return fail('invalid_target_ref')
    value.vmid = body.vmid
  }
  return { ok: true, value }
}

type ClusterGuest = { vmid?: unknown; name?: unknown; node?: unknown; pool?: unknown; type?: unknown }

export type GuestType = 'qemu' | 'lxc'
export interface GuestInfo {
  name: string | null
  type: GuestType
}

/**
 * The guests of a connection that lie in the perimeter, by vmid, read from
 * the live guest list of the cluster: every guest of a connection seen whole,
 * else those in a pool of the perimeter, whatever their node (the pool is
 * what makes a guest part of a vDC, same as AllowsGuest in scope.go). null
 * when the connection is not visible or the cluster cannot be listed.
 */
export async function scopedClusterGuests(
  scope: AvailabilityScope | null,
  connectionId: string,
): Promise<Map<number, GuestInfo> | null> {
  const entry = connScope(scope, connectionId)
  if (entry === null) return null
  const pools = new Set(entry.pools ?? [])
  if (!entry.all && !pools.size) return new Map()
  let resources: unknown
  try {
    resources = await pveFetch<unknown>(await getConnectionById(connectionId), '/cluster/resources?type=vm')
  } catch (e) {
    console.error('[availability] guest list', safeLog(e instanceof Error ? e.message : e))
    return null
  }
  if (!Array.isArray(resources)) return null
  const guests = new Map<number, GuestInfo>()
  for (const row of resources as ClusterGuest[]) {
    if (row?.type !== 'qemu' && row?.type !== 'lxc') continue
    if (!entry.all && !(typeof row.pool === 'string' && pools.has(row.pool))) continue
    guests.set(Number(row.vmid), { name: typeof row.name === 'string' && row.name ? row.name : null, type: row.type })
  }
  return guests
}

/**
 * Whether every guest lies in the perimeter: its connection visible, and for
 * a connection seen in part, the guest in one of its pools. A cluster that
 * cannot be listed fails closed.
 */
export async function guestsInScope(
  scope: AvailabilityScope | null,
  connectionIds: readonly string[],
  guests: readonly GuestKey[],
): Promise<boolean> {
  const byConnection = new Map<string, number[]>()
  for (const g of guests) {
    if (!connectionIds.includes(g.connectionId)) return false
    const list = byConnection.get(g.connectionId) ?? []
    list.push(g.vmid)
    byConnection.set(g.connectionId, list)
  }
  for (const [connectionId, vmids] of byConnection) {
    const entry = connScope(scope, connectionId)
    if (entry === null) return false
    if (entry.all) continue
    const allowed = await scopedClusterGuests(scope, connectionId)
    if (allowed === null || !vmids.every(v => allowed.has(v))) return false
  }
  return true
}

/** A pool selector names a pool of the perimeter (any pool for a connection seen whole). */
export function poolsInScope(scope: AvailabilityScope | null, pools: readonly string[]): boolean {
  if (scope === null) return true
  const entries = Object.values(scope.connections)
  return pools.every(pool => entries.some(c => c.all || (c.pools ?? []).includes(pool)))
}

/**
 * Whether the target of a connection, node or guest window lies in the
 * perimeter. A connection-wide window needs the whole connection; a policy
 * window is checked by the route against the tenant's policies.
 */
export async function windowTargetInScope(
  scope: AvailabilityScope | null,
  connectionIds: readonly string[],
  w: Pick<WindowInput, 'scope' | 'connectionId' | 'node' | 'vmid'>,
): Promise<boolean> {
  if (w.scope === 'policy') return true
  if (w.connectionId === null || !connectionIds.includes(w.connectionId)) return false
  switch (w.scope) {
    case 'connection':
      return connScope(scope, w.connectionId)?.all === true
    case 'node':
      return w.node !== null && allowsNode(scope, w.connectionId, w.node)
    case 'guest':
      return w.vmid !== null && guestsInScope(scope, connectionIds, [{ connectionId: w.connectionId, vmid: w.vmid }])
  }
}

/** Whether a stored window is shown to the caller: its connection (and node) visible, a policy window always. */
export function windowVisible(
  scope: AvailabilityScope | null,
  connectionIds: readonly string[],
  w: { scope: string; connectionId: string | null; node: string | null },
): boolean {
  if (w.scope === 'policy') return true
  if (w.connectionId === null || !connectionIds.includes(w.connectionId)) return false
  if (w.scope === 'node') return w.node !== null && allowsNode(scope, w.connectionId, w.node)
  return true
}
