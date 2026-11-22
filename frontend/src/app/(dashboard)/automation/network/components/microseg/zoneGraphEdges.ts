/**
 * The shape of every edge of the zone map and the place of its label: lanes keep the edges between the same two
 * circles (or boxes) side by side, and the edges between the same two guests too, each still ending on its guest,
 * a bow keeps an edge clear of the circles it does not belong to, and each label goes to the first place along its
 * edge (or, when none is free, just off its side) where it covers no circle, no box and no other label.
 */

import {
  crossesBox, crossesCircle, edgeGeometry, rectAround, rectHitsCircle, rectsOverlap, type EdgeShape, type EndShape, type Point, type Rect,
} from './edgeGeometry'

/** A circle or a box an edge must not cross (unless it is one of its ends) and a label must not cover. */
export type Obstacle = { id: string; center: Point; shape: EndShape }
/** Where an edge end is: its center, the outline it clips on, and the circle (or box) it belongs to. */
export type EdgeEnds = { center: Point; shape: EndShape; group: string }

export type EdgeSpec = { id: string; source: string; target: string; label: string; small: boolean; gauge?: boolean }
/** `label` is centered on (x, y). */
export type PlacedEdge = { path: string; points: Point[]; label: { x: number; y: number; w: number; h: number } }

const GAP = 4
const LANE_GAP = 26
/** What a shifted edge keeps between its line and the side of a guest glyph (or of a box) it ends on. */
const END_MARGIN = 2
const CLEARANCE = 8
/** The bows tried for the edges of a pair, as a part of the distance between the two ends: straight first. */
const BOWS = [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6]
const AT = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82, 0.12, 0.88]
const LABEL_MARGIN = 3

/** The two label sizes: a guest-to-guest edge has the smaller one. */
export type LabelSize = 'small' | 'regular'

const LABEL_BOXES: Record<LabelSize, { perChar: number; pad: number; maxW: number; h: number }> = {
  small: { perChar: 6.4, pad: 14, maxW: 110, h: 18 },
  regular: { perChar: 7.2, pad: 16, maxW: 150, h: 22 },
}

/** The room the volume gauge of an edge takes at the head of its label (bars and bytes, "844 GiB", "≈ 39 KiB"). */
export const GAUGE_W = 80

/** The size of a label: an upper bound of the text width (the label ellipsizes past it), the gauge's room ahead of it. */
export function labelSize(text: string, size: LabelSize, gauge = false): { w: number; h: number } {
  const box = LABEL_BOXES[size]
  const extra = gauge ? GAUGE_W : 0
  return { w: Math.min(box.maxW, Math.ceil(text.length * box.perChar + box.pad)) + extra, h: box.h }
}

function crosses(points: Point[], o: Obstacle): boolean {
  return o.shape.kind === 'circle'
    ? crossesCircle(points, o.center, o.shape.r, CLEARANCE)
    : crossesBox(points, o.center, o.shape.halfW, o.shape.halfH, CLEARANCE)
}

function covers(rect: Rect, o: Obstacle): boolean {
  if (o.shape.kind === 'circle') return rectHitsCircle(rect, o.center, o.shape.r, 2)
  return rectsOverlap(rect, rectAround(o.center, 2 * o.shape.halfW, 2 * o.shape.halfH), 2)
}

type Lane = { offset: number; at: number }
type BowTry = { hits: number; shapes: Map<string, EdgeShape> }

/** The specs under each key, in their order. */
function groupBy(specs: EdgeSpec[], key: (s: EdgeSpec) => string): Map<string, EdgeSpec[]> {
  const groups = new Map<string, EdgeSpec[]>()
  for (const s of specs) groups.set(key(s), [...(groups.get(key(s)) ?? []), s])
  return groups
}

/**
 * The way of an edge between the circles (or boxes) of its ends: an edge into a circle and one into a guest of that
 * circle run along the same line, so they share their lanes and are drawn side by side, not on top of each other.
 * Inside one circle, the way between the two guests themselves (each direction on its own side).
 */
function directionKey(s: EdgeSpec, ends: Map<string, EdgeEnds>): string {
  const from = ends.get(s.source)?.group ?? s.source
  const to = ends.get(s.target)?.group ?? s.target
  return from === to ? `${s.source}>${s.target}` : `${from}>${to}`
}
/** The two ends of an edge in a fixed order, so that both directions of a pair share the key. */
const endsKey = (s: EdgeSpec) => (s.source < s.target ? `${s.source}|${s.target}` : `${s.target}|${s.source}`)

/** The end is a node of its own (a circle or a box), not a guest or a "+N" drawn inside a circle. */
const isGroupEnd = (id: string, ends: Map<string, EdgeEnds>) => (ends.get(id)?.group ?? id) === id

/**
 * How far an edge may be shifted sideways and still start and end on the outline of its two ends: a little less than
 * the radius of a guest glyph (or half the height of a box), whichever end is the smaller.
 */
function endRoom(s: EdgeSpec, ends: Map<string, EdgeEnds>): number {
  const room = (id: string) => {
    const shape = ends.get(id)?.shape
    if (!shape) return 0
    return Math.max(0, (shape.kind === 'circle' ? shape.r : Math.min(shape.halfW, shape.halfH)) - END_MARGIN)
  }
  return Math.min(room(s.source), room(s.target))
}

/** Spreads the edges of one direction: on its own side when the other direction is drawn too, else around the middle line. */
function spread(same: EdgeSpec[], reverse: boolean, gap: number, lanes: Map<EdgeSpec, Lane>) {
  same.forEach((s, k) => {
    lanes.set(s, {
      offset: (reverse ? k + 0.5 : k - (same.length - 1) / 2) * gap,
      at: !reverse && same.length === 1 ? 0.5 : 0.42 + 0.16 * (k % 2),
    })
  })
}

/**
 * Lanes: each direction between two circles (or boxes) on its own side (the offset follows the normal of the edge,
 * which flips with the direction), the edges of one direction spread around the middle line when the other is empty.
 * An edge with a guest (or a "+N") at an end is spread only with the edges between the same two nodes, and only as
 * far as keeps both of its ends on their outlines: shifted with every edge between the two circles it would float
 * beside the guests it links.
 */
function laneMap(specs: EdgeSpec[], ends: Map<string, EdgeEnds>): Map<EdgeSpec, Lane> {
  const byDirection = groupBy(specs, s => directionKey(s, ends))
  const lanes = new Map<EdgeSpec, Lane>()
  for (const [key, same] of byDirection) {
    const [from, to] = key.split('>')
    spread(same, byDirection.has(`${to}>${from}`), LANE_GAP, lanes)
  }
  const onNodes = specs.filter(s => !isGroupEnd(s.source, ends) || !isGroupEnd(s.target, ends))
  const byEnds = groupBy(onNodes, s => `${s.source}>${s.target}`)
  for (const [key, same] of byEnds) {
    const [from, to] = key.split('>')
    const reverse = byEnds.has(`${to}>${from}`)
    const widest = reverse ? same.length - 0.5 : (same.length - 1) / 2
    const room = Math.min(...same.map(s => endRoom(s, ends)))
    spread(same, reverse, widest > 0 ? Math.min(LANE_GAP, room / widest) : 0, lanes)
  }
  return lanes
}

/** The shapes of the edges of a pair for one bow, and how many foreign circles or boxes they cross. */
function tryBow(group: EdgeSpec[], lesser: string, bow: { canonical: number; reach: number }, ends: Map<string, EdgeEnds>, lanes: Map<EdgeSpec, Lane>, others: Obstacle[]): BowTry {
  let hits = 0
  const shapes = new Map<string, EdgeShape>()
  for (const s of group) {
    const from = ends.get(s.source)!
    const to = ends.get(s.target)!
    const { offset, at } = lanes.get(s)!
    const shape = edgeGeometry(from.center, to.center, { fromShape: from.shape, toShape: to.shape, gap: GAP, offset, bow: (s.source === lesser ? bow.canonical : -bow.canonical) * bow.reach, at })
    if (!shape) continue
    shapes.set(s.id, shape)
    hits += others.filter(o => crosses(shape.points, o)).length
  }
  return { hits, shapes }
}

/** One bow per pair of ends, in the frame of the lesser end, so that both directions follow the same curve. */
function pairShapes(key: string, group: EdgeSpec[], ends: Map<string, EdgeEnds>, obstacles: Obstacle[], lanes: Map<EdgeSpec, Lane>): Map<string, EdgeShape> {
  const [lesser] = key.split('|')
  const a = ends.get(group[0].source)!
  const b = ends.get(group[0].target)!
  const reach = Math.hypot(b.center.x - a.center.x, b.center.y - a.center.y)
  const own = new Set([a.group, b.group])
  const others = obstacles.filter(o => !own.has(o.id))
  let best: BowTry = { hits: Infinity, shapes: new Map() }
  for (const canonical of BOWS) {
    const tried = tryBow(group, lesser, { canonical, reach }, ends, lanes, others)
    if (tried.hits < best.hits) best = tried
    if (tried.hits === 0) break
  }
  return best.shapes
}

/** The steps, in label heights, a label is moved off the side of its edge when no place on the edge is free. */
const SIDE_STEPS = [-1, 1, -2, 2]

/** The point at `t` moved `by` pixels off the side of the edge (along its normal). */
function sideOf(shape: EdgeShape, t: number, by: number): Point {
  const point = shape.pointAt(t)
  if (by === 0) return point
  const a = shape.pointAt(Math.max(0, t - 0.01))
  const b = shape.pointAt(Math.min(1, t + 0.01))
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
  return { x: point.x - ((b.y - a.y) / len) * by, y: point.y + ((b.x - a.x) / len) * by }
}

/**
 * The first place along the edge, from `start`, where a label covers nothing; when none is free (edges side by side
 * between two close circles), the same places a label height or two off the side of the edge; else the one that
 * covers least.
 */
export function placeLabel(shape: EdgeShape, w: number, h: number, start: number, labels: Rect[], obstacles: Obstacle[]): { point: Point; rect: Rect } {
  const along = [start, ...AT.filter(t => t !== start)]
  const candidates = [0, ...SIDE_STEPS].flatMap(step => along.map(t => ({ t, by: step * (h + LABEL_MARGIN) })))
  let chosen: { point: Point; rect: Rect; bad: number } | null = null
  for (const { t, by } of candidates) {
    const point = sideOf(shape, t, by)
    const rect = rectAround(point, w, h)
    const bad = labels.filter(l => rectsOverlap(l, rect, LABEL_MARGIN)).length + obstacles.filter(o => covers(rect, o)).length
    if (!chosen || bad < chosen.bad) chosen = { point, rect, bad }
    if (bad === 0) break
  }
  return chosen!
}

export function placeEdges(specs: EdgeSpec[], ends: Map<string, EdgeEnds>, obstacles: Obstacle[]): Map<string, PlacedEdge> {
  const lanes = laneMap(specs, ends)
  const shapes = new Map<string, EdgeShape>()
  for (const [key, group] of groupBy(specs, endsKey)) {
    for (const [id, shape] of pairShapes(key, group, ends, obstacles, lanes)) shapes.set(id, shape)
  }

  // Labels: the allowed edges first (they come first in `specs`), each at the first free place along its edge.
  const labels: Rect[] = []
  const result = new Map<string, PlacedEdge>()
  for (const s of specs) {
    const shape = shapes.get(s.id)
    if (!shape) continue
    const { w, h } = labelSize(s.label, s.small ? 'small' : 'regular', s.gauge)
    const { point, rect } = placeLabel(shape, w, h, lanes.get(s)!.at, labels, obstacles)
    labels.push(rect)
    result.set(s.id, { path: shape.path, points: shape.points, label: { x: point.x, y: point.y, w, h } })
  }
  return result
}
