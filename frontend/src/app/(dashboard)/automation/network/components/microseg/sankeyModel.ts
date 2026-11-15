import type { MicrosegZone } from '@/lib/microseg/types'

import { flowService } from './FlowSummary'
import { cellView, type MatrixModel } from './matrixModel'
import { OUTSIDE_ID, type FlowFilters, type MapEdgeKind } from './zoneGraph'
import { byText } from './zoneLayout'

/** The widest observed ribbon (the busiest pair), the thinnest one, and the width of an allowed ribbon (no counter). */
export const MAX_W = 48
export const MIN_W = 2
export const ALLOWED_W = 3
/** Room between two nodes of a column, and the least height a node takes there (its two lines of label). */
export const NODE_GAP = 24
export const MIN_PITCH = 28

/** The drawing: the bars, the room their labels take outside them, the headings above, the margin under. */
export const BAR_W = 12
export const LABEL_W = 210
export const HEAD = 30
export const FOOT = 16
/** The compact drawing (scaled to the map), used when no size is known or the map is narrower than FILL_MIN_WIDTH. */
export const COMPACT_W = 960
export const FILL_MIN_WIDTH = 720
/** The width at which the compact drawing switches to filling the box; it keeps filling down to FILL_MIN_WIDTH (hysteresis). */
export const FILL_ENTER_WIDTH = 735
/** Filling the map: the bars at about 22 % and 78 % of the width, the widest observed ribbon at most MAX_FILL_W. */
export const LEFT_AT = 0.22
export const RIGHT_AT = 0.78
export const MAX_FILL_W = 96
/** The most room between two nodes when a column is spread over the height; what is left centres the column. */
export const MAX_FILL_GAP = 120

/** The size of the map box the diagram fills, in px. */
export type SankeySize = { width: number; height: number }

export type SankeyNode = { id: string; zone: MicrosegZone | null; hits: number; y: number; height: number }

export type Ribbon = {
  /** `${kind}:${cell id}`: a pair of the matrix has up to three ribbons. */
  id: string
  /** The cell of the matrix the ribbon belongs to: the flow panel of its pair. */
  cell: string
  source: string
  target: string
  kind: MapEdgeKind
  /** The hits of its observed flows (0 for an allowed ribbon). */
  hits: number
  /** How many flows (allowed) or observed flows the ribbon stands for. */
  count: number
  services: string[]
  width: number
  /** The top of the ribbon at its source and at its target. */
  y0: number
  y1: number
}

export type SankeyLayout = {
  sources: SankeyNode[]
  targets: SankeyNode[]
  ribbons: Ribbon[]
  /** The height of the nodes (the headings and the margin under come on top). */
  height: number
  /** The width of the drawing and the left edge of the source bars and of the destination bars. */
  width: number
  leftX: number
  rightX: number
  /** Drawn at its size in px to fill the map (else scaled from COMPACT_W). */
  fill: boolean
}

const KIND_ORDER: Record<MapEdgeKind, number> = { unprotected: 0, blocked: 1, allowed: 2, outside: 3 }
const round = (v: number) => Math.round(v * 10) / 10

/** The width of an observed ribbon: the square root of its hits against the busiest one (at `maxW`), never under MIN_W. */
export function ribbonWidth(hits: number, maxHits: number, maxW = MAX_W): number {
  if (hits <= 0 || maxHits <= 0) return MIN_W
  return Math.max(MIN_W, round(maxW * Math.sqrt(hits / maxHits)))
}

type Draft = Omit<Ribbon, 'width' | 'y0' | 'y1'>

/** The ribbons of every cell the checkboxes leave something in: unprotected, blocked, allowed. */
function draftRibbons(model: MatrixModel, filters: FlowFilters): Draft[] {
  const out: Draft[] = []
  for (const cell of model.cells.values()) {
    const view = cellView(cell, filters, null)
    if (!view) continue
    const base = { cell: cell.id, source: cell.source, target: cell.target }
    for (const kind of ['unprotected', 'blocked'] as const) {
      const seen = view.observed.filter(s => (s.kind === 'blocked') === (kind === 'blocked'))
      if (seen.length) {
        out.push({ ...base, id: `${kind}:${cell.id}`, kind, hits: seen.reduce((sum, s) => sum + s.hits, 0), count: seen.length, services: [...new Set(seen.map(s => flowService(s)))].sort(byText) })
      }
    }
    if (view.flows.length) {
      const kind: MapEdgeKind = cell.target === OUTSIDE_ID ? 'outside' : 'allowed'
      out.push({ ...base, id: `${kind}:${cell.id}`, kind, hits: 0, count: view.flows.length, services: view.services })
    }
  }
  return out
}

const nameOf = (zone: MicrosegZone | null, id: string) => zone?.name ?? id

/** The height the nodes of a column take, their least pitch each, without the gaps. */
const columnContent = (nodes: Pick<SankeyNode, 'height'>[]) => nodes.reduce((sum, n) => sum + Math.max(n.height, MIN_PITCH), 0)

/**
 * The nodes of a column, busiest first (ties by name), stacked from the top: MIN_PITCH at least, NODE_GAP between.
 * Given the height to fill, the gaps grow (up to MAX_FILL_GAP) so the column spans it, and what is left centres it.
 */
function stack(ids: string[], ribbons: Ribbon[], end: 'source' | 'target', zoneOf: (id: string) => MicrosegZone | null, available: number | null): SankeyNode[] {
  const nodes = ids.map(id => {
    const own = ribbons.filter(r => r[end] === id)
    return { id, zone: zoneOf(id), hits: own.reduce((s, r) => s + r.hits, 0), y: 0, height: round(own.reduce((s, r) => s + r.width, 0)) }
  })
  nodes.sort((a, b) => b.hits - a.hits || byText(nameOf(a.zone, a.id), nameOf(b.zone, b.id)) || byText(a.id, b.id))
  let gap = NODE_GAP
  let top = 0
  if (available !== null) {
    const content = columnContent(nodes)
    if (nodes.length > 1) gap = Math.min(MAX_FILL_GAP, Math.max(NODE_GAP, (available - content) / (nodes.length - 1)))
    top = Math.max(0, (available - content - gap * (nodes.length - 1)) / 2)
  }
  for (const n of nodes) {
    n.y = round(top)
    top += Math.max(n.height, MIN_PITCH) + gap
  }
  return nodes
}

/** The tallest column with ribbons at most `maxW` wide and the least gaps. */
function tallestColumn(drafts: Draft[], maxHits: number, maxW: number): number {
  const width = (d: Draft) => (d.hits ? ribbonWidth(d.hits, maxHits, maxW) : ALLOWED_W)
  const column = (end: 'source' | 'target') => {
    const heights = new Map<string, number>()
    for (const d of drafts) heights.set(d[end], (heights.get(d[end]) ?? 0) + width(d))
    const nodes = [...heights.values()].map(h => ({ height: round(h) }))
    return columnContent(nodes) + NODE_GAP * Math.max(0, nodes.length - 1)
  }
  return Math.max(column('source'), column('target'))
}

/** The widest ribbon (MAX_W to MAX_FILL_W) whose tallest column still fits `available`: the bars scale with the map. */
function fillMaxWidth(drafts: Draft[], maxHits: number, available: number): number {
  if (tallestColumn(drafts, maxHits, MAX_W) >= available) return MAX_W
  let low = MAX_W
  let high = MAX_FILL_W
  for (let i = 0; i < 20; i++) {
    const mid = (low + high) / 2
    if (tallestColumn(drafts, maxHits, mid) <= available) low = mid
    else high = mid
  }
  return Math.floor(low)
}

/** Where the bars go: at LEFT_AT and RIGHT_AT of the width, never so near an edge that a label would be cut. */
function columnsAt(width: number): { leftX: number; rightX: number } {
  return {
    leftX: Math.max(LABEL_W, Math.round(width * LEFT_AT) - BAR_W),
    rightX: Math.min(width - LABEL_W - BAR_W, Math.round(width * RIGHT_AT)),
  }
}

/** The ribbons of each node side by side, in the order of their other end, then unprotected, blocked, allowed. */
function placeEnds(nodes: SankeyNode[], ribbons: Ribbon[], end: 'source' | 'target', otherRank: Map<string, number>) {
  const other = end === 'source' ? 'target' : 'source'
  const key = end === 'source' ? 'y0' : 'y1'
  for (const n of nodes) {
    let y = n.y
    const own = ribbons.filter(r => r[end] === n.id)
    own.sort((a, b) => otherRank.get(a[other])! - otherRank.get(b[other])! || KIND_ORDER[a.kind] - KIND_ORDER[b.kind])
    for (const r of own) {
      r[key] = round(y)
      y += r.width
    }
  }
}

/**
 * The Sankey rendering of the matrix: the sources on the left (zones, Unknown / External), the destinations on the
 * right (zones, Outside), one ribbon per pair and kind. An observed ribbon is as wide as the square root of its
 * hits (the busiest at MAX_W, never under MIN_W); an allowed one has no counter and stays ALLOWED_W wide. A node is
 * as tall as its ribbons. The three checkboxes filter the ribbons. Given the size of the map (at least
 * FILL_MIN_WIDTH wide), it fills it: the bars at LEFT_AT and RIGHT_AT of the width, the ribbons widened (up to
 * MAX_FILL_W) so the tallest column uses the height under the headings, the columns spread over it. Pure and deterministic.
 */
export function buildSankey(model: MatrixModel, filters: FlowFilters, size?: SankeySize | null): SankeyLayout {
  const fill = !!size && size.width >= FILL_MIN_WIDTH
  const width = fill ? size.width : COMPACT_W
  const geometry = fill ? { width, ...columnsAt(width), fill } : { width, leftX: LABEL_W, rightX: COMPACT_W - LABEL_W - BAR_W, fill }
  const drafts = draftRibbons(model, filters)
  if (!drafts.length) return { sources: [], targets: [], ribbons: [], height: 0, ...geometry }
  const maxHits = Math.max(0, ...drafts.map(d => d.hits))
  const available = fill ? Math.max(0, size.height - HEAD - FOOT) : null
  const maxW = available === null ? MAX_W : fillMaxWidth(drafts, maxHits, available)
  const ribbons: Ribbon[] = drafts.map(d => ({ ...d, width: d.hits ? ribbonWidth(d.hits, maxHits, maxW) : ALLOWED_W, y0: 0, y1: 0 }))
  const zones = new Map([...model.rows, ...model.cols].map(e => [e.id, e.zone]))
  const zoneOf = (id: string) => zones.get(id) ?? null
  const sources = stack([...new Set(ribbons.map(r => r.source))], ribbons, 'source', zoneOf, available)
  const targets = stack([...new Set(ribbons.map(r => r.target))], ribbons, 'target', zoneOf, available)
  const rank = (nodes: SankeyNode[]) => new Map(nodes.map((n, i) => [n.id, i]))
  placeEnds(sources, ribbons, 'source', rank(targets))
  placeEnds(targets, ribbons, 'target', rank(sources))
  ribbons.sort((a, b) => byText(a.id, b.id))
  const height = Math.max(available ?? 0, ...[...sources, ...targets].map(n => n.y + Math.max(n.height, MIN_PITCH)))
  return { sources, targets, ribbons, height: round(height), ...geometry }
}
