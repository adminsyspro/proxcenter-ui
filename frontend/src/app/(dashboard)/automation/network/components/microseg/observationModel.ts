/**
 * The bar of the hits column: the share of the busiest flow of the page, in percent. A flow with hits never draws an
 * empty bar (at least 2 %), a page with no hit at all draws none.
 */
export function hitsShare(hits: number, max: number): number {
  if (!Number.isFinite(max) || !Number.isFinite(hits) || max <= 0 || hits <= 0) return 0
  return Math.max(2, Math.round((Math.min(hits, max) / max) * 100))
}

/** The most hits of a flow among `rows` (0 for none). */
export function maxHits(rows: ReadonlyArray<{ hits: number }>): number {
  return rows.reduce((max, r) => Math.max(max, r.hits), 0)
}

/** The observed flows of a page that go to one destination: a zone, or ('outside') an address outside any zone. */
export type ObservationGroup<S> = { key: string; name: string; rows: S[]; hits: number; outside: boolean }

type Destined = { dst_zone_id: string; dst_key?: string }

/** The key a flow is grouped (and folded) on: its destination key, the destination zone for a flow of the first lot. */
export const destinationKey = (s: Destined): string => s.dst_key || s.dst_zone_id

const AGGREGATE_KEYS = new Set(['0.0.0.0/0', '::/0'])

/**
 * What a destination is called: its zone, else the guest that carries the address, else the address; the aggregate of
 * many destinations says so (`many` is its translated label).
 */
export function destinationLabel(
  s: Destined & { dst_ip: string },
  zoneName: (id: string) => string,
  guestName: (ip: string) => string | undefined,
  many = 'Many destinations',
): string {
  if (s.dst_key && AGGREGATE_KEYS.has(s.dst_key)) return many
  if (s.dst_zone_id) return zoneName(s.dst_zone_id)
  const ip = s.dst_ip || s.dst_key || ''
  return guestName(ip) ?? ip
}

/**
 * The flows of a page grouped by destination, in the order of the page within a group: the zones with the most hits
 * first (ties by name, then by key), the destinations outside any zone last. `nameOf` names a group from its key and
 * its first flow.
 */
export function groupByDestination<S extends Destined & { hits: number }>(rows: readonly S[], nameOf: (key: string, first: S) => string): ObservationGroup<S>[] {
  const groups = new Map<string, ObservationGroup<S>>()
  for (const r of rows) {
    const key = destinationKey(r)
    let group = groups.get(key)
    if (!group) {
      group = { key, name: nameOf(key, r), rows: [], hits: 0, outside: !r.dst_zone_id }
      groups.set(key, group)
    }
    group.rows.push(r)
    group.hits += r.hits
  }
  const outsideLast = (g: ObservationGroup<S>) => (g.outside ? 1 : 0)
  // Ties end on the key, so two destinations of the same hits and name never swap between renders.
  return [...groups.values()].sort((a, b) => outsideLast(a) - outsideLast(b) || b.hits - a.hits || a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}

const isIPv6 = (ip: string) => ip.includes(':')

/** The prefix lengths an address can be accepted as: IPv4 /8 to /32 (/24 proposed), IPv6 /16 to /128 (/64 proposed). */
export function prefixBounds(ip: string): { min: number; max: number; def: number } {
  return isIPv6(ip) ? { min: 16, max: 128, def: 64 } : { min: 8, max: 32, def: 24 }
}

/** The 8 groups of 16 bits of an IPv6 address ('::' expanded), null when it does not parse. */
function ipv6Groups(ip: string): number[] | null {
  const [head, tail, ...rest] = ip.split('::')
  if (rest.length > 0) return null
  const parse = (part: string | undefined) => (part ? part.split(':') : [])
  const left = parse(head)
  const right = tail === undefined ? [] : parse(tail)
  const fill = tail === undefined ? 0 : 8 - left.length - right.length
  if (fill < 0 || (tail === undefined && left.length !== 8)) return null
  const groups = [...left, ...new Array<string>(fill).fill('0'), ...right].map(g => (/^[0-9a-f]{1,4}$/i.test(g) ? Number.parseInt(g, 16) : Number.NaN))
  return groups.length === 8 && groups.every(Number.isFinite) ? groups : null
}

/** Shortest text of an IPv6 address: the first longest run of two or more zero groups becomes '::'. */
function ipv6Text(groups: number[]): string {
  let best = { at: -1, len: 0 }
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > best.len) best = { at: i, len: j - i }
    i = j
  }
  const hex = (gs: number[]) => gs.map(g => g.toString(16)).join(':')
  if (best.len < 2) return hex(groups)
  return `${hex(groups.slice(0, best.at))}::${hex(groups.slice(best.at + best.len))}`
}

/** The network an address falls in at a prefix length, as 'network/len' ('ip/len' unchanged when it does not parse). */
export function cidrPreview(ip: string, len: number): string {
  if (isIPv6(ip)) {
    const groups = ipv6Groups(ip)
    if (!groups) return `${ip}/${len}`
    const masked = groups.map((g, i) => {
      const bits = Math.max(0, Math.min(16, len - i * 16))
      return bits === 16 ? g : (g >> (16 - bits)) << (16 - bits) & 0xffff
    })
    return `${ipv6Text(masked)}/${len}`
  }
  const octets = ip.split('.').map(Number)
  if (octets.length !== 4 || octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)) return `${ip}/${len}`
  const masked = octets.map((o, i) => {
    const bits = Math.max(0, Math.min(8, len - i * 8))
    return bits === 8 ? o : (o >> (8 - bits)) << (8 - bits) & 0xff
  })
  return `${masked.join('.')}/${len}`
}

/** The collapsed groups as stored in this browser: a JSON list of zone ids, anything else is none. */
export function decodeCollapsed(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export const encodeCollapsed = (keys: string[]) => JSON.stringify(keys)
