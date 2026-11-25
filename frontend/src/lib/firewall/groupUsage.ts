// src/lib/firewall/groupUsage.ts
//
// Which guests of a connection carry which security group, for the Security Groups tab of /automation/network and
// for the check made before a group is deleted.
//
// Proxmox keeps no member list: a group applies to a guest because one of that guest's rules is of type `group` and
// names it. Telling the members therefore takes the rules of every guest. Since UA44 the browser reads a guest's
// rules only when its row is opened, so a group read "0 VMs" while guests carried it, and a group could be deleted
// while guests still referenced it. Here the rules are read once per connection, for every viewer, and bounded:
//  - ONE call per guest (GET .../firewall/rules: answered by pveproxy from the cluster file system, about 10 ms on
//    the lab, no pvedaemon worker), in the connection's shared pool (connectionSlots): with the coverage and
//    GET /api/v1/vms together, 4 in flight and 2 per node at most;
//  - none on a node the inventory reports offline, none started after USAGE_BUDGET_MS, none once a call timed out
//    or took longer than POOL_SLOW_CALL_MS (a slow Proxmox is left alone: those guests stay unread, which is said);
//  - at most USAGE_MAX_GUESTS guests for the tab (the coverage's sample); every guest only for the check before a
//    deletion (`all`), which is asked by a person, one group at a time;
//  - what was read of a guest is kept USAGE_TTL_MS: a guest added, moved or written by ProxCenter is read alone;
//    a forced read inside max(USAGE_FORCE_MIN_MS, 10 x the last read) is served from what is kept;
//  - the micro-segmentation engine writes guest rules on its own, past every route of this app: `writesMark` names
//    its last runs that wrote (one orchestrator read, no Proxmox call), and what was read is forgotten when it moves;
//  - one read runs at a time per connection, shared by its callers; a write by ProxCenter during a read is never
//    overwritten by what that read saw before it (generations).
// A request waits USAGE_WAIT_MS at most (nginx cuts API routes at 60 s): past it the read goes on and the caller is
// told it is still computing.

import { mapWithConcurrency } from '@/lib/inventory/concurrency'
import { createCallGate, POOL_GLOBAL_CONCURRENCY, type SlotRunner } from '@/lib/inventory/connectionPool'

import { COVERAGE_MAX_GUESTS, guestKey, interleaveByNode, placedKey, sampleGuests, type CoverageGuest } from './guestCoverage'

export const USAGE_TTL_MS = 10 * 60_000
export const USAGE_MAX_GUESTS = COVERAGE_MAX_GUESTS
export const USAGE_BUDGET_MS = 120_000
export const USAGE_FORCE_MIN_MS = 30_000
export const USAGE_WAIT_MS = 20_000

/** A guest rule, as far as it is read here. */
export type UsageRule = { type?: string; action?: string }

export type UsageMember = { type: 'qemu' | 'lxc'; vmid: string; node: string; name: string }

export type GroupUsage = {
  /** Guests of the connection, templates left out. */
  total: number
  /** Guests whose rules are known. */
  measured: number
  /** Guests whose rules are not known (sample cap, offline node, slow Proxmox, failed read). */
  unread: number
  /** `unread` is above zero: a group may be carried by a guest not listed. */
  partial: boolean
  /** ISO time rules were last read. */
  computedAt: string
  /** For every group named by a guest rule, even one that no longer exists: the guests carrying it. */
  groups: Record<string, UsageMember[]>
}

export type UsageDeps = {
  /** The connection's guests (templates excluded), with the offline flag of their node. */
  listGuests: () => Promise<CoverageGuest[]>
  /** The guest's firewall rules: the one Proxmox call per guest. */
  fetchRules: (guest: CoverageGuest) => Promise<UsageRule[] | null | undefined>
  /** The connection's shared pool (connectionSlots). */
  slots: SlotRunner
  /**
   * Names the writes made to the guests' rules past this app (the runs of the micro-segmentation engine that wrote):
   * when it differs from the one of the previous answer, everything read is forgotten. Null: not known, nothing moves.
   */
  writesMark?: () => Promise<string | null>
  now?: () => number
}

export type UsageOutcome = { result: GroupUsage | null; computing: boolean }

/** The groups a guest's rules name, and when they were read. */
type Known = { groups: string[]; at: number }

type State = { known: Map<string, Known>; lastMs: number; readAt: number; last: GroupUsage | null }

type Running = { promise: Promise<GroupUsage>; all: boolean; force: boolean }

const CACHE_KEY = '__proxcenter_group_usage__' as const
const INFLIGHT_KEY = '__proxcenter_group_usage_inflight__' as const
const GENERATION_KEY = '__proxcenter_group_usage_generation__' as const

function globalMap<V>(key: string): Map<string, V> {
  const g = globalThis as any
  if (!g[key]) g[key] = new Map<string, V>()

  return g[key]
}

const cache = () => globalMap<State>(CACHE_KEY)
const inflight = () => globalMap<Running>(INFLIGHT_KEY)
const generations = () => globalMap<number>(GENERATION_KEY)
const marks = () => globalMap<string>('__proxcenter_group_usage_marks__')
const generationOf = (key: string) => generations().get(key) ?? 0

/**
 * ProxCenter changed the rules of a guest (or of any guest of the connection): what was read of it is forgotten, so
 * it is read again, alone, on the next answer. A read running meanwhile does not store what it saw before the write.
 */
export function forgetGroupUsage(connId: string, guest?: { type: string; vmid: string | number }): void {
  const key = guest ? `${connId}|${guest.type}/${guest.vmid}` : connId
  generations().set(key, generationOf(key) + 1)
  const state = cache().get(connId)
  if (!state) return
  if (!guest) {
    state.known.clear()
    return
  }
  const prefix = `${guest.type}/${guest.vmid}@`
  for (const placed of state.known.keys()) if (placed.startsWith(prefix)) state.known.delete(placed)
}

/** A connection was deleted: everything held for it goes. */
export function evictGroupUsage(connId: string): void {
  cache().delete(connId)
  inflight().delete(connId)
  marks().delete(connId)
  for (const key of generations().keys()) if (key === connId || key.startsWith(`${connId}|`)) generations().delete(key)
}

/** Test seam. */
export function resetGroupUsage(): void {
  cache().clear()
  inflight().clear()
  generations().clear()
  marks().clear()
}

/**
 * The run kinds of the engine that write the rules of guests: an apply, a removal, the full reconciliation and a run
 * targeted at new members. The light and IP passes only write cluster objects (IP sets, group contents) and the log
 * pass writes nothing: they never change which guest carries which group, so they do not count.
 */
const GUEST_WRITING_RUNS = new Set(['apply', 'remove', 'full', 'targeted'])

/** The runs the engine reports in its status that may have changed the guests' rules: those that wrote, or still run. */
export function engineWritesMark(status: unknown): string | null {
  const runs = (status as { engine?: { last_runs?: Record<string, { started_at?: string; status?: string; writes?: number }> } } | null)?.engine?.last_runs
  if (!runs || typeof runs !== 'object') return null

  return Object.entries(runs)
    .filter(([kind, run]) => GUEST_WRITING_RUNS.has(kind) && !!run && ((run.writes ?? 0) > 0 || run.status !== 'done'))
    .map(([kind, run]) => `${kind}@${run.started_at ?? ''}:${run.status ?? ''}:${run.writes ?? 0}`)
    .sort((a, b) => a.localeCompare(b))
    .join('|')
}

/** The security groups these rules name, once each. A disabled rule still names its group. */
export function groupsOf(rules: UsageRule[]): string[] {
  const names = rules.filter(r => r?.type === 'group' && typeof r.action === 'string' && r.action !== '').map(r => r.action as string)

  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}

/** A forced read is taken this long after a guest was last read at the soonest. */
export function usageForceFloorMs(lastMs: number): number {
  return Math.max(USAGE_FORCE_MIN_MS, 10 * lastMs)
}

/** What is known of a guest is asked again once older than `maxAge` (the TTL, or the force floor when forced). */
function isStale(read: Known | undefined, nowMs: number, maxAge: number): boolean {
  return !read || nowMs - read.at >= Math.min(maxAge, USAGE_TTL_MS)
}

/**
 * Keeps what a read brought back. A guest asked and not answered is forgotten, so it counts as unread; an answer is
 * kept only when no write touched the guest since the read started (`untouched`).
 */
function keepReads(known: Map<string, Known>, asked: CoverageGuest[], read: Map<string, Known>, untouched: (g: CoverageGuest) => boolean) {
  for (const guest of asked) {
    const got = read.get(placedKey(guest))

    if (!got) known.delete(placedKey(guest))
    else if (untouched(guest)) known.set(placedKey(guest), got)
  }
}

function build(guests: CoverageGuest[], known: Map<string, Known>, readAt: number): GroupUsage {
  const groups: Record<string, UsageMember[]> = {}
  let measured = 0

  for (const guest of [...guests].sort((a, b) => guestKey(a).localeCompare(guestKey(b), undefined, { numeric: true }))) {
    const read = known.get(placedKey(guest))
    if (!read) continue
    measured++
    const member: UsageMember = { type: guest.type, vmid: guest.vmid, node: guest.node, name: guest.name || `${guest.type}/${guest.vmid}` }

    for (const group of read.groups) {
      const carriers = groups[group] ?? []

      carriers.push(member)
      groups[group] = carriers
    }
  }

  return {
    total: guests.length,
    measured,
    unread: guests.length - measured,
    partial: measured < guests.length,
    computedAt: new Date(readAt).toISOString(),
    groups,
  }
}

function begin(connId: string, deps: UsageDeps, opts: { force: boolean; all: boolean }): Promise<GroupUsage> {
  const now = deps.now ?? Date.now
  const owner = () => inflight().get(connId)?.promise === promise
  const promise: Promise<GroupUsage> = (async () => {
    const connGen = generationOf(connId)
    const guests = await deps.listGuests()
    const state: State = cache().get(connId) ?? { known: new Map(), lastMs: 0, readAt: now(), last: null }
    const scope = opts.all ? guests : sampleGuests(guests, USAGE_MAX_GUESTS)
    const floor = usageForceFloorMs(state.lastMs)
    const toRead = scope.filter(g => !g.offline && isStale(state.known.get(placedKey(g)), now(), opts.force ? floor : USAGE_TTL_MS))
    const read = new Map<string, Known>()

    if (toRead.length > 0) {
      const genKey = (g: CoverageGuest) => `${connId}|${guestKey(g)}`
      const startGen = new Map(toRead.map(g => [genKey(g), generationOf(genKey(g))]))
      const gate = createCallGate({ deadline: now() + USAGE_BUDGET_MS, now })
      const started = now()

      await mapWithConcurrency(interleaveByNode(toRead), POOL_GLOBAL_CONCURRENCY, async guest => {
        const rules = await deps.slots(guest.node, () => gate.run(() => deps.fetchRules(guest)))
        if (Array.isArray(rules)) read.set(placedKey(guest), { groups: groupsOf(rules), at: now() })
      })
      // A guest not reached or whose read failed is no longer known: what was kept of it is too old to be told as
      // read (its TTL ran out, or new figures were asked), so it counts as unread and is asked again next time.
      if (generationOf(connId) === connGen) {
        keepReads(state.known, toRead, read, guest => generationOf(genKey(guest)) === startGen.get(genKey(guest)))
      } else {
        state.known.clear()
      }
      if (read.size > 0) {
        state.lastMs = now() - started
        state.readAt = now()
      }
    }

    // What this read saw still answers its own callers, even where a write since keeps it out of what is kept.
    const answer = build(guests, new Map([...state.known, ...read]), state.readAt)
    if (owner()) {
      const present = new Set(guests.map(placedKey))
      for (const key of state.known.keys()) if (!present.has(key)) state.known.delete(key)
      state.last = answer
      cache().set(connId, state)
    }

    return answer
  })().finally(() => {
    if (inflight().get(connId)?.promise === promise) inflight().delete(connId)
  })

  inflight().set(connId, { promise, all: opts.all, force: opts.force })
  // A caller that waited out no longer listens: a failure must not surface as an unhandled rejection.
  promise.catch(() => undefined)

  return promise
}

const WAITED_OUT = Symbol('waited-out')

/**
 * The read that answers what is asked. A running read that covers it is joined. One that does not (a sample while
 * every guest is asked, or not forced) is waited for, then followed by a read of what it left: never two fan-outs
 * at once on a connection.
 */
async function acquire(connId: string, deps: UsageDeps, want: { force: boolean; all: boolean }): Promise<GroupUsage> {
  for (;;) {
    const current = inflight().get(connId)
    if (!current) return begin(connId, deps, want)
    if ((current.all || !want.all) && (current.force || !want.force)) return current.promise
    await current.promise.catch(() => undefined)
  }
}

/**
 * The group usage of a connection. `all` reads every guest instead of the sample; `force` reads again what is older
 * than the force floor. Waits `waitMs` at most; past it `computing` is true and `result` is the previous answer.
 */
export async function getGroupUsage(
  connId: string,
  deps: UsageDeps,
  opts: { force?: boolean; all?: boolean; waitMs?: number } = {},
): Promise<UsageOutcome> {
  const want = { force: !!opts.force, all: !!opts.all }
  if (deps.writesMark) {
    const mark = await deps.writesMark().catch(() => null)
    if (mark !== null) {
      const before = marks().get(connId)
      if (before !== undefined && before !== mark) forgetGroupUsage(connId)
      marks().set(connId, mark)
    }
  }
  const previous = cache().get(connId)?.last ?? null
  const running = acquire(connId, deps, want)

  let timer: ReturnType<typeof setTimeout> | undefined
  const waited = await Promise.race([
    running,
    new Promise<typeof WAITED_OUT>(resolve => { timer = setTimeout(() => resolve(WAITED_OUT), opts.waitMs ?? USAGE_WAIT_MS) }),
  ]).finally(() => clearTimeout(timer))

  if (waited === WAITED_OUT) return { result: previous, computing: true }

  return { result: waited, computing: false }
}
