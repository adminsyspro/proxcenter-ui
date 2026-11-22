// src/lib/microseg/volume.ts
//
// The sFlow volume between the zones of a policy (GET /volume), pure: merging the clusters of a shared policy, the
// volume of the flows a line or an edge stands for, and the width of an edge. No request here.

import { formatBytes } from '@/utils/format'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegVolume, MicrosegVolumeBucket } from './types'

/** A volume: its bytes, its packets and, when the orchestrator counts them, the sFlow samples it is estimated from. */
export type VolumeFigure = { bytes: number; packets: number; samples?: number }

/** Under this many samples a volume is an order of magnitude, not a measure: sFlow keeps one packet in hundreds. */
export const VOLUME_FEW_SAMPLES = 10

/** Adds a row (or a figure) to a figure: its bytes, its packets, and its samples when it tells them. */
export function addVolume(sum: VolumeFigure, row: VolumeFigure): void {
  sum.bytes += row.bytes
  sum.packets += row.packets
  if (row.samples) sum.samples = (sum.samples ?? 0) + row.samples
}

/**
 * The bytes of a volume as every view writes them (map labels and cards, matrix, Sankey, panels, Dashboard): "≈"
 * ahead of an estimate on too few samples.
 */
export const volumeText = (figure: VolumeFigure, digits: number): string => `${fewSamples(figure) ? '≈ ' : ''}${formatBytes(figure.bytes, digits)}`

/** True when a volume stands on too few samples to be read as a measure (unknown when the samples are not told). */
export const fewSamples = (figure: VolumeFigure | null | undefined): boolean =>
  !!figure && figure.bytes > 0 && figure.samples !== undefined && figure.samples > 0 && figure.samples < VOLUME_FEW_SAMPLES

/** True when `port` is in a port list such as "22", "80,443" or "8000:8080". An empty list is every port. */
export function portInSpec(port: number, spec: string): boolean {
  if (!spec.trim()) return true
  return spec.split(',').some(part => {
    const [low, high] = part.split(':').map(s => Number.parseInt(s.trim(), 10))
    return high === undefined ? port === low : port >= low && port <= high
  })
}

/** A protocol name as the policy writes it: lowercase, the ICMPv6 aliases as "icmpv6". */
export function protoOf(name: string): string {
  const p = name.trim().toLowerCase()
  return p === 'icmp6' || p === 'ipv6-icmp' ? 'icmpv6' : p
}

/**
 * What a flow, an observed flow or a service stands for: from a zone to a zone (by name, '' for no zone, null for any),
 * a protocol and a port list.
 */
export type VolumeRule = { src: string | null; dst: string | null; proto: string; dport: string }

/**
 * The answers of the clusters of a shared policy as one: each cluster counts the packets its own guests send (or
 * receive from outside), so their rows add up. `covered` when sFlow measures any of them. Null without any answer.
 */
export function mergeVolume(answers: readonly MicrosegVolume[]): MicrosegVolume | null {
  if (answers.length === 0) return null
  if (answers.length === 1) return answers[0]
  const latest = answers.reduce((a, b) => (Date.parse(b.to) > Date.parse(a.to) ? b : a), answers[0])
  return { ...latest, covered: answers.some(a => a.covered), buckets: answers.flatMap(a => a.buckets) }
}

const zoneKey = (name: string) => name.trim().toLowerCase()

/**
 * True when a row is one of the services of a rule: same zones (whatever the case), the rule's protocol ('any' for
 * every one) and, for TCP and UDP, a port of its list (an empty list is every port).
 */
export function ruleMatches(rule: VolumeRule, row: Pick<MicrosegVolumeBucket, 'src_zone' | 'dst_zone' | 'proto' | 'port'>): boolean {
  if (rule.src !== null && zoneKey(rule.src) !== zoneKey(row.src_zone)) return false
  if (rule.dst !== null && zoneKey(rule.dst) !== zoneKey(row.dst_zone)) return false
  const proto = protoOf(rule.proto || 'any')
  if (proto !== 'any' && proto !== row.proto) return false
  if (row.proto !== 'tcp' && row.proto !== 'udp') return true
  return portInSpec(row.port, rule.dport ?? '')
}

/**
 * The rules of allowed flows and observed flows, their zones by name (`zoneName` answers undefined for a zone that is
 * gone: its flows are left out). A CIDR end, or an observed end in no zone, is '' (every address in no zone).
 */
export function flowRules(flows: readonly MicrosegFlow[], observed: readonly MicrosegSuggestion[], zoneName: (zoneId: string) => string | undefined): VolumeRule[] {
  const end = (zoneId: string, cidr: string) => (cidr || !zoneId ? '' : zoneName(zoneId))
  const out: VolumeRule[] = []
  for (const f of flows) {
    const src = end(f.src_zone_id, f.src_cidr)
    const dst = end(f.dst_zone_id, f.dst_cidr)
    if (src === undefined || dst === undefined || (src === '' && dst === '')) continue
    out.push({ src, dst, proto: f.proto, dport: f.dport })
  }
  for (const o of observed) {
    const src = end(o.src_zone_id, '')
    const dst = end(o.dst_zone_id, '')
    if (src === undefined || dst === undefined || (src === '' && dst === '')) continue
    out.push({ src, dst, proto: o.proto, dport: o.dport })
  }
  return out
}

/** The rule of a service token ("tcp/5432", "udp/53,123", "icmp") between two zones, any zone when null. */
export function tokenRule(token: string, src: string | null = null, dst: string | null = null): VolumeRule {
  const slash = token.indexOf('/')
  return { src, dst, proto: slash < 0 ? token : token.slice(0, slash), dport: slash < 0 ? '' : token.slice(slash + 1) }
}

/** The bytes and packets of the rows any rule matches, each row counted once (two flows may cover one port). */
export function volumeOf(rows: readonly MicrosegVolumeBucket[], rules: readonly VolumeRule[]): VolumeFigure {
  const sum: VolumeFigure = { bytes: 0, packets: 0 }
  if (!rules.length) return sum
  for (const row of rows) {
    if (!rules.some(rule => ruleMatches(rule, row))) continue
    addVolume(sum, row)
  }
  return sum
}

/**
 * The bytes the rows matching `rules` carried in each of the `count` steps of `stepMs` from `from` (ms since the
 * epoch), zero where nothing was measured: the series of an edge's sparkline.
 */
export function volumeSeries(rows: readonly MicrosegVolumeBucket[], rules: readonly VolumeRule[], from: number, stepMs: number, count: number): number[] {
  const out = new Array<number>(count).fill(0)
  if (!rules.length || !(stepMs > 0)) return out
  for (const row of rows) {
    const i = Math.floor((Date.parse(row.at) - from) / stepMs)
    if (i < 0 || i >= count || !rules.some(rule => ruleMatches(rule, row))) continue
    out[i] += row.bytes
  }
  return out
}

/** The one zone every rule names on a side (`src` or `dst`), to narrow a read; undefined when they differ or say any. */
export function sharedEnd(rules: readonly VolumeRule[], side: 'src' | 'dst'): string | undefined {
  const ends = new Set(rules.map(rule => rule[side]))
  const [only] = [...ends]
  return ends.size === 1 && only !== null ? only : undefined
}

/** The bytes and packets of every row, or of those whose source zone is `src` and destination zone is `dst` when given. */
export function totalOf(rows: readonly MicrosegVolumeBucket[], pair?: { src: string; dst: string }): VolumeFigure {
  const sum: VolumeFigure = { bytes: 0, packets: 0 }
  for (const row of rows) {
    if (pair && (zoneKey(row.src_zone) !== zoneKey(pair.src) || zoneKey(row.dst_zone) !== zoneKey(pair.dst))) continue
    addVolume(sum, row)
  }
  return sum
}

/** The services of the rows, from the largest: "tcp/5432", "icmp", "other". */
export function volumeByService(rows: readonly MicrosegVolumeBucket[]): Map<string, VolumeFigure> {
  const out = new Map<string, VolumeFigure>()
  for (const row of rows) {
    const key = row.proto === 'tcp' || row.proto === 'udp' ? `${row.proto}/${row.port}` : row.proto
    const cur = out.get(key) ?? { bytes: 0, packets: 0 }
    out.set(key, { bytes: cur.bytes + row.bytes, packets: cur.packets + row.packets })
  }
  return new Map([...out.entries()].sort((a, b) => b[1].bytes - a[1].bytes))
}

/** The bars of the volume gauge of an edge. */
export const VOLUME_LEVELS = 4

/**
 * The bars lit on the gauge of an edge carrying `bytes`, on a map whose largest edge carries `max`: on a log scale
 * from 1 to VOLUME_LEVELS, so an edge 1000 times smaller still lights one. 0 without volume (no gauge).
 */
export function volumeLevel(bytes: number, max: number): number {
  if (!(bytes > 0) || !(max > 0)) return 0
  const ratio = Math.min(1, Math.log1p(bytes) / Math.log1p(max))
  return Math.max(1, Math.ceil(ratio * VOLUME_LEVELS))
}

/** The window of a period, ending now: the volume read keeps 7 days at most. */
export const VOLUME_PERIOD_MS = { '1h': 3_600_000, '6h': 21_600_000, '24h': 86_400_000, '7d': 604_800_000 } as const
export type VolumePeriod = keyof typeof VOLUME_PERIOD_MS

/**
 * The period the volume is told over when the map shows the flows seen whenever: the last 24 hours (a volume is read
 * as a recent activity; the 7 days the history keeps are a period of the map like the others).
 */
export const VOLUME_DEFAULT_PERIOD: VolumePeriod = '24h'

/** The period of the volume for a period of the map. */
export const volumePeriodOf = (period: VolumePeriod | 'all'): VolumePeriod => (period === 'all' ? VOLUME_DEFAULT_PERIOD : period)

/** The totals window of a map period ("all": the last 24 hours). Aligned on the minute, so the key of the read moves once a minute. */
export function volumeWindow(now: number, period: VolumePeriod | 'all'): { from: string; to: string } {
  const to = Math.ceil(now / 60_000) * 60_000
  const ms = VOLUME_PERIOD_MS[volumePeriodOf(period)]
  return { from: new Date(to - ms).toISOString(), to: new Date(to).toISOString() }
}
