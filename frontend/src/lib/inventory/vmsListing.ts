// src/lib/inventory/vmsListing.ts
//
// The Proxmox side of GET /api/v1/vms, bounded (UA52). That route used to read, on EVERY call and for every caller,
// /cluster/resources, /nodes and the config of every guest (2 + N calls, 16 in flight, no cache): the micro-seg zone
// map, the target picker, the Dashboard grouping and Observation each paid it again. Here:
//  - the guest list (/cluster/resources?type=vm and /nodes) is read once per connection every LISTING_TTL_MS, and
//    callers that arrive while it is being read share that read. Short on purpose: the zone members are the guests
//    tagged by the micro-segmentation engine, and an apply must show in the zone map at the next read;
//  - the config fields come from the guest config cache the inventory, the firewall coverage and this route fill
//    (guestDiskTotals: one entry per guest, 15 min TTL). Only a guest with no entry, or one past its TTL, has its
//    config read, through the connection's pool (connectionPool: 4 in flight, 2 per node, shared with the coverage),
//    one read per guest at a time whoever asks, none on a node reported offline;
//  - a read that times out or takes longer than POOL_SLOW_CALL_MS trips the connection: no config read starts on it
//    for TRIP_COOLDOWN_MS, and a guest whose config read failed is not asked again for FAILURE_COOLDOWN_MS;
//  - `refresh` (?refresh=1) reads the list and every config again, at most once per REFRESH_MIN_MS per connection.
// What could not be read is served from the older cache entry, or without config fields, and the answer says
// `partial`.

import { pveFetch } from "@/lib/proxmox/client"

import { createCallGate, withConnectionSlot, type CallGate } from "./connectionPool"
import { diskTotalKey, peekGuestConfigFacts, rememberGuestConfigFacts } from "./guestDiskTotals"

export const LISTING_TTL_MS = 15_000
export const REFRESH_MIN_MS = 30_000
/** No config read of a fill starts after this. */
export const CONFIG_BUDGET_MS = 20_000
export const TRIP_COOLDOWN_MS = 60_000
export const FAILURE_COOLDOWN_MS = 60_000

export type GuestListing = {
  resources: any[]
  resourcesOk: boolean
  nodes: any[]
  nodesOk: boolean
  /** Epoch ms of the read. */
  at: number
}

export type ListedGuest = { vmid: string; node: string; type: string; maxdisk?: number }

type ConnState = {
  listing?: GuestListing
  listingRun?: Promise<GuestListing>
  forcedAt?: number
  trippedAt?: number
}

const STATE_KEY = "__proxcenter_vms_listing__" as const
const READS_KEY = "__proxcenter_vms_config_reads__" as const
const FAILED_KEY = "__proxcenter_vms_config_failed__" as const

function globalMap<V>(key: string): Map<string, V> {
  const g = globalThis as any
  if (!g[key]) g[key] = new Map<string, V>()

  return g[key]
}

const states = () => globalMap<ConnState>(STATE_KEY)
/** Config reads in flight, by guest key: a second caller joins the first one's read. */
const reads = () => globalMap<Promise<void>>(READS_KEY)
/** When a guest's config read last failed. */
const failures = () => globalMap<number>(FAILED_KEY)

function stateOf(connId: string): ConnState {
  let state = states().get(connId)
  if (!state) {
    state = {}
    states().set(connId, state)
  }

  return state
}

/** Test seam. */
export function resetVmsListing(): void {
  states().clear()
  reads().clear()
  failures().clear()
}

/**
 * True when a forced refresh may run now on this connection (at most one per REFRESH_MIN_MS), and records it. A
 * refused one is served like a normal read.
 */
export function takeForcedRefresh(connId: string, now = Date.now()): boolean {
  const state = stateOf(connId)
  if (state.forcedAt !== undefined && now - state.forcedAt < REFRESH_MIN_MS) return false
  state.forcedAt = now

  return true
}

async function readListing(connData: any, now: () => number): Promise<GuestListing> {
  const [resources, nodes] = await Promise.allSettled([
    pveFetch<any[]>(connData, "/cluster/resources?type=vm"),
    pveFetch<any[]>(connData, "/nodes"),
  ])

  return {
    resources: resources.status === "fulfilled" ? resources.value || [] : [],
    resourcesOk: resources.status === "fulfilled",
    nodes: nodes.status === "fulfilled" ? nodes.value || [] : [],
    nodesOk: nodes.status === "fulfilled",
    at: now(),
  }
}

/**
 * The guest list and nodes of a connection: the last read when younger than LISTING_TTL_MS, the read running when
 * there is one, else a new read (2 calls). A failed read is not kept: the next caller reads again.
 */
export function getGuestListing(connId: string, connData: any, opts: { force?: boolean; now?: () => number } = {}): Promise<GuestListing> {
  const now = opts.now ?? Date.now
  const state = stateOf(connId)
  if (state.listingRun !== undefined) return state.listingRun
  if (!opts.force && state.listing && now() - state.listing.at < LISTING_TTL_MS) return Promise.resolve(state.listing)

  const run = readListing(connData, now).then(listing => {
    if (states().get(connId) === state && listing.resourcesOk && listing.nodesOk) state.listing = listing
    return listing
  }).finally(() => {
    if (state.listingRun === run) state.listingRun = undefined
  })
  state.listingRun = run

  return run
}

const kindOf = (type: string): "qemu" | "lxc" => (type === "lxc" ? "lxc" : "qemu")

/** A guest whose config must be read now: no cached fields, or past the TTL, or a forced refresh. */
function needsRead(connId: string, g: ListedGuest, force: boolean, now: number): boolean {
  if (force) return true
  const cached = peekGuestConfigFacts(connId, kindOf(g.type), g.vmid, { maxdisk: g.maxdisk, now })

  return !cached?.fresh
}

/** False while the connection is tripped, or while the guest's last failed read is recent (a forced refresh asks it anyway). */
function mayStart(state: ConnState, key: string, force: boolean, now: number): boolean {
  if (state.trippedAt !== undefined && now - state.trippedAt < TRIP_COOLDOWN_MS) return false
  const failedAt = failures().get(key)

  return force || failedAt === undefined || now - failedAt >= FAILURE_COOLDOWN_MS
}

type ReadContext = {
  connId: string
  state: ConnState
  gate: CallGate
  now: () => number
  fetchConfig: (g: ListedGuest) => Promise<unknown>
}

/** One guest's config read, in a slot of the connection's pool; registered so a second caller joins it. */
function startRead(g: ListedGuest, key: string, ctx: ReadContext): Promise<void> {
  const job = withConnectionSlot(ctx.connId, g.node, async () => {
    let failed = false
    const config = await ctx.gate.run(() => ctx.fetchConfig(g).catch(err => {
      failed = true
      throw err
    }))
    if (ctx.gate.tripped) ctx.state.trippedAt = ctx.now()
    if (config !== null && rememberGuestConfigFacts(ctx.connId, { ...g, type: kindOf(g.type) }, config)) {
      failures().delete(key)
    } else if (failed) {
      failures().set(key, ctx.now())
    }
  }).catch(() => undefined).finally(() => {
    if (reads().get(key) === job) reads().delete(key)
  })
  reads().set(key, job)

  return job
}

/**
 * Reads the config of the listed guests that need one (see needsRead), through the connection's pool, and keeps it in
 * the guest config cache. Resolves once every read it started or joined is over. Never throws.
 */
export async function fillGuestConfigs(
  connId: string,
  connData: any,
  guests: ListedGuest[],
  onlineNodes: Set<string> | null,
  opts: { force?: boolean; now?: () => number; fetchConfig?: (g: ListedGuest) => Promise<unknown> } = {},
): Promise<void> {
  const now = opts.now ?? Date.now
  const force = !!opts.force
  const ctx: ReadContext = {
    connId,
    state: stateOf(connId),
    gate: createCallGate({ deadline: now() + CONFIG_BUDGET_MS, now }),
    now,
    fetchConfig: opts.fetchConfig ?? ((g: ListedGuest) => pveFetch<unknown>(
      connData,
      `/nodes/${encodeURIComponent(g.node)}/${kindOf(g.type)}/${encodeURIComponent(g.vmid)}/config`,
    )),
  }
  const waits: Promise<void>[] = []

  for (const g of guests) {
    if (!g.node || (onlineNodes !== null && !onlineNodes.has(g.node))) continue
    const key = diskTotalKey(connId, kindOf(g.type), g.vmid)
    const running = reads().get(key)
    if (running !== undefined) waits.push(running)
    else if (needsRead(connId, g, force, now()) && mayStart(ctx.state, key, force, now())) waits.push(startRead(g, key, ctx))
  }

  await Promise.all(waits)
}
