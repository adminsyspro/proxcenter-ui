import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { flowService } from './FlowSummary'
import {
  EDGE_COLORS, EXTERNAL_ID, OUTSIDE_ID, groupServices, zoneColumns, zoneNodeId, type FlowFilters, type MapEdgeKind, type MapInput, type PanelEdgeData,
} from './zoneGraph'
import { byText } from './zoneLayout'

export type MatrixSort = 'name' | 'layer'

/** A row (source) or a column (destination) of the matrix. `layer` and `order` are its column and row on the map. */
export type MatrixEnd = { id: string; kind: 'zone' | 'external' | 'outside'; zone: MicrosegZone | null; layer: number; order: number }

/** The flows of one ordered pair. */
export type MatrixCell = { id: string; source: string; target: string; flows: MicrosegFlow[]; observed: MicrosegSuggestion[] }

export type MatrixModel = { rows: MatrixEnd[]; cols: MatrixEnd[]; cells: Map<string, MatrixCell> }

export type CellTone = 'unprotected' | 'blocked' | 'allowed'

/** An observed service of a pair (no flow allows it): its kind and the hits of its observed flows. */
export type ObservedChip = { service: string; kind: 'unprotected' | 'blocked'; hits: number }

/** What a cell shows once the three checkboxes are applied. */
export type CellView = {
  id: string
  source: string
  target: string
  /** The allowed services (protocol/ports), sorted. */
  services: string[]
  flows: MicrosegFlow[]
  observed: MicrosegSuggestion[]
  /** The observed services, unprotected first, then by service. */
  observedChips: ObservedChip[]
  unprotected: number
  blocked: number
  /** The hits of the observed flows shown. */
  hits: number
  tone: CellTone
  /** Every allowed flow of the cell is in the draft only. */
  draft: boolean
}

export const cellId = (source: string, target: string) => `cell:${source}>${target}`

function cellOf(cells: Map<string, MatrixCell>, source: string, target: string): MatrixCell {
  const id = cellId(source, target)
  const cell = cells.get(id) ?? { id, source, target, flows: [], observed: [] }
  cells.set(id, cell)
  return cell
}

/** The source of an allowed flow: External for a CIDR, the zone, nothing for a zone that is gone. */
function flowSource(f: MicrosegFlow, known: ReadonlyMap<string, MicrosegZone>): string | null {
  if (f.src_cidr) return EXTERNAL_ID
  return known.has(f.src_zone_id) ? zoneNodeId(f.src_zone_id) : null
}

function flowTarget(f: MicrosegFlow, known: ReadonlyMap<string, MicrosegZone>): string | null {
  if (f.dst_cidr) return OUTSIDE_ID
  return known.has(f.dst_zone_id) ? zoneNodeId(f.dst_zone_id) : null
}

/**
 * The matrix of the draft: a row per zone and one for Unknown / External (the CIDR sources, the observed sources in
 * no zone), a column per zone and one for Outside (the CIDR destinations). A cell holds the allowed flows and the
 * pending observed flows of its pair, in id order. A flow from a CIDR to a CIDR has no cell. Pure.
 */
export function buildMatrix({ zones, flows, suggestions }: Pick<MapInput, 'zones' | 'flows' | 'suggestions'>): MatrixModel {
  const { sorted, known, columns } = zoneColumns(zones, flows)
  const cells = new Map<string, MatrixCell>()
  for (const f of flows) {
    const source = flowSource(f, known)
    const target = flowTarget(f, known)
    if (source && target && !(source === EXTERNAL_ID && target === OUTSIDE_ID)) cellOf(cells, source, target).flows.push(f)
  }
  for (const s of suggestions) {
    if (s.status !== 'pending' || !known.has(s.dst_zone_id)) continue
    const source = known.has(s.src_zone_id) ? zoneNodeId(s.src_zone_id) : EXTERNAL_ID
    cellOf(cells, source, zoneNodeId(s.dst_zone_id)).observed.push(s)
  }
  for (const cell of cells.values()) {
    cell.flows.sort((a, b) => byText(a.id, b.id))
    cell.observed.sort((a, b) => byText(a.id, b.id))
  }

  // The place of each zone on the map: its layer, then its row in the layer.
  const place = new Map(columns.flatMap((column, layer) => column.map((id, order) => [id, { layer, order }] as const)))
  const zoneEnds: MatrixEnd[] = sorted.map(z => ({ id: zoneNodeId(z.id), kind: 'zone', zone: z, ...place.get(z.id)! }))

  return {
    rows: [...zoneEnds, { id: EXTERNAL_ID, kind: 'external', zone: null, layer: 0, order: 0 }],
    cols: [...zoneEnds, { id: OUTSIDE_ID, kind: 'outside', zone: null, layer: columns.length, order: 0 }],
    cells,
  }
}

const KIND_ORDER: Record<MatrixEnd['kind'], number> = { external: 0, zone: 1, outside: 2 }
const zoneName = (e: MatrixEnd) => e.zone?.name ?? ''

/**
 * The rows or the columns in the order asked: by name (External and Outside last), or by layer as the map reads
 * left to right (External first, Outside last), then by row in the layer. Ties by name, then id.
 */
export function sortEnds(ends: MatrixEnd[], sort: MatrixSort): MatrixEnd[] {
  const byName = (a: MatrixEnd, b: MatrixEnd) => byText(zoneName(a), zoneName(b)) || byText(a.id, b.id)
  if (sort === 'name') return [...ends].sort((a, b) => Number(a.kind !== 'zone') - Number(b.kind !== 'zone') || byName(a, b))
  return [...ends].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.layer - b.layer || a.order - b.order || byName(a, b))
}

function observedChips(observed: MicrosegSuggestion[]): ObservedChip[] {
  const chips = new Map<string, ObservedChip>()
  for (const s of observed) {
    const kind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
    const service = flowService(s)
    const key = `${kind}:${service}`
    const chip = chips.get(key) ?? { service, kind, hits: 0 }
    chip.hits += s.hits
    chips.set(key, chip)
  }
  const rank = (c: ObservedChip) => (c.kind === 'unprotected' ? 0 : 1)
  return [...chips.values()].sort((a, b) => rank(a) - rank(b) || byText(a.service, b.service))
}

function toneOf(flows: number, unprotected: number, blocked: number): CellTone | null {
  if (unprotected) return 'unprotected'
  if (blocked) return 'blocked'
  return flows ? 'allowed' : null
}

/**
 * A cell once the three checkboxes are applied: the allowed services, the observed flows kept and their hits, the
 * tone (red when unprotected traffic was seen, else blue when blocked, else green). Null when nothing is left.
 */
export function cellView(cell: MatrixCell | undefined, filters: FlowFilters, unapplied: ReadonlySet<string> | null): CellView | null {
  if (!cell) return null
  const flows = filters.allowed ? cell.flows : []
  const observed = cell.observed.filter(s => (s.kind === 'blocked' ? filters.blocked : filters.unprotected))
  const blocked = observed.filter(s => s.kind === 'blocked').length
  const unprotected = observed.length - blocked
  const tone = toneOf(flows.length, unprotected, blocked)
  if (!tone) return null
  return {
    id: cell.id,
    source: cell.source,
    target: cell.target,
    services: [...new Set(flows.map(f => flowService(f)))].sort(byText),
    flows,
    observed,
    observedChips: observedChips(observed),
    unprotected,
    blocked,
    hits: observed.reduce((sum, s) => sum + s.hits, 0),
    tone,
    draft: !!unapplied && flows.length > 0 && flows.every(f => unapplied.has(f.id)),
  }
}

/** What the flow panel shows of a cell: the kind and colour of its tone, every service of the pair, its flows. */
export function cellEdgeData(view: CellView, target: string): PanelEdgeData {
  const kind: MapEdgeKind = view.tone === 'allowed' && target === OUTSIDE_ID ? 'outside' : view.tone
  return {
    kind,
    color: EDGE_COLORS[kind],
    label: groupServices([...view.services, ...view.observed.map(s => flowService(s))]),
    flows: view.flows,
    observed: view.observed,
  }
}

/** The pair a selected cell stands for, as the flow panel reads it; null when the cell is gone or shows nothing. */
export function matrixEdge(model: MatrixModel, id: string, filters: FlowFilters, unapplied: ReadonlySet<string> | null): { id: string; source: string; target: string; data: PanelEdgeData } | null {
  const view = cellView(model.cells.get(id), filters, unapplied)
  return view ? { id, source: view.source, target: view.target, data: cellEdgeData(view, view.target) } : null
}
