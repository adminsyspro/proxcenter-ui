/**
 * Pure helpers of the zone map layout: the size of a zone circle and the places of its guests inside it, and the
 * columns (longest-path layers) and rows (barycenter order) of the zones on the grid.
 */

export type Point = { x: number; y: number }

/** A zone circle never gets smaller or larger than this. */
export const MIN_R = 110
export const MAX_R = 220
/** Guests drawn in a circle: beyond it the first ones are drawn and a "+N" node stands for the rest. */
export const MAX_SHOWN = 12
/** The cell of a guest: its round glyph on top, its name under it. */
export const CELL_W = 72
export const CELL_H = 54
export const GUEST_W = 68
export const GUEST_H = 50
/** The round glyph of a guest, centered at GLYPH_Y from the top of its node: the edges start and end on it. */
export const GUEST_R = 14
export const GLYPH_Y = 15
/** The grid of the guests sits that much below the center of the circle: the name of the zone is above it. */
const GRID_DROP = 12
const RIM = 12

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** How many guests are drawn and how many the "+N" node stands for. */
export function memberSlots(count: number): { shown: number; more: number } {
  if (count <= MAX_SHOWN) return { shown: count, more: 0 }
  return { shown: MAX_SHOWN - 1, more: count - (MAX_SHOWN - 1) }
}

/** Columns and rows of the grid of `slots` cells (guests plus the "+N" node). */
export function gridShape(slots: number): { cols: number; rows: number } {
  if (slots <= 0) return { cols: 0, rows: 0 }
  const cols = Math.ceil(Math.sqrt(slots))
  return { cols, rows: Math.ceil(slots / cols) }
}

/** The radius of a circle holding `slots` cells: every cell inside, the zone name above them, within MIN_R..MAX_R. */
export function circleRadius(slots: number): number {
  const { cols, rows } = gridShape(slots)
  if (cols === 0) return MIN_R
  const corner = Math.hypot((cols * CELL_W) / 2, (rows * CELL_H) / 2 + GRID_DROP)
  return Math.min(MAX_R, Math.max(MIN_R, Math.ceil(corner + RIM)))
}

/**
 * The top-left corner of each guest node, relative to the top-left corner of the circle of radius `r`: row by row,
 * the last row centered.
 */
export function slotPositions(slots: number, r: number): Point[] {
  const { cols, rows } = gridShape(slots)
  const top = r + GRID_DROP - (rows * CELL_H) / 2
  const out: Point[] = []
  for (let i = 0; i < slots; i++) {
    const row = Math.floor(i / cols)
    const inRow = row === rows - 1 ? slots - row * cols : cols
    const left = r - (inRow * CELL_W) / 2
    out.push({ x: Math.round(left + (i % cols) * CELL_W + (CELL_W - GUEST_W) / 2), y: Math.round(top + row * CELL_H + (CELL_H - GUEST_H) / 2) })
  }
  return out
}

/**
 * The column of every zone: 1 + the column of its furthest source (a longest-path layering), 1 for a zone no zone
 * sends to. Cycles are broken first: a depth-first walk (zones and their targets in name order) drops the edges that
 * go back to a zone still on the walk. A zone in `first` (one External sends to) is a front door: the flows of
 * other zones into it are put aside during the walk, then kept only when they close no cycle, so that a reply
 * (app -> web) is the edge dropped, not the request (web -> app). Column 0 is left to External, the last one + 1
 * to Outside.
 */
export function layerZones(ids: string[], edges: Array<[string, string]>, first: string[] = []): Map<string, number> {
  const known = new Set(ids)
  const doors = new Set(first.filter(id => known.has(id)))
  const targets = new Map<string, string[]>(ids.map(id => [id, []]))
  const later: Array<[string, string]> = []
  for (const [a, b] of edges) {
    if (a === b || !known.has(a) || !known.has(b)) continue
    if (doors.has(b)) {
      if (!later.some(([x, y]) => x === a && y === b)) later.push([a, b])
      continue
    }
    const list = targets.get(a)!
    if (!list.includes(b)) list.push(b)
  }
  for (const list of targets.values()) list.sort(byText)

  const sources = new Map<string, string[]>(ids.map(id => [id, []]))
  const state = new Map<string, 1 | 2>()
  const walk = (id: string) => {
    state.set(id, 1)
    for (const next of targets.get(id)!) {
      if (state.get(next) === 1) continue
      sources.get(next)!.push(id)
      if (!state.has(next)) walk(next)
    }
    state.set(id, 2)
  }
  for (const id of [...ids].sort(byText)) if (!state.has(id)) walk(id)

  const reaches = (from: string, to: string) => {
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length) {
      const id = stack.pop()!
      if (id === to) return true
      if (seen.has(id)) continue
      seen.add(id)
      for (const [next, list] of sources) if (list.includes(id)) stack.push(next)
    }
    return false
  }
  for (const [a, b] of later.sort((x, y) => byText(x[0], y[0]) || byText(x[1], y[1]))) {
    if (!reaches(b, a)) sources.get(b)!.push(a)
  }

  const layer = new Map<string, number>()
  const depth = (id: string): number => {
    const known_ = layer.get(id)
    if (known_ !== undefined) return known_
    const from = sources.get(id)!
    const value = from.length === 0 ? 1 : 1 + Math.max(...from.map(depth))
    layer.set(id, value)
    return value
  }
  for (const id of ids) depth(id)
  return layer
}

/**
 * The zones of each column, top to bottom: name order first, then sweeps that sort each column by the mean row of
 * its neighbours in the columns already placed (down, up, down), ties by name. Deterministic.
 */
export function orderLayers(layer: Map<string, number>, edges: Array<[string, string]>, nameOf: (id: string) => string): string[][] {
  const count = Math.max(0, ...layer.values())
  const columns: string[][] = Array.from({ length: count + 1 }, () => [])
  for (const id of layer.keys()) columns[layer.get(id)!].push(id)
  const byName = (a: string, b: string) => byText(nameOf(a), nameOf(b)) || byText(a, b)
  for (const column of columns) column.sort(byName)

  const neighbours = new Map<string, Set<string>>([...layer.keys()].map(id => [id, new Set<string>()]))
  for (const [a, b] of edges) {
    if (a === b || !layer.has(a) || !layer.has(b)) continue
    neighbours.get(a)!.add(b)
    neighbours.get(b)!.add(a)
  }
  const row = new Map<string, number>()
  const place = (column: string[]) => column.forEach((id, i) => row.set(id, i - (column.length - 1) / 2))
  columns.forEach(place)

  const sweep = (l: number, side: (other: number) => boolean) => {
    const column = columns[l]
    const key = new Map(column.map(id => {
      const near = [...neighbours.get(id)!].filter(n => side(layer.get(n)!))
      return [id, near.length ? near.reduce((s, n) => s + row.get(n)!, 0) / near.length : row.get(id)!]
    }))
    column.sort((a, b) => key.get(a)! - key.get(b)! || byName(a, b))
    place(column)
  }
  for (let l = 2; l <= count; l++) sweep(l, other => other < l)
  for (let l = count - 1; l >= 1; l--) sweep(l, other => other > l)
  for (let l = 2; l <= count; l++) sweep(l, other => other < l)
  return columns
}
