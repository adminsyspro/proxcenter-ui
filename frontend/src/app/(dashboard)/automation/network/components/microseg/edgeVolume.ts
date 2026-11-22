import type { MicrosegVolumeBucket } from '@/lib/microseg/types'
import { addVolume, flowRules, ruleMatches, sharedEnd, volumeLevel, volumeOf, type VolumeFigure, type VolumeRule } from '@/lib/microseg/volume'

import type { GuestVolumeRow } from './useZoneVolume'
import { volumeEnd, zoneLevelEnd, type MapEdgeData } from './zoneGraph'

export { volumeEnd, zoneLevelEnd }

/** A guest as the volume by pair of guests names it: its VMID in its cluster. */
export type VolumeGuestRef = { conn: string; vmid: number }

/**
 * The volume shown on an edge, the bars of its gauge (0: no gauge), `shared` when some of the traffic its flows stand
 * for is shown on another edge (or on none, being drawn on several): its own figure leaves it out, and `rules`, the
 * pairs of zones and services it shows, one rule each, for its chart to draw that same traffic. A shared edge between
 * one pair of zones also has the volume of that whole pair (`pair`, by zone name, '' for no zone), the figure of its
 * panel. `guest`: the edge is drawn from or to a guest, its volume is that of this guest (`src`, `dst`: the VMIDs of
 * its ends that are guests), read by pair of guests. `untold`: the edge is shared only with traffic of its zones no
 * guest is named for (counted before the pairs of guests were kept, or past their bound), none of it on another edge.
 */
export type EdgeVolume = {
  figure: VolumeFigure; level: number; shared: boolean; untold: boolean; rules: VolumeRule[]
  pair: { from: string; to: string; figure: VolumeFigure } | null
  guest?: { conn: string; src?: number; dst?: number }
}

/** The volume by pair of guests of the map: its rows, and the guest a node of the map stands for (undefined: none). */
export type GuestVolumes = { rows: readonly GuestVolumeRow[]; of: (nodeId: string) => VolumeGuestRef | undefined }

type VolumeEdge = { id: string; source: string; target: string; data?: unknown }
type Claim = { id: string; allowed: boolean; rules: VolumeRule[]; source?: VolumeGuestRef; target?: VolumeGuestRef; spec: number }
/** A row of volume: between two zones for a service, and, when told by pair of guests, its cluster and VMIDs. */
type Row = Pick<MicrosegVolumeBucket, 'src_zone' | 'dst_zone' | 'proto' | 'port' | 'bytes' | 'packets' | 'samples'> & { conn?: string; src?: number; dst?: number }

/**
 * The share of a volume between two zones the pairs of guests must leave untold for it to count as untold: under it,
 * the gap is the minute between the two reads (the totals between the zones, then by pair of guests), not traffic.
 */
const UNTOLD_MIN = 0.05

const zoneServiceKey = (r: Pick<Row, 'src_zone' | 'dst_zone' | 'proto' | 'port'>) => `${r.src_zone.trim().toLowerCase()}|${r.dst_zone.trim().toLowerCase()}|${r.proto}|${r.port}`

/**
 * The rows the edges share: those told by pair of guests, then, per pair of zones and service, what the volume
 * between the zones holds beyond them (counted before the pairs of guests were kept, or past their bound), which no
 * guest can be named for.
 */
function detailedRows(rows: readonly MicrosegVolumeBucket[], guestRows: readonly GuestVolumeRow[]): Row[] {
  const told = new Map<string, VolumeFigure>()
  const out: Row[] = []
  for (const g of guestRows) {
    const key = zoneServiceKey(g)
    const sum = told.get(key) ?? { bytes: 0, packets: 0 }
    addVolume(sum, g)
    told.set(key, sum)
    out.push({ src_zone: g.src_zone, dst_zone: g.dst_zone, proto: g.proto, port: g.port, bytes: g.bytes, packets: g.packets, samples: g.samples, conn: g.conn, src: g.src_vmid, dst: g.dst_vmid })
  }
  const zones = new Map<string, Row>()
  for (const r of rows) {
    const key = zoneServiceKey(r)
    const sum = zones.get(key)
    if (sum) addVolume(sum, r)
    else zones.set(key, { src_zone: r.src_zone, dst_zone: r.dst_zone, proto: r.proto, port: r.port, bytes: r.bytes, packets: r.packets, samples: r.samples })
  }
  for (const [key, z] of zones) {
    const part = told.get(key)
    const bytes = z.bytes - (part?.bytes ?? 0)
    if (bytes <= z.bytes * UNTOLD_MIN) continue
    const samples = z.samples === undefined ? undefined : Math.max(0, z.samples - (part?.samples ?? 0))
    out.push({ ...z, bytes, packets: Math.max(0, z.packets - (part?.packets ?? 0)), samples })
  }
  return out
}

/** True when the end of an edge (a guest, or undefined for a zone, a box or an address) is the end of a row. */
function endIs(end: VolumeGuestRef | undefined, row: Row, vmid: number | undefined): boolean {
  if (!end) return true
  return vmid !== undefined && row.conn === end.conn && vmid === end.vmid
}

/**
 * The sFlow volume of the edges of the map, every measured byte shown on one edge at most. The volume is kept per pair
 * of zones and service, and by pair of guests, and the same traffic can be drawn on several edges (an allowed flow,
 * still in the draft, and the observed flow it will cover; one observed flow drawn from several ends): a row goes to
 * the allowed (or Outside) edge whose flows match it, else to the observed edge that matches it the closest (drawn
 * from its guest to its guest, then from or to one of them, then between its zones), else, matched as closely by
 * several observed edges, to none of them. Without the volume by pair of guests (`guests` absent or empty), the edges
 * are told by their zones only. The gauges compare what each edge shows. An exception (guest to guest) has none.
 * `since` (epoch ms) is where the rows start: a blocked flow the firewall last refused before it takes none of them,
 * what is measured since then being traffic that went through, not what was refused.
 */
export function edgeVolumes(
  edges: readonly VolumeEdge[], rows: readonly MicrosegVolumeBucket[], zoneName: (zoneId: string) => string | undefined, guests?: GuestVolumes, since?: number,
): Map<string, EdgeVolume> {
  const byGuest = !!guests && guests.rows.length > 0
  const claims: Claim[] = edges.flatMap(e => {
    const d = e.data as MapEdgeData | undefined
    if (!d || d.kind === 'exception' || !volumeEnd(e.source) || !volumeEnd(e.target)) return []
    const source = byGuest ? guests.of(e.source) : undefined
    const target = byGuest ? guests.of(e.target) : undefined
    const observed = d.kind === 'blocked' && since !== undefined ? d.observed.filter(o => !(Date.parse(o.last_seen) < since)) : d.observed
    return [{
      id: e.id, allowed: d.kind !== 'unprotected' && d.kind !== 'blocked', rules: flowRules(d.flows, observed, zoneName),
      source, target, spec: (source ? 1 : 0) + (target ? 1 : 0),
    }]
  })
  const all: Row[] = byGuest ? detailedRows(rows, guests.rows) : [...rows]
  const figures = new Map<string, VolumeFigure>(claims.map(c => [c.id, { bytes: 0, packets: 0 }]))
  const owned = new Map<string, Map<string, VolumeRule>>(claims.map(c => [c.id, new Map()]))
  const shared = new Set<string>()
  // Shared with another edge (an allowed flow, or an edge as close): told apart from the traffic no guest is named for.
  const elsewhere = new Set<string>()
  const share = (c: Claim, withEdge: boolean) => {
    shared.add(c.id)
    if (withEdge) elsewhere.add(c.id)
  }
  for (const row of all) {
    const byRule = claims.filter(c => c.rules.some(rule => ruleMatches(rule, row)))
    if (!byRule.length) continue
    const exact = byRule.filter(c => endIs(c.source, row, row.src) && endIs(c.target, row, row.dst))
    const allowed = exact.filter(c => c.allowed)
    let owner: Claim | null = null
    if (allowed.length) {
      owner = allowed[0]
      // The traffic of an observed flow the allowed flow covers is on the allowed edge.
      for (const c of byRule) if (c !== owner) share(c, true)
    } else {
      const closest = Math.max(-1, ...exact.map(c => c.spec))
      const tied = exact.filter(c => c.spec === closest)
      if (tied.length === 1) owner = tied[0]
      else for (const c of tied) share(c, true)
      // A row no guest is named for may be the traffic of any edge drawn from a guest of its zones.
      if (byGuest && row.src === undefined) for (const c of byRule) if (c !== owner && c.spec > 0) share(c, false)
    }
    if (!owner) continue
    const port = row.proto === 'tcp' || row.proto === 'udp' ? String(row.port) : ''
    owned.get(owner.id)!.set(zoneServiceKey(row), { src: row.src_zone, dst: row.dst_zone, proto: row.proto, dport: port })
    addVolume(figures.get(owner.id)!, row)
  }
  const max = Math.max(0, ...[...figures.values()].map(f => f.bytes))
  const pairOf = (c: Claim): EdgeVolume['pair'] => {
    const from = sharedEnd(c.rules, 'src')
    const to = sharedEnd(c.rules, 'dst')
    if (from === undefined || to === undefined) return null
    return { from, to, figure: volumeOf(rows, [{ src: from, dst: to, proto: 'any', dport: '' }]) }
  }
  const guestOf = (c: Claim): EdgeVolume['guest'] => {
    const end = c.source ?? c.target
    if (!end || (c.source && c.target && c.source.conn !== c.target.conn)) return undefined
    return { conn: end.conn, ...(c.source ? { src: c.source.vmid } : {}), ...(c.target ? { dst: c.target.vmid } : {}) }
  }
  return new Map(claims.map(c => {
    const figure = figures.get(c.id)!
    const pair = shared.has(c.id) ? pairOf(c) : null
    const guest = guestOf(c)
    const untold = shared.has(c.id) && !elsewhere.has(c.id)
    return [c.id, { figure, level: volumeLevel(figure.bytes, max), shared: shared.has(c.id), untold, rules: [...owned.get(c.id)!.values()], pair, ...(guest ? { guest } : {}) }]
  }))
}
