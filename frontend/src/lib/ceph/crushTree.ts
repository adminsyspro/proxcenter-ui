import type { CrushBucket } from './crushRules'
import type { CephOsd } from './types'

/*
   Pure model of the CRUSH tab's tree: the buckets of the decompiled CRUSH map joined to the
   inventory OSDs, with the fill (weighted by size), the up/total count, the device classes and
   a problem flag aggregated from the OSDs up to each root. Nothing here renders or fetches.
*/

export interface CrushNode {
  id: number
  name: string
  type: string
  /** Fill (0 to 1) weighted by OSD size. A down OSD reports no fill and weighs nothing. */
  fillRatio: number
  osdUp: number
  osdTotal: number
  classes: string[]
  /** An OSD below is down or out. */
  flagged: boolean
  children: CrushNode[]
}

export interface CrushRow {
  node: CrushNode
  depth: number
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

interface Sums {
  node: CrushNode
  used: number
  total: number
}

function osdSizes(osd: CephOsd): { used: number; total: number; fill: number } {
  const measured = (osd.usedBytes || 0) + (osd.availBytes || 0)
  const total = measured > 0 ? measured : Math.max(0, osd.totalBytes || 0)
  const fill = Number.isFinite(osd.usedPct) ? Math.min(1, Math.max(0, osd.usedPct / 100)) : 0

  return { used: fill * total, total, fill }
}

/** The trees of the map (one per root), OSDs joined by id. A device without an OSD in `osds` is left out. */
export function crushTree(buckets: CrushBucket[], osds: CephOsd[]): CrushNode[] {
  const byId = new Map(buckets.map(b => [b.id, b]))
  const osdById = new Map(osds.map(o => [o.id, o]))
  const childIds = new Set(buckets.flatMap(b => b.children))

  const build = (bucket: CrushBucket, path: Set<number>): Sums | null => {
    if (bucket.type === 'osd') {
      const osd = osdById.get(bucket.id)

      if (!osd) return null

      const { used, total, fill } = osdSizes(osd)

      return {
        node: {
          id: bucket.id,
          name: bucket.name,
          type: 'osd',
          fillRatio: osd.up ? fill : 0,
          osdUp: osd.up ? 1 : 0,
          osdTotal: 1,
          classes: osd.deviceClass ? [osd.deviceClass] : [],
          flagged: !osd.up || !osd.in,
          children: [],
        },
        used: osd.up ? used : 0,
        total: osd.up ? total : 0,
      }
    }

    if (path.has(bucket.id)) return null

    const next = new Set(path).add(bucket.id)
    const kids = bucket.children
      .map(id => byId.get(id))
      .filter((b): b is CrushBucket => b !== undefined)
      .map(b => build(b, next))
      .filter((k): k is Sums => k !== null)
      .sort((a, b) => (a.node.type === 'osd' ? a.node.id - b.node.id : natural(a.node.name, b.node.name)))

    const used = kids.reduce((s, k) => s + k.used, 0)
    const total = kids.reduce((s, k) => s + k.total, 0)

    return {
      node: {
        id: bucket.id,
        name: bucket.name,
        type: bucket.type,
        fillRatio: total > 0 ? used / total : 0,
        osdUp: kids.reduce((s, k) => s + k.node.osdUp, 0),
        osdTotal: kids.reduce((s, k) => s + k.node.osdTotal, 0),
        classes: [...new Set(kids.flatMap(k => k.node.classes))].sort((a, b) => a.localeCompare(b)),
        flagged: kids.some(k => k.node.flagged),
        children: kids.map(k => k.node),
      },
      used,
      total,
    }
  }

  return buckets
    .filter(b => b.type !== 'osd' && !childIds.has(b.id))
    .sort((a, b) => natural(a.name, b.name))
    .map(b => build(b, new Set()))
    .filter((s): s is Sums => s !== null)
    .map(s => s.node)
}

/** Device classes present among the OSDs, sorted. */
export function crushClasses(osds: Pick<CephOsd, 'deviceClass'>[]): string[] {
  return [...new Set(osds.map(o => o.deviceClass).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/** The tree without the buckets that hold no OSD (what a class filter leaves behind). */
export function filterCrushTree(nodes: CrushNode[]): CrushNode[] {
  return nodes
    .filter(n => n.osdTotal > 0)
    .map(n => ({ ...n, children: filterCrushTree(n.children) }))
}

/** The rows to draw, depth first: a node's children follow it only when its id is in `unfolded` (all unfolded when omitted). */
export function flattenCrushNodes(nodes: CrushNode[], unfolded?: ReadonlySet<string>, depth = 0): CrushRow[] {
  return nodes.flatMap(node => [
    { node, depth },
    ...(!unfolded || unfolded.has(String(node.id)) ? flattenCrushNodes(node.children, unfolded, depth + 1) : []),
  ])
}
