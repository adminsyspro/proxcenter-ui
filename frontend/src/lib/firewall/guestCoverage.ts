// src/lib/firewall/guestCoverage.ts
//
// Firewall coverage of the guests of one connection, for the Dashboard of /automation/network (UA44).
//
// A guest is filtered by Proxmox only when its firewall options are on AND a NIC has firewall=1 (#1065). The
// browser used to ask three requests per guest (rules, options, config) for every viewer, every time the tab
// opened. Here the work is done once per connection, for everyone, and bounded:
//  - the NIC flag comes from the config read the inventory already caches (guestDiskTotals): no call;
//  - a guest whose NICs have no firewall flag is not filtered whatever its options say: no call either;
//  - the options are the only per-guest Proxmox call, at most COVERAGE_GLOBAL_CONCURRENCY in flight and
//    COVERAGE_NODE_CONCURRENCY per node, and none started after COVERAGE_BUDGET_MS;
//  - at most COVERAGE_MAX_GUESTS guests are asked: beyond, an even sample, and the answer says so;
//  - the answer is kept COVERAGE_TTL_MS for the same guest list, one computation runs at a time per
//    connection, and a forced refresh inside COVERAGE_FORCE_MIN_MS of the last one is served from the cache.
// A request waits COVERAGE_WAIT_MS at most (nginx cuts API routes at 60 s): past it, the computation goes on and
// the caller is told it is still computing. A client that goes away does not stop it, which is why it is bounded.

import { createHash } from 'node:crypto'

import { mapWithConcurrency } from '@/lib/inventory/concurrency'

export const COVERAGE_TTL_MS = 10 * 60_000
export const COVERAGE_MAX_GUESTS = 200
export const COVERAGE_GLOBAL_CONCURRENCY = 4
export const COVERAGE_NODE_CONCURRENCY = 2
export const COVERAGE_BUDGET_MS = 120_000
export const COVERAGE_FORCE_MIN_MS = 30_000
export const COVERAGE_WAIT_MS = 20_000

export type CoverageGuest = { vmid: string; node: string; type: 'qemu' | 'lxc' }

export type GuestCoverage = {
  /** Guests of the connection, templates left out. */
  total: number
  /** Guests looked at: all of them, or the sample above COVERAGE_MAX_GUESTS. */
  measured: number
  /** Filtered: firewall on in the options and on a NIC. */
  enabled: number
  /** Certainly not filtered. */
  disabled: number
  /** Could not be told: options unreadable, NIC flag not read yet by the inventory, or out of time. */
  unknown: number
  /** `measured` is a sample of `total`. */
  sampled: boolean
  /** Some figure is missing: sampled, or unknown guests. */
  partial: boolean
  /** ISO time the figures were computed. */
  computedAt: string
}

export type CoverageDeps = {
  /** The connection's guests (templates excluded). */
  listGuests: () => Promise<CoverageGuest[]>
  /** The cached NIC flag of a guest, undefined when not known. */
  nicFirewall: (guest: CoverageGuest) => boolean | undefined
  /** The guest's firewall options: the one Proxmox call per guest. */
  fetchOptions: (guest: CoverageGuest) => Promise<{ enable?: number | string } | null | undefined>
  now?: () => number
}

export type CoverageOutcome = { result: GuestCoverage | null; computing: boolean }

type Entry = { hash: string; result: GuestCoverage; at: number }
type Running = { promise: Promise<GuestCoverage> }

const CACHE_KEY = '__proxcenter_guest_coverage__' as const
const INFLIGHT_KEY = '__proxcenter_guest_coverage_inflight__' as const

function cache(): Map<string, Entry> {
  const g = globalThis as any
  if (!g[CACHE_KEY]) g[CACHE_KEY] = new Map<string, Entry>()

  return g[CACHE_KEY]
}

function inflight(): Map<string, Running> {
  const g = globalThis as any
  if (!g[INFLIGHT_KEY]) g[INFLIGHT_KEY] = new Map<string, Running>()

  return g[INFLIGHT_KEY]
}

/** Drop a connection's figures, after ProxCenter itself changed a guest firewall on it. */
export function forgetGuestCoverage(connId: string): void {
  cache().delete(connId)
}

/** Test seam. */
export function resetGuestCoverage(): void {
  cache().clear()
  inflight().clear()
}

const guestKey = (g: CoverageGuest) => `${g.type}/${g.vmid}`

function byKey(a: CoverageGuest, b: CoverageGuest): number {
  const ka = guestKey(a)
  const kb = guestKey(b)

  return ka < kb ? -1 : Number(ka > kb)
}

/** Identity of a guest list: a guest added, removed or moved to another node changes it. */
export function guestListHash(guests: CoverageGuest[]): string {
  const lines = guests.map(g => `${guestKey(g)}@${g.node}`).sort()

  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/** At most `max` guests, spread evenly over the sorted list so every node and range is represented. */
export function sampleGuests(guests: CoverageGuest[], max = COVERAGE_MAX_GUESTS): CoverageGuest[] {
  const sorted = [...guests].sort(byKey)
  if (sorted.length <= max) return sorted

  return Array.from({ length: max }, (_, i) => sorted[Math.floor((i * sorted.length) / max)])
}

/** Node by node in turn, so the global slots rarely wait on a busy node while another one is idle. */
export function interleaveByNode(guests: CoverageGuest[]): CoverageGuest[] {
  const byNode = new Map<string, CoverageGuest[]>()

  for (const g of guests) {
    const list = byNode.get(g.node) ?? []
    list.push(g)
    byNode.set(g.node, list)
  }
  const lanes = [...byNode.values()]
  const out: CoverageGuest[] = []

  for (let i = 0; out.length < guests.length; i++) {
    for (const lane of lanes) if (i < lane.length) out.push(lane[i])
  }

  return out
}

/** At most `limit` calls at a time on one node. */
function nodeLimiter(limit: number) {
  const lanes = new Map<string, { active: number; waiting: Array<() => void> }>()

  return async <T>(node: string, call: () => Promise<T>): Promise<T> => {
    let lane = lanes.get(node)
    if (!lane) {
      lane = { active: 0, waiting: [] }
      lanes.set(node, lane)
    }
    if (lane.active < limit) {
      lane.active++
    } else {
      const queued = lane
      await new Promise<void>(resolve => queued.waiting.push(resolve))
    }
    try {
      return await call()
    } finally {
      const next = lane.waiting.shift()
      if (next) next()
      else lane.active--
    }
  }
}

type Verdict = 'enabled' | 'disabled' | 'unknown'

/** Computes the coverage of these guests now. Exported for the tests; callers go through getGuestCoverage. */
export async function computeGuestCoverage(guests: CoverageGuest[], deps: CoverageDeps): Promise<GuestCoverage> {
  const now = deps.now ?? Date.now
  const deadline = now() + COVERAGE_BUDGET_MS
  const measured = sampleGuests(guests)
  const onNode = nodeLimiter(COVERAGE_NODE_CONCURRENCY)

  const verdicts = await mapWithConcurrency<CoverageGuest, Verdict>(interleaveByNode(measured), COVERAGE_GLOBAL_CONCURRENCY, async guest => {
    const nic = deps.nicFirewall(guest)
    if (nic === false) return 'disabled'

    return onNode(guest.node, async () => {
      if (now() > deadline) return 'unknown'
      let options: { enable?: number | string } | null | undefined
      try {
        options = await deps.fetchOptions(guest)
      } catch {
        return 'unknown'
      }
      if (Number(options?.enable) !== 1) return 'disabled'

      return nic === true ? 'enabled' : 'unknown'
    })
  })

  const count = (v: Verdict) => verdicts.filter(x => x === v).length
  const unknown = count('unknown')
  const sampled = guests.length > measured.length

  return {
    total: guests.length,
    measured: measured.length,
    enabled: count('enabled'),
    disabled: count('disabled'),
    unknown,
    sampled,
    partial: sampled || unknown > 0,
    computedAt: new Date(now()).toISOString(),
  }
}

/**
 * Lists the guests, then serves the cached figures when they are for the same list and young enough, or computes new
 * ones. Registered as the connection's running read before its first await, so concurrent viewers share it.
 */
function begin(connId: string, deps: CoverageDeps, force: boolean): Promise<GuestCoverage> {
  const now = deps.now ?? Date.now
  const promise: Promise<GuestCoverage> = (async () => {
    const guests = await deps.listGuests()
    const hash = guestListHash(guests)
    const entry = cache().get(connId)
    const age = entry ? now() - entry.at : Infinity
    const fresh = !!entry && entry.hash === hash && age < COVERAGE_TTL_MS
    if (entry && fresh && (!force || age < COVERAGE_FORCE_MIN_MS)) return entry.result

    const result = await computeGuestCoverage(guests, deps)
    cache().set(connId, { hash, result, at: now() })

    return result
  })().finally(() => {
    if (inflight().get(connId)?.promise === promise) inflight().delete(connId)
  })

  inflight().set(connId, { promise })
  // A caller that waited out no longer listens: a failure must not surface as an unhandled rejection.
  promise.catch(() => undefined)

  return promise
}

const WAITED_OUT = Symbol('waited-out')

/**
 * The coverage of a connection: from the cache when it is for the same guest list and young enough, else from the
 * computation running for it, else from a new one. Waits `waitMs` at most for a computation; past it, `computing`
 * is true and `result` is the previous figures, if any.
 */
export async function getGuestCoverage(
  connId: string,
  deps: CoverageDeps,
  opts: { force?: boolean; waitMs?: number } = {},
): Promise<CoverageOutcome> {
  const entry = cache().get(connId)
  // A read already running is joined: no second guest list read, no second fan-out.
  const running = inflight().get(connId)?.promise ?? begin(connId, deps, !!opts.force)

  const waitMs = opts.waitMs ?? COVERAGE_WAIT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = await Promise.race([
    running,
    new Promise<typeof WAITED_OUT>(resolve => { timer = setTimeout(() => resolve(WAITED_OUT), waitMs) }),
  ]).finally(() => clearTimeout(timer))

  if (waited === WAITED_OUT) return { result: entry?.result ?? null, computing: true }

  return { result: waited, computing: false }
}
