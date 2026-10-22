/**
 * Where a Ceph OSD flag applies, for the flag views (ui#1164).
 *
 * The flags route hands the UI three maps: the cluster-wide flags, the flags
 * `ceph osd set-group` set on one CRUSH host and the ones set on one OSD.
 * These helpers turn them into what a table row, a chip list or a node panel
 * shows. Pure and shared, so the components do not each reparse the maps.
 */

import { crushHostMatchesNode } from "@/lib/ceph/nodeNoout"

/** Target (CRUSH host or `osd.<id>`) -> flags set on it, lower-case. */
export type ScopedFlagMap = Record<string, string[]>

export interface ScopedFlag {
  /** The CRUSH host or `osd.<id>` the flag is set on. */
  target: string
  flag: string
  scope: "host" | "osd"
}

/** The key the toggling state holds while one scoped flag is being written. */
export function scopedFlagKey(target: string, flag: string): string {
  return `${target}:${flag}`
}

/** The map as the route serialised it, or anything else: always a clean map. */
export function normalizeScopedFlags(input: unknown): ScopedFlagMap {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  const out: ScopedFlagMap = {}
  for (const [target, flags] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(flags)) continue
    const clean = [...new Set(flags.filter((f): f is string => typeof f === "string").map(f => f.trim().toLowerCase()).filter(Boolean))]
    if (clean.length > 0) out[target] = clean
  }
  return out
}

/** The map once a flag was set or unset on a target; a target left without flags disappears. */
export function withScopedFlag(map: ScopedFlagMap, target: string, flag: string, enable: boolean): ScopedFlagMap {
  const current = map[target] || []
  const next = enable ? [...new Set([...current, flag])] : current.filter(f => f !== flag)
  const out = { ...map }
  if (next.length > 0) out[target] = next
  else delete out[target]
  return out
}

/**
 * The CRUSH host key of a node in a host flag map, and its flags. The bucket
 * is normally named after the node; a cluster that named its hosts with
 * their FQDN still matches on the first label, case-insensitively.
 */
export function hostFlagsForNode(hostFlags: ScopedFlagMap, node: string | null | undefined): { host: string | null; flags: string[] } {
  if (!node) return { host: null, flags: [] }
  const host = Object.keys(hostFlags).find(h => crushHostMatchesNode(h, node)) ?? null
  return { host, flags: host ? hostFlags[host] : [] }
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

// Maintenance's own flag first, then the other group flags, then anything else
// by name: the order of the node's maintenance banner.
const FLAG_ORDER = ["noout", "noin", "noup", "nodown"]
const flagRank = (f: string) => (FLAG_ORDER.includes(f) ? FLAG_ORDER.indexOf(f) : FLAG_ORDER.length)
export const byFlagOrder = (a: string, b: string) => flagRank(a) - flagRank(b) || byName(a, b)

/** One entry per (target, flag): hosts first, then OSDs, each sorted by name. */
export function scopedFlagEntries(hostFlags: ScopedFlagMap, osdFlags: ScopedFlagMap): ScopedFlag[] {
  const flatten = (map: ScopedFlagMap, scope: ScopedFlag["scope"]) =>
    Object.keys(map)
      .sort(byName)
      .flatMap(target => [...map[target]].sort(byFlagOrder).map(flag => ({ target, flag, scope })))
  return [...flatten(hostFlags, "host"), ...flatten(osdFlags, "osd")]
}

/** The flags that apply to one OSD: its own first, then the ones of its host it does not already carry. */
export function flagsOnOsd(
  osdId: number | string,
  host: string | null | undefined,
  osdFlags: ScopedFlagMap,
  hostFlags: ScopedFlagMap,
): ScopedFlag[] {
  const osdName = /^osd\./i.test(String(osdId)) ? String(osdId).toLowerCase() : `osd.${osdId}`
  const own: ScopedFlag[] = (osdFlags[osdName] || []).map(flag => ({ target: osdName, flag, scope: "osd" }))
  const viaHost = hostFlagsForNode(hostFlags, host)
  const seen = new Set(own.map(o => o.flag))
  const inherited: ScopedFlag[] = viaHost.flags
    .filter(flag => !seen.has(flag))
    .map(flag => ({ target: viaHost.host as string, flag, scope: "host" }))
  return [...own, ...inherited]
}

/** Labels for a one-line summary: the cluster flags, then `pve3: noout`. */
export function flagSummaryLabels(flags: string[], hostFlags: ScopedFlagMap, osdFlags: ScopedFlagMap): string[] {
  return [...flags, ...scopedFlagEntries(hostFlags, osdFlags).map(e => `${e.target}: ${e.flag}`)]
}

/** The detail lines of a Ceph health check, as PVE lists them ([{ message }]) or as plain strings. */
export function healthDetailMessages(detail: unknown): string[] {
  if (!Array.isArray(detail)) return []
  return detail
    .map(d => (typeof d === "string" ? d : String((d as any)?.message ?? "")))
    .map(s => s.trim())
    .filter(Boolean)
}
