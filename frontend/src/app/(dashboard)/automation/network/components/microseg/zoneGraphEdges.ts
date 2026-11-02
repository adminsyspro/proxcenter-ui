/**
 * The shape of every edge of the zone map and the place of its label: lanes keep the edges of a pair side by side,
 * a bow keeps an edge clear of the circles it does not belong to, and each label goes to the first place along its
 * edge where it covers no circle, no box and no other label.
 */

import {
  crossesBox, crossesCircle, edgeGeometry, rectAround, rectHitsCircle, rectsOverlap, type EdgeShape, type EndShape, type Point, type Rect,
} from './edgeGeometry'

/** A circle or a box an edge must not cross (unless it is one of its ends) and a label must not cover. */
export type Obstacle = { id: string; center: Point; shape: EndShape }
/** Where an edge end is: its center, the outline it clips on, and the circle (or box) it belongs to. */
export type EdgeEnds = { center: Point; shape: EndShape; group: string }

export type EdgeSpec = { id: string; source: string; target: string; label: string; small: boolean }
/** `label` is centered on (x, y). */
export type PlacedEdge = { path: string; points: Point[]; label: { x: number; y: number; w: number; h: number } }

const GAP = 4
const LANE_GAP = 26
const CLEARANCE = 8
/** The bows tried for the edges of a pair, as a part of the distance between the two ends: straight first. */
const BOWS = [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6]
const AT = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82, 0.12, 0.88]
const LABEL_MARGIN = 3

/** The size of a label: an upper bound of the text width (the label ellipsizes past it). */
export function labelSize(text: string, small: boolean): { w: number; h: number } {
  return small
    ? { w: Math.min(110, Math.ceil(text.length * 6.4 + 14)), h: 18 }
    : { w: Math.min(150, Math.ceil(text.length * 7.2 + 16)), h: 22 }
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

export function placeEdges(specs: EdgeSpec[], ends: Map<string, EdgeEnds>, obstacles: Obstacle[]): Map<string, PlacedEdge> {
  // Lanes: each direction of a pair on its own side (the offset follows the normal of the edge, which flips with the
  // direction), the edges of one direction spread around the middle line when the other direction is empty.
  const byDirection = new Map<string, EdgeSpec[]>()
  for (const s of specs) byDirection.set(`${s.source}>${s.target}`, [...(byDirection.get(`${s.source}>${s.target}`) ?? []), s])
  const lane = (s: EdgeSpec) => {
    const same = byDirection.get(`${s.source}>${s.target}`)!
    const k = same.indexOf(s)
    const reverse = byDirection.has(`${s.target}>${s.source}`)
    return {
      offset: (reverse ? k + 0.5 : k - (same.length - 1) / 2) * LANE_GAP,
      at: !reverse && same.length === 1 ? 0.5 : 0.42 + 0.16 * (k % 2),
    }
  }

  // One bow per pair of ends, in the frame of the lesser end, so that both directions follow the same curve.
  const pairs = new Map<string, EdgeSpec[]>()
  for (const s of specs) {
    const key = s.source < s.target ? `${s.source}|${s.target}` : `${s.target}|${s.source}`
    pairs.set(key, [...(pairs.get(key) ?? []), s])
  }
  const shapes = new Map<string, EdgeShape>()
  for (const [key, group] of pairs) {
    const [lesser] = key.split('|')
    const a = ends.get(group[0].source)!
    const b = ends.get(group[0].target)!
    const reach = Math.hypot(b.center.x - a.center.x, b.center.y - a.center.y)
    const own = new Set([a.group, b.group])
    const others = obstacles.filter(o => !own.has(o.id))
    let best: { hits: number; shapes: Map<string, EdgeShape> } = { hits: Infinity, shapes: new Map() }
    for (const canonical of BOWS) {
      let hits = 0
      const tried = new Map<string, EdgeShape>()
      for (const s of group) {
        const from = ends.get(s.source)!
        const to = ends.get(s.target)!
        const { offset, at } = lane(s)
        const bow = (s.source === lesser ? canonical : -canonical) * reach
        const shape = edgeGeometry(from.center, to.center, { fromShape: from.shape, toShape: to.shape, gap: GAP, offset, bow, at })
        if (!shape) continue
        tried.set(s.id, shape)
        hits += others.filter(o => crosses(shape.points, o)).length
      }
      if (hits < best.hits) best = { hits, shapes: tried }
      if (hits === 0) break
    }
    for (const [id, shape] of best.shapes) shapes.set(id, shape)
  }

  // Labels: the allowed edges first (they come first in `specs`), each at the first free place along its edge.
  const labels: Rect[] = []
  const result = new Map<string, PlacedEdge>()
  for (const s of specs) {
    const shape = shapes.get(s.id)
    if (!shape) continue
    const { w, h } = labelSize(s.label, s.small)
    const start = lane(s).at
    const candidates = [start, ...AT.filter(t => t !== start)]
    let chosen: { point: Point; rect: Rect; bad: number } | null = null
    for (const t of candidates) {
      const point = shape.pointAt(t)
      const rect = rectAround(point, w, h)
      const bad = labels.filter(l => rectsOverlap(l, rect, LABEL_MARGIN)).length + obstacles.filter(o => covers(rect, o)).length
      if (!chosen || bad < chosen.bad) chosen = { point, rect, bad }
      if (bad === 0) break
    }
    labels.push(chosen!.rect)
    result.set(s.id, { path: shape.path, points: shape.points, label: { x: chosen!.point.x, y: chosen!.point.y, w, h } })
  }
  return result
}
