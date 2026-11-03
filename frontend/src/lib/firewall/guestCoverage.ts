// src/lib/firewall/guestCoverage.ts
//
// Firewall state of the guests of one connection, for the Dashboard, Firewalling > VMs and Security Groups tabs of
// /automation/network (UA44): the counts, and one row per guest.
//
// A guest is filtered by Proxmox only when its firewall options are on AND a NIC has firewall=1 (#1065). The
// browser used to ask three requests per guest (rules, options, config) for every viewer, every time the tab
// opened. Here the work is done once per connection, for everyone, and bounded:
//  - the NIC flag and VLAN tags come from the config read the inventory already caches (guestDiskTotals), read
//    again on every answer: no call, and a NIC toggle shows at once. A guest whose options are on but whose config
//    the inventory has not read (a guest created since its last pass, a container it never reached) gets ONE config
//    read, in the same slot as its options call: 2 calls at most per guest. What it found is kept with the options
//    and handed to the inventory cache, so it is not read again before the TTL or a write by ProxCenter (UA46);
//  - the options (enable, policies, log levels the VM rows show) are the only other per-guest Proxmox call, at most
//    COVERAGE_GLOBAL_CONCURRENCY in flight and COVERAGE_NODE_CONCURRENCY per node, none on a node the inventory
//    reports offline, none started after COVERAGE_BUDGET_MS, and none started once one call timed out or took
//    longer than COVERAGE_SLOW_CALL_MS (a slow Proxmox is left alone: the rest is unknown, and that is cached);
//  - at most COVERAGE_MAX_GUESTS guests are asked: beyond, an even sample; the others are listed unknown;
//  - the options read are kept per guest: a guest added, moved or written by ProxCenter is read alone, the others
//    are not read again before COVERAGE_TTL_MS; a forced refresh inside max(COVERAGE_FORCE_MIN_MS, 10 x the last
//    full read) is served from the cache; one read runs at a time per connection;
//  - a write by ProxCenter during a read is never overwritten by what that read saw before it (generations).
// A request waits COVERAGE_WAIT_MS at most (nginx cuts API routes at 60 s): past it, the read goes on and the caller
// is told it is still computing. A client that goes away does not stop it, which is why it is bounded.

import { createHash } from 'node:crypto'

import { mapWithConcurrency } from '@/lib/inventory/concurrency'

export const COVERAGE_TTL_MS = 10 * 60_000
export const COVERAGE_MAX_GUESTS = 200
export const COVERAGE_GLOBAL_CONCURRENCY = 4
export const COVERAGE_NODE_CONCURRENCY = 2
export const COVERAGE_BUDGET_MS = 120_000
export const COVERAGE_FORCE_MIN_MS = 30_000
export const COVERAGE_WAIT_MS = 20_000
/** A call slower than this, or one that timed out, stops the read: no further call starts. */
export const COVERAGE_SLOW_CALL_MS = 5_000

export type CoverageGuest = {
  vmid: string
  node: string
  type: 'qemu' | 'lxc'
  name?: string
  status?: string
  tags?: string[]
  /** Its node is reported offline by the inventory: never asked (a call to a dead node fails after about 1 s). */
  offline?: boolean
}

/** Firewall options of a guest as Proxmox answers them (only the fields read here are typed). */
export type GuestOptions = { enable?: number | string; policy_in?: string; policy_out?: string; log_level_in?: string; log_level_out?: string }

/** One guest. Null where it could not be told; a guest's RULES are never here, they are read on demand. */
export type GuestCoverageRow = {
  type: 'qemu' | 'lxc'
  node: string
  vmid: string
  name: string
  status: string
  tags: string[]
  /** Filtered by Proxmox: options on and a NIC with the flag. */
  enabled: boolean | null
  /** Enabled in the guest's firewall options. */
  optionsEnabled: boolean | null
  /** `firewall=1` on a NIC (inventory config cache). */
  nicFirewall: boolean | null
  options: GuestOptions | null
  vlans: number[]
  /** Left out by the 200-guest cap: listed so it can be found, never asked. */
  sampledOut?: boolean
}

/** Cached NIC facts of a guest. */
export type GuestNet = { nicFirewall: boolean; vlans: number[] }

export type GuestCoverage = {
  /** Guests of the connection, templates left out. */
  total: number
  /** Guests looked at: all of them, or the sample above COVERAGE_MAX_GUESTS. */
  measured: number
  /** Filtered: firewall on in the options and on a NIC (among the measured guests). */
  enabled: number
  /** Certainly not filtered. */
  disabled: number
  /** Could not be told: options unreadable or not read (slow Proxmox, offline node), NIC flag not read yet. */
  unknown: number
  /** `measured` is a sample of `total`. */
  sampled: boolean
  /** Some figure is missing: sampled, or unknown guests. */
  partial: boolean
  /** ISO time the options were last read. */
  computedAt: string
  /** Every guest, sorted by type and vmid (the sampled-out ones flagged). */
  guests: GuestCoverageRow[]
}

export type CoverageDeps = {
  /** The connection's guests (templates excluded), with the offline flag of their node. */
  listGuests: () => Promise<CoverageGuest[]>
  /** The cached NIC facts of a guest, undefined when not known. */
  guestNet: (guest: CoverageGuest) => GuestNet | undefined
  /** The guest's firewall options: the first Proxmox call per guest. */
  fetchOptions: (guest: CoverageGuest) => Promise<GuestOptions | null | undefined>
  /**
   * The NIC facts read from the guest config, for a guest whose options are on and whose NICs `guestNet` does not
   * know: the second, and last, Proxmox call for that guest. Absent: such a guest stays unknown.
   */
  fetchNet?: (guest: CoverageGuest) => Promise<GuestNet | null | undefined>
  now?: () => number
}

export type CoverageOutcome = { result: GuestCoverage | null; computing: boolean }

/**
 * What was read of a guest: its options, or null when they could not be read, and the NIC facts when its config had
 * to be read (the inventory did not know them).
 */
type Known = { options: GuestOptions | null; net?: GuestNet }

type State = {
  /** Options read, keyed by type/vmid@node: a guest moved to another node is read again. */
  known: Map<string, Known>
  /** Hash of the guest list the state was last served for. */
  hash: string
  /** When the last FULL read ended, and how long it took. */
  fullAt: number
  fullMs: number
  /** When options were last read at all. */
  readAt: number
  /** The answer last served, for a caller that waits out a running read. */
  last: GuestCoverage | null
}

type Running = { promise: Promise<GuestCoverage> }

const CACHE_KEY = '__proxcenter_guest_coverage__' as const
const INFLIGHT_KEY = '__proxcenter_guest_coverage_inflight__' as const
const GENERATION_KEY = '__proxcenter_guest_coverage_generation__' as const

function globalMap<V>(key: string): Map<string, V> {
  const g = globalThis as any
  if (!g[key]) g[key] = new Map<string, V>()

  return g[key]
}

const cache = () => globalMap<State>(CACHE_KEY)
const inflight = () => globalMap<Running>(INFLIGHT_KEY)
/** Bumped by every write ProxCenter makes on a connection: `conn` for all guests, `conn|type/vmid` for one. */
const generations = () => globalMap<number>(GENERATION_KEY)

const generationOf = (key: string) => generations().get(key) ?? 0
const bump = (key: string) => generations().set(key, generationOf(key) + 1)

/**
 * Forget what was read, after ProxCenter itself changed a guest firewall: that guest only (it is read again alone on
 * the next answer), or the whole connection. A read running meanwhile does not store what it saw before the write.
 */
export function forgetGuestCoverage(connId: string, guest?: { type: string; vmid: string | number }): void {
  if (!guest) {
    cache().delete(connId)
    bump(connId)
    return
  }
  const state = cache().get(connId)
  const prefix = `${guest.type}/${guest.vmid}@`
  // Deleting the entry being visited is safe while iterating a Map.
  if (state) for (const key of state.known.keys()) if (key.startsWith(prefix)) state.known.delete(key)
  bump(`${connId}|${guest.type}/${guest.vmid}`)
}

/**
 * A connection was deleted: everything held for it goes (answers, the read running, the generations). A read still
 * running for it finishes for its callers but stores nothing, since it is no longer the connection's read.
 */
export function evictGuestCoverage(connId: string): void {
  cache().delete(connId)
  inflight().delete(connId)
  for (const key of generations().keys()) if (key === connId || key.startsWith(`${connId}|`)) generations().delete(key)
}

/** Test seam. */
export function resetGuestCoverage(): void {
  cache().clear()
  inflight().clear()
  generations().clear()
}

const guestKey = (g: { type: string; vmid: string }) => `${g.type}/${g.vmid}`
const placedKey = (g: { type: string; vmid: string; node: string }) => `${guestKey(g)}@${g.node}`

function byKey(a: { type: string; vmid: string }, b: { type: string; vmid: string }): number {
  const ka = guestKey(a)
  const kb = guestKey(b)

  return ka < kb ? -1 : Number(ka > kb)
}

/** Identity of a guest list: a guest added, removed or moved to another node changes it. */
export function guestListHash(guests: CoverageGuest[]): string {
  const lines = guests.map(placedKey).sort((a, b) => a.localeCompare(b))

  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

/** A stable pseudo-random rank of a guest: its place in the sample does not depend on the other guests. */
function sampleRank(g: { type: string; vmid: string }): string {
  return createHash('sha256').update(guestKey(g)).digest('hex')
}

/**
 * At most `max` guests: the `max` lowest ranks. Stable, so one guest added or removed changes the sample by at most
 * that guest and the one it pushes out (read again: 1 call at most), and spread across nodes and vmid ranges.
 */
export function sampleGuests(guests: CoverageGuest[], max = COVERAGE_MAX_GUESTS): CoverageGuest[] {
  if (guests.length <= max) return [...guests].sort(byKey)
  const ranked = guests.map(g => ({ g, rank: sampleRank(g) })).sort((a, b) => a.rank.localeCompare(b.rank))

  return ranked.slice(0, max).map(r => r.g).sort(byKey)
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

/** A timeout of the call itself (pveFetch, undici, the orchestrator client), not a refusal. */
export function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string; cause?: { name?: string } } | null
  if (!e) return false
  if (e.name === 'TimeoutError' || e.cause?.name === 'TimeoutError') return true
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED' || e.code === 'UND_ERR_HEADERS_TIMEOUT') return true

  return /time(d)? ?out/i.test(String(e.message ?? ''))
}

/** Options that switch the guest firewall on. */
const optionsOn = (options: GuestOptions | null | undefined) => !!options && Number(options.enable) === 1

/**
 * Reads the options of these guests, under the caps above, and the config of those whose options are on while their
 * NICs are not known, in the same slot (the second call counts in the pool like the first). A guest not reached
 * (budget, trip) or whose read failed comes back with null options; a guest of an offline node is skipped. Never
 * throws.
 */
export async function readGuestOptions(guests: CoverageGuest[], deps: CoverageDeps): Promise<Map<string, Known>> {
  const now = deps.now ?? Date.now
  const deadline = now() + COVERAGE_BUDGET_MS
  const onNode = nodeLimiter(COVERAGE_NODE_CONCURRENCY)
  // Set by the first timeout or slow call: from then on no call starts (the 1.4.12 lesson, a slow Proxmox fed with
  // more calls only gets slower, and a call the client gives up on still holds its worker).
  let tripped = false
  const out = new Map<string, Known>()

  /** One Proxmox call, or null when none may start or it failed; trips on a timeout or a slow answer. */
  const timed = async <T>(call: () => Promise<T | null | undefined>): Promise<T | null> => {
    if (tripped || now() > deadline) return null
    const started = now()
    try {
      const answer = (await call()) ?? null
      if (now() - started > COVERAGE_SLOW_CALL_MS) tripped = true
      return answer
    } catch (err) {
      if (isTimeoutError(err) || now() - started > COVERAGE_SLOW_CALL_MS) tripped = true
      return null
    }
  }

  await mapWithConcurrency(interleaveByNode(guests.filter(g => !g.offline)), COVERAGE_GLOBAL_CONCURRENCY, async guest => {
    const known = await onNode(guest.node, async (): Promise<Known> => {
      const options = await timed(() => deps.fetchOptions(guest))
      // Options off: not filtered whatever the NICs say, no config to read.
      if (!optionsOn(options) || !deps.fetchNet || deps.guestNet(guest) !== undefined) return { options }
      const net = await timed(() => deps.fetchNet!(guest))
      return net ? { options, net } : { options }
    })
    out.set(placedKey(guest), known)
  })
  // A guest of an offline node is not stored: it is read once its node is back (0 calls meanwhile).

  return out
}

/** Filtered when both levels are on; certainly not when one is off; unknown otherwise. */
function verdict(optionsEnabled: boolean | null, nicFirewall: boolean | null): boolean | null {
  if (optionsEnabled === false || nicFirewall === false) return false
  if (optionsEnabled === null || nicFirewall === null) return null

  return true
}

function rowOf(guest: CoverageGuest, known: Known | undefined, net: GuestNet | undefined, sampledOut: boolean): GuestCoverageRow {
  const options = known?.options ?? null
  const optionsEnabled = options ? optionsOn(options) : null
  const nicFacts = net ?? known?.net
  const nicFirewall = nicFacts ? nicFacts.nicFirewall : null
  const row: GuestCoverageRow = {
    type: guest.type,
    node: guest.node,
    vmid: guest.vmid,
    name: guest.name || `${guest.type}/${guest.vmid}`,
    status: guest.status || 'unknown',
    tags: guest.tags ?? [],
    enabled: verdict(optionsEnabled, nicFirewall),
    optionsEnabled,
    nicFirewall,
    options,
    vlans: nicFacts?.vlans ?? [],
  }
  if (sampledOut) row.sampledOut = true

  return row
}

/**
 * The answer for this guest list, from the options read: names, states, tags of the list just read and the NIC facts
 * of the inventory cache, so they move without any Proxmox call.
 */
function build(guests: CoverageGuest[], known: Map<string, Known>, deps: CoverageDeps, readAt: number): GuestCoverage {
  const measured = sampleGuests(guests)
  const inSample = new Set(measured.map(placedKey))
  const rows = [...guests].sort(byKey).map(g => rowOf(g, known.get(placedKey(g)), deps.guestNet(g), !inSample.has(placedKey(g))))
  const sampleRows = rows.filter(r => !r.sampledOut)
  const enabled = sampleRows.filter(r => r.enabled === true).length
  const disabled = sampleRows.filter(r => r.enabled === false).length
  const unknown = sampleRows.length - enabled - disabled
  const sampled = guests.length > measured.length

  return {
    total: guests.length,
    measured: measured.length,
    enabled,
    disabled,
    unknown,
    sampled,
    partial: sampled || unknown > 0,
    computedAt: new Date(readAt).toISOString(),
    guests: rows,
  }
}

/** Reads every guest's options now. For the tests; callers go through getGuestCoverage. */
export async function computeGuestCoverage(guests: CoverageGuest[], deps: CoverageDeps): Promise<GuestCoverage> {
  const now = deps.now ?? Date.now

  return build(guests, await readGuestOptions(sampleGuests(guests), deps), deps, now())
}

/** A forced refresh is taken this long after the last full read at the soonest. */
export function forceFloorMs(lastFullMs: number): number {
  return Math.max(COVERAGE_FORCE_MIN_MS, 10 * lastFullMs)
}

/**
 * Stores into `target` what a read saw, except for a guest ProxCenter wrote to since the read started: that guest
 * stays to be read again, so the cache never holds its state from before the write. False when the whole connection
 * was written to since: nothing may be stored.
 */
function store(connId: string, target: Map<string, Known>, read: Map<string, Known>, startGen: Map<string, number>, connGen: number): boolean {
  if (generationOf(connId) !== connGen) return false
  for (const [key, known] of read) {
    const guestGenKey = `${connId}|${key.split('@')[0]}`
    if (generationOf(guestGenKey) === (startGen.get(guestGenKey) ?? 0)) target.set(key, known)
  }

  return true
}

/**
 * Lists the guests, reads the options of those not known yet (all of them when the last full read is old or a
 * refresh is forced), and answers. Registered as the connection's running read before its first await, so
 * concurrent viewers share it.
 */
function begin(connId: string, deps: CoverageDeps, force: boolean): Promise<GuestCoverage> {
  const now = deps.now ?? Date.now
  // Still the connection's read when it ends: false after an eviction (connection deleted), then nothing is stored.
  const owner = () => inflight().get(connId)?.promise === promise
  const promise: Promise<GuestCoverage> = (async () => {
    const connGen = generationOf(connId)
    const guests = await deps.listGuests()
    const hash = guestListHash(guests)
    const measured = sampleGuests(guests)
    const previous = cache().get(connId)
    const state: State = previous ?? { known: new Map(), hash, fullAt: -Infinity, fullMs: 0, readAt: now(), last: null }

    const age = now() - state.fullAt
    const full = age >= COVERAGE_TTL_MS || (force && age >= forceFloorMs(state.fullMs))
    // The guests to read: every one on a full read, else those added, moved or written since (0 calls otherwise).
    const toRead = full ? measured : measured.filter(g => !state.known.has(placedKey(g)))

    if (toRead.length > 0) {
      const startGen = new Map(toRead.map(g => [`${connId}|${guestKey(g)}`, generationOf(`${connId}|${guestKey(g)}`)]))
      const started = now()
      const read = await readGuestOptions(toRead, deps)
      const called = [...read.values()].some(k => k.options !== null || !!k.net)
      const target = full ? new Map<string, Known>() : state.known
      if (store(connId, target, read, startGen, connGen)) {
        state.known = target
        if (full) {
          state.fullAt = now()
          state.fullMs = now() - started
        }
        // The time only moves when something was read from Proxmox (cosmetic: "computed X ago").
        if (called || full) state.readAt = now()
      } else {
        state.known = new Map()
      }
      // What this read saw still answers its own callers, even where a write since keeps it out of the cache.
      return remember(connId, owner, state, hash, guests, build(guests, new Map([...state.known, ...read]), deps, state.readAt))
    }

    return remember(connId, owner, state, hash, guests, build(guests, state.known, deps, state.readAt))
  })().finally(() => {
    if (inflight().get(connId)?.promise === promise) inflight().delete(connId)
  })

  inflight().set(connId, { promise })
  // A caller that waited out no longer listens: a failure must not surface as an unhandled rejection.
  promise.catch(() => undefined)

  return promise
}

function remember(connId: string, owner: () => boolean, state: State, hash: string, guests: CoverageGuest[], answer: GuestCoverage): GuestCoverage {
  if (!owner()) return answer
  // Guests gone from the list are forgotten; the state is kept only when no connection-wide write wiped it.
  const present = new Set(guests.map(placedKey))
  for (const key of state.known.keys()) if (!present.has(key)) state.known.delete(key)
  state.hash = hash
  state.last = answer
  cache().set(connId, state)

  return answer
}

const WAITED_OUT = Symbol('waited-out')

/**
 * The coverage of a connection. Waits `waitMs` at most for a read; past it, `computing` is true and `result` is the
 * previous answer, if any.
 */
export async function getGuestCoverage(
  connId: string,
  deps: CoverageDeps,
  opts: { force?: boolean; waitMs?: number } = {},
): Promise<CoverageOutcome> {
  const previous = cache().get(connId)?.last ?? null
  // A read already running is joined: no second guest list read, no second fan-out.
  const running = inflight().get(connId)?.promise ?? begin(connId, deps, !!opts.force)

  const waitMs = opts.waitMs ?? COVERAGE_WAIT_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = await Promise.race([
    running,
    new Promise<typeof WAITED_OUT>(resolve => { timer = setTimeout(() => resolve(WAITED_OUT), waitMs) }),
  ]).finally(() => clearTimeout(timer))

  if (waited === WAITED_OUT) return { result: previous, computing: true }

  return { result: waited, computing: false }
}
