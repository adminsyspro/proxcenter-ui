/**
 * Pure helpers of the zone map layout: the size of a zone circle and the places of its guests inside it, and the
 * columns (longest-path layers) and rows (barycenter order) of the zones on the grid.
 */

import type { Point } from './edgeGeometry'

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

/** Plain code-unit order of two strings, the same on every machine (no locale). */
export function byText(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}

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

/** Inside a zone: its guests are wider (their name is read in full) and up to this many are drawn before the "+N" node. */
export const INSIDE_GUEST_W = 120
export const INSIDE_MAX_SHOWN = 60
/** The rings the guests of an entered zone stand on: the radius of the first, the room between two, the arc a guest takes. */
const RING_FIRST = 130
const RING_STEP = 110
const RING_ARC = 136
/** Room between the last ring and the border of the circle (the name of the zone is above the top guest). */
const RING_RIM = 85
/** The circle of an entered zone with no guest, or with one in its centre. */
export const INSIDE_MIN_R = 150

/** How many guests are drawn inside an entered zone and how many its "+N" node stands for. */
export function insideSlots(count: number): { shown: number; more: number } {
  if (count <= INSIDE_MAX_SHOWN) return { shown: count, more: 0 }
  return { shown: INSIDE_MAX_SHOWN - 1, more: count - (INSIDE_MAX_SHOWN - 1) }
}

/**
 * The guests of an entered zone, spread on concentric rings so that the flows between them are chords that can be
 * read: as few rings as hold them, each ring filled in proportion of its length. Returns the radius of the circle and
 * the center of each glyph relative to the center of the circle (a single guest sits in the middle).
 */
export function ringLayout(slots: number): { radius: number; centers: Point[] } {
  if (slots <= 0) return { radius: INSIDE_MIN_R, centers: [] }
  if (slots === 1) return { radius: INSIDE_MIN_R, centers: [{ x: 0, y: 0 }] }
  const radii: number[] = []
  const room: number[] = []
  for (let total = 0; total < slots;) {
    const r = RING_FIRST + radii.length * RING_STEP
    const holds = Math.max(2, Math.floor((2 * Math.PI * r) / RING_ARC))
    radii.push(r)
    room.push(holds)
    total += holds
  }
  const total = room.reduce((sum, n) => sum + n, 0)
  const counts = room.map(n => Math.floor((slots * n) / total))
  // What the rounding left goes to the ring with the most room, the outer one on a tie.
  for (let left = slots - counts.reduce((sum, n) => sum + n, 0); left > 0; left--) {
    let best = 0
    for (let k = 1; k < room.length; k++) if (room[k] - counts[k] >= room[best] - counts[best]) best = k
    counts[best]++
  }
  const centers: Point[] = []
  counts.forEach((n, k) => {
    // Every other ring is turned by half a step: two guests of neighbouring rings do not line up.
    const turn = k % 2 ? Math.PI / n : 0
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + turn + (2 * Math.PI * i) / n
      centers.push({ x: Math.round(radii[k] * Math.cos(angle)), y: Math.round(radii[k] * Math.sin(angle)) })
    }
  })
  return { radius: radii[radii.length - 1] + RING_RIM, centers }
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

/** A cell of the grid of the map: what a column stacks. */
type Box = { w: number; h: number }

/**
 * The view a map is judged in to decide whether its columns are folded: wider than tall, as the map area of the page
 * is. The real view only changes how much the result is zoomed, not which grid is the most readable.
 */
export const FOLD_VIEW = { w: 1600, h: 720 }
/** A map shown at this zoom or more is left as it is: its columns are its layers, and it reads well. */
export const FOLD_BELOW = 0.5

/** The size of a grid: its columns side by side (`colGap` apart), each as tall as its cells and their gaps. */
export function gridExtent(grid: Box[][], colGap: number, rowGap: number): { width: number; height: number } {
  const widths = grid.map(column => Math.max(...column.map(c => c.w)))
  const heights = grid.map(column => column.reduce((sum, c) => sum + c.h, 0) + rowGap * (column.length - 1))
  return { width: widths.reduce((sum, w) => sum + w, 0) + colGap * (grid.length - 1), height: Math.max(...heights) }
}

/** The zoom at which a grid fits FOLD_VIEW, never above 1 (the map is not enlarged past its natural size). */
function fitZoom(grid: Box[][], colGap: number, rowGap: number): number {
  const { width, height } = gridExtent(grid, colGap, rowGap)
  return Math.min(1, FOLD_VIEW.w / width, FOLD_VIEW.h / height)
}

/** A column cut into columns of `rows` cells at most, as even as they can be, its order kept top to bottom then left to right. */
function splitColumn<T>(column: T[], rows: number): T[][] {
  const parts = Math.ceil(column.length / rows)
  const per = Math.ceil(column.length / parts)
  return Array.from({ length: parts }, (_, i) => column.slice(i * per, (i + 1) * per))
}

/**
 * Folds the columns of a map too tall to be read: with many zones and few flows between them, most zones share one
 * column (the columns are the layers of the declared flows), the map is one long strip and fitting it in the view
 * shrinks it until no name can be read. Below FOLD_BELOW, every column is cut into columns of at most `rows` cells,
 * for the `rows` that fits the view at the largest zoom (the tallest of them on a tie, the closest to the layers).
 * The columns of one layer stay next to each other, in their order. A map that already reads well is returned as is.
 */
export function foldColumns<T extends Box>(grid: T[][], colGap: number, rowGap: number): T[][] {
  const columns = grid.filter(column => column.length > 0)
  if (columns.length === 0 || fitZoom(columns, colGap, rowGap) >= FOLD_BELOW) return grid
  let best = columns
  let bestZoom = fitZoom(columns, colGap, rowGap)
  for (let rows = Math.max(...columns.map(c => c.length)) - 1; rows >= 1; rows--) {
    const folded = columns.flatMap(column => splitColumn(column, rows))
    const zoom = fitZoom(folded, colGap, rowGap)
    if (zoom > bestZoom) {
      best = folded
      bestZoom = zoom
    }
  }
  return best
}
