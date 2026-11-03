/**
 * `diskTotal` of every guest of a connection: the sum of its attached disks,
 * read from each guest config (#938). `maxdisk` keeps its Proxmox meaning
 * (boot disk of a VM, rootfs of a container) and is never rewritten.
 *
 * One `/config` call per guest is what this costs, so the figures live in a
 * process-wide cache keyed by connection and `type/vmid`:
 *  - an entry is reused for TTL_MS minus up to JITTER of it, so the refreshes
 *    of a large fleet spread over several polls instead of landing together;
 *  - an entry is also refreshed when the guest's `maxdisk` moves (a resize of
 *    the boot disk), and dropped when ProxCenter itself changes the disks;
 *  - a guest on an offline node is not asked: every call to a dead node fails
 *    with HTTP 595 after about a second (measured, spec section 9). Its cached
 *    figure, even past its TTL, is still served;
 *  - a failed `/config` keeps the previous figure. With none, the guest gets no
 *    `diskTotal` and the UI falls back on `maxdisk`.
 */
import { hasNICFirewall } from "@/lib/firewall/pveDefaults"
import { pveFetch } from "@/lib/proxmox/client"

import { mapWithConcurrency, PVEPROXY_CONCURRENCY } from "./concurrency"
import { guestUnusedVolumes, sumGuestConfigDisks } from "./guestConfigDisks"

export { guestUnusedVolumes, isGuestDiskKey, sumGuestConfigDisks } from "./guestConfigDisks"

/** Same as the stale window of the inventory cache: no figure outlives it. */
export const DISK_TOTAL_TTL_MS = 15 * 60 * 1_000
/** Share of the TTL an entry may lose at random. */
const JITTER = 0.2

export type DiskTotalGuest = {
  /** Optional only because some projections type it so: a guest without one is skipped. */
  vmid?: string | number
  type: string
  /** Optional for the same reason: without a node there is no config to read, only the cache. */
  node?: string
  maxdisk?: number
  diskTotal?: number
}

/**
 * `nicFirewall`: `firewall=1` on at least one NIC, and `vlans`: the `tag=` of its NICs, from the same config read. The
 * firewall coverage (Dashboard, Firewalling, Security Groups) reads them here instead of asking each guest config
 * again (UA44).
 */
type Entry = { total: number; expiresAt: number; maxdisk?: number; nicFirewall?: boolean; vlans?: number[]; nics?: number }

type FetchConfig = (node: string, type: "qemu" | "lxc", vmid: string) => Promise<unknown>

/** Size in bytes of one storage volume, as the storage reports it. */
type FetchVolumeSize = (node: string, volid: string) => Promise<number>

export type DiskTotalOptions = {
  /**
   * Nodes known online. `null` when node status is unknown (a failed `/nodes`):
   * every guest is then asked, as enrichVmsWithConfig does.
   */
  onlineNodes: Set<string> | null
  /**
   * false: answer from the cache at once and refresh the missing or expired
   * figures in the background, for routes that must not wait on N config reads.
   */
  blocking?: boolean
  /**
   * true: `guests` is a subset of the connection's guests (a vDC session sees its own pools only). The cached figures
   * of the guests left out are kept: they are not gone, only not listed to this caller.
   */
  partial?: boolean
  now?: () => number
  random?: () => number
  fetchConfig?: FetchConfig
}

const STORE_KEY = "__proxcenter_guest_disk_totals__" as const
const INFLIGHT_KEY = "__proxcenter_guest_disk_totals_inflight__" as const

function store(): Map<string, Entry> {
  const g = globalThis as any
  if (!g[STORE_KEY]) g[STORE_KEY] = new Map<string, Entry>()

  return g[STORE_KEY]
}

function inflight(): Map<string, Promise<void>> {
  const g = globalThis as any
  if (!g[INFLIGHT_KEY]) g[INFLIGHT_KEY] = new Map<string, Promise<void>>()

  return g[INFLIGHT_KEY]
}

function guestKind(guest: DiskTotalGuest): "qemu" | "lxc" | null {
  if (guest.vmid === undefined || guest.vmid === null || guest.vmid === "") return null
  if (guest.type === "qemu" || guest.type === "lxc") return guest.type

  return null
}

export function diskTotalKey(connId: string, type: string, vmid: string | number): string {
  return `${connId}::${type}/${vmid}`
}

/** Cached `diskTotal` of a guest, whatever its age. */
export function peekGuestDiskTotal(connId: string, type: string, vmid: string | number): number | undefined {
  return store().get(diskTotalKey(connId, type, vmid))?.total
}

/** Cached NIC firewall flag of a guest (true: a NIC has `firewall=1`), whatever its age; undefined when never read. */
export function peekGuestNicFirewall(connId: string, type: string, vmid: string | number): boolean | undefined {
  return store().get(diskTotalKey(connId, type, vmid))?.nicFirewall
}

/** Cached NIC facts of a guest (firewall flag, VLAN tags), whatever their age; undefined when never read. */
export function peekGuestNet(connId: string, type: string, vmid: string | number): { nicFirewall: boolean; vlans: number[] } | undefined {
  const entry = store().get(diskTotalKey(connId, type, vmid))
  if (entry?.nicFirewall === undefined) return undefined

  return { nicFirewall: entry.nicFirewall, vlans: entry.vlans ?? [] }
}

/**
 * ProxCenter itself set the firewall flag of every NIC of a guest: the cached flag follows at once (the disk figure
 * does not move with it), so the firewall coverage shows the toggle without reading the config again.
 */
export function noteGuestNicFirewall(connId: string, type: string, vmid: string | number, enabled: boolean): void {
  const entry = store().get(diskTotalKey(connId, type, vmid))
  // A guest without a NIC has no flag to set: the toggle changed nothing, it must not read as filtered.
  if (entry && (entry.nics ?? 0) > 0) entry.nicFirewall = enabled
}

/**
 * A guest config read by someone else (the firewall coverage, for a guest the inventory had not read yet): kept like
 * one the inventory read, so neither reads it again before the TTL, and a NIC toggle can follow it. The NIC facts
 * found are returned. A config that is not an object is not kept.
 */
export function rememberGuestConfig(connId: string, type: "qemu" | "lxc", vmid: string | number, config: unknown): { nicFirewall: boolean; vlans: number[] } | null {
  const total = sumGuestConfigDisks(config, type)
  if (total === null) return null
  remember(diskTotalKey(connId, type, vmid), total, { type, vmid }, Date.now, Math.random, config)

  return { nicFirewall: hasNICFirewall(config as Record<string, any>), vlans: configVlans(config) }
}

/** Number of NICs (`netN`) of a config. */
function configNicCount(config: unknown): number {
  if (!config || typeof config !== "object") return 0

  return Object.keys(config as Record<string, unknown>).filter(key => /^net\d+$/.test(key)).length
}

/** VLAN tags of the NICs of a config (`tag=N` on `netN`), sorted, deduplicated. */
export function configVlans(config: unknown): number[] {
  if (!config || typeof config !== "object") return []
  const vlans = new Set<number>()
  for (const [key, value] of Object.entries(config as Record<string, unknown>)) {
    if (!/^net\d+$/.test(key) || typeof value !== "string") continue
    const match = /(?:^|,)tag=(\d+)/.exec(value)
    if (match) vlans.add(Number(match[1]))
  }

  return [...vlans].sort((a, b) => a - b)
}

/** Forget a guest's figure, after ProxCenter itself added, removed or resized one of its disks. */
export function invalidateGuestDiskTotal(connId: string, type: string, vmid: string | number): void {
  store().delete(diskTotalKey(connId, type, vmid))
}

/** Test seam: empty the process-wide cache. */
export function resetGuestDiskTotals(): void {
  store().clear()
  inflight().clear()
}

function isFresh(entry: Entry | undefined, guest: DiskTotalGuest, now: number): boolean {
  if (!entry || entry.expiresAt <= now) return false
  // A different maxdisk means the boot disk was resized: the sum moved too.
  if (typeof guest.maxdisk === "number" && typeof entry.maxdisk === "number" && guest.maxdisk !== entry.maxdisk) return false

  return true
}

function remember(key: string, total: number, guest: DiskTotalGuest, now: () => number, random: () => number, config: unknown): void {
  store().set(key, {
    total,
    expiresAt: now() + DISK_TOTAL_TTL_MS * (1 - JITTER * random()),
    maxdisk: typeof guest.maxdisk === "number" ? guest.maxdisk : undefined,
    nicFirewall: hasNICFirewall(config as Record<string, any> | null),
    vlans: configVlans(config),
    nics: configNicCount(config),
  })
}

function volumeSizeReader(connConfig: unknown): FetchVolumeSize {
  return async (node, volid) => {
    const storage = volid.split(":")[0]
    const info = await pveFetch<any>(
      connConfig as any,
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`,
    )

    return Number(info?.size) || 0
  }
}

function configReader(connConfig: unknown): FetchConfig {
  return (node, kind, vmid) => pveFetch<unknown>(
    connConfig as any,
    `/nodes/${encodeURIComponent(node)}/${kind}/${encodeURIComponent(vmid)}/config`,
  )
}

async function refreshOne(
  key: string,
  guest: DiskTotalGuest,
  kind: "qemu" | "lxc",
  fetchConfig: FetchConfig,
  now: () => number,
  random: () => number,
): Promise<void> {
  const running = inflight().get(key)
  if (running !== undefined) return running

  const job = (async () => {
    let config: unknown = null
    try {
      config = await fetchConfig(guest.node, kind, String(guest.vmid))
    } catch {
      // Keep the previous figure: a failing /config never fails the inventory.
      return
    }
    const total = sumGuestConfigDisks(config, kind)
    if (total === null) return
    remember(key, total, guest, now, random, config)
  })().finally(() => inflight().delete(key))

  inflight().set(key, job)

  return job
}

type StaleGuest = { key: string; guest: DiskTotalGuest; kind: "qemu" | "lxc" }

/** The cache keys of the listed guests, and those whose figure must be read again. */
function collectStale(
  connId: string,
  guests: DiskTotalGuest[],
  onlineNodes: Set<string> | null,
  now: number,
): { live: Set<string>; stale: StaleGuest[] } {
  const cache = store()
  const live = new Set<string>()
  const stale: StaleGuest[] = []

  for (const guest of guests) {
    const kind = guestKind(guest)
    if (!kind) continue
    const key = diskTotalKey(connId, kind, guest.vmid)
    live.add(key)
    const reachable = !!guest.node && (!onlineNodes || onlineNodes.has(guest.node))
    if (reachable && !isFresh(cache.get(key), guest, now)) stale.push({ key, guest, kind })
  }

  return { live, stale }
}

/** Drop the cached figures of the connection's guests that are no longer listed. */
function dropDeparted(connId: string, live: Set<string>): void {
  const cache = store()
  const prefix = `${connId}::`

  for (const key of cache.keys()) {
    if (key.startsWith(prefix) && !live.has(key)) cache.delete(key)
  }
}

/** Copy the cached figures onto the guests, in place. */
function applyTotals(connId: string, guests: DiskTotalGuest[]): void {
  const cache = store()

  for (const guest of guests) {
    const kind = guestKind(guest)
    const entry = kind ? cache.get(diskTotalKey(connId, kind, guest.vmid)) : undefined
    if (entry) guest.diskTotal = entry.total
  }
}

/**
 * Set `diskTotal` on every qemu/lxc guest of ONE connection that has a figure,
 * in place. `guests` must be the connection's complete list: cached figures of
 * guests absent from it (deleted, or moved to another connection) are dropped,
 * unless `partial` says the list is a subset (then nothing is dropped).
 */
export async function attachGuestDiskTotals(
  connConfig: unknown,
  connId: string,
  guests: DiskTotalGuest[],
  opts: DiskTotalOptions,
): Promise<void> {
  const now = opts.now ?? Date.now
  const random = opts.random ?? Math.random
  const fetchConfig: FetchConfig = opts.fetchConfig ?? configReader(connConfig)

  const { live, stale } = collectStale(connId, guests, opts.onlineNodes, now())

  if (guests.length > 0 && !opts.partial) dropDeparted(connId, live)

  const refresh = mapWithConcurrency(stale, PVEPROXY_CONCURRENCY, item =>
    refreshOne(item.key, item.guest, item.kind, fetchConfig, now, random))

  if (opts.blocking === false) {
    refresh.catch(() => {})
  } else {
    await refresh
  }

  applyTotals(connId, guests)
}

/** Online nodes of a `/nodes` answer, or `null` when that call failed and status is unknown. */
export function onlineNodeSet(nodes: Array<{ node?: string; status?: string }> | null | undefined): Set<string> | null {
  if (!nodes) return null

  return new Set(nodes.filter(n => n?.status === "online" && n.node).map(n => String(n.node)))
}

type ReadContext = {
  connId: string
  fetchConfig: FetchConfig
  fetchVolumeSize: FetchVolumeSize
  now: () => number
  random: () => number
}

/** The guest config and the sum of its attached disks, or why it could not be read. */
async function readConfigTotal(
  guest: DiskTotalGuest,
  kind: "qemu" | "lxc",
  ctx: ReadContext,
): Promise<{ config: unknown; total: number | null; reason: string }> {
  if (!guest.node) return { config: null, total: null, reason: "no node" }
  try {
    const config = await ctx.fetchConfig(guest.node, kind, String(guest.vmid))

    return { config, total: sumGuestConfigDisks(config, kind), reason: "no config" }
  } catch (err: any) {
    return { config: null, total: null, reason: err?.message || String(err) }
  }
}

/** Size of every detached volume of the guest; one that cannot be sized is logged and skipped. */
async function sumUnusedVolumes(guest: DiskTotalGuest, kind: string, config: unknown, ctx: ReadContext): Promise<number> {
  const sizes = await Promise.all(guestUnusedVolumes(config).map(volid =>
    ctx.fetchVolumeSize(String(guest.node), volid).catch((err: any) => {
      console.warn(`[disk-total] ${kind}/${guest.vmid} on ${ctx.connId}: size of detached ${volid} unreadable (${err?.message || err})`)

      return 0
    })))

  return sizes.reduce((sum, size) => sum + size, 0)
}

async function readOneGuestBytes(guest: DiskTotalGuest, ctx: ReadContext): Promise<number> {
  const floor = Number(guest.maxdisk) || 0
  const kind = guestKind(guest)
  if (!kind) return floor

  const { config, total, reason } = await readConfigTotal(guest, kind, ctx)
  if (total === null) {
    console.warn(`[disk-total] ${kind}/${guest.vmid} on ${ctx.connId}: config unreadable (${reason}), counting maxdisk`)

    return floor
  }
  remember(diskTotalKey(ctx.connId, kind, guest.vmid), total, guest, ctx.now, ctx.random, config)

  return Math.max(total, floor) + await sumUnusedVolumes(guest, kind, config, ctx)
}

/**
 * Exact disk bytes of each guest, for a quota check or a vDC usage figure:
 * every config is read NOW, never served from the cache (a create or a resize
 * must be weighed against the disks the pool holds at that moment), and the
 * answers refresh the cache on the way. Detached volumes (`unusedN`) still
 * take room on their storage, so their size is asked of the storage and added:
 * detaching a disk must not bring a tenant back under its quota. A guest whose
 * config cannot be read falls back on its `maxdisk`, the floor Proxmox itself
 * reports, and is logged: never 0, which would let a tenant overrun its quota.
 */
export async function readGuestDiskBytes(
  connConfig: unknown,
  connId: string,
  guests: DiskTotalGuest[],
  opts: { fetchConfig?: FetchConfig; fetchVolumeSize?: FetchVolumeSize; now?: () => number; random?: () => number } = {},
): Promise<number[]> {
  const ctx: ReadContext = {
    connId,
    fetchConfig: opts.fetchConfig ?? configReader(connConfig),
    fetchVolumeSize: opts.fetchVolumeSize ?? volumeSizeReader(connConfig),
    now: opts.now ?? Date.now,
    random: opts.random ?? Math.random,
  }

  return mapWithConcurrency(guests, PVEPROXY_CONCURRENCY, guest => readOneGuestBytes(guest, ctx))
}
