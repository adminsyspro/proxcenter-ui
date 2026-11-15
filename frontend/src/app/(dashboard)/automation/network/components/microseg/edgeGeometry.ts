export type Point = { x: number; y: number }

/** The outline an edge end clips itself on: a zone circle, a guest glyph, or a box (External, Outside). */
export type EndShape = { kind: 'circle'; r: number } | { kind: 'box'; halfW: number; halfH: number }

export type GeometryOptions = {
  fromShape: EndShape
  toShape: EndShape
  /** Room kept between an edge end and the outline it leaves or reaches. */
  gap: number
  /** Shift of the whole edge along its own normal (the left-hand normal of from -> to). */
  offset: number
  /** How far the middle of the edge bows away from the straight line, along the same normal (0: straight). */
  bow?: number
  /** A point along the visible edge, 0 (start) to 1 (end), given back as `mid`. */
  at?: number
}

export type EdgeShape = {
  start: Point
  end: Point
  /** The point at `at`. */
  mid: Point
  path: string
  /** The visible edge as a polyline, to check it against other nodes and to place its label. */
  points: Point[]
  /** A point of the visible edge for any t in 0..1. */
  pointAt: (t: number) => Point
}

const SAMPLES = 48
const round = (v: number) => Math.round(v * 100) / 100 + 0
const r2 = (p: Point): Point => ({ x: round(p.x), y: round(p.y) })

function quad(p0: Point, c: Point, p2: Point, t: number): Point {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y }
}

/** True when `p` is inside the shape centered on `c`, grown by `margin`. */
export function insideShape(p: Point, c: Point, shape: EndShape, margin: number): boolean {
  if (shape.kind === 'circle') return Math.hypot(p.x - c.x, p.y - c.y) < shape.r + margin
  return Math.abs(p.x - c.x) < shape.halfW + margin && Math.abs(p.y - c.y) < shape.halfH + margin
}

/**
 * An edge between two centers: a straight line, or a quadratic curve when `bow` is set, shifted along its own
 * normal by `offset` (the edges of a pair run side by side, each direction on its own side), then clipped where it
 * leaves the first outline and reaches the second one. Null when there is no room for an edge between them.
 */
export function edgeGeometry(from: Point, to: Point, { fromShape, toShape, gap, offset, bow = 0, at = 0.5 }: GeometryOptions): EdgeShape | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const nx = -dy / len
  const ny = dx / len

  const p0 = { x: from.x + nx * offset, y: from.y + ny * offset }
  const p2 = { x: to.x + nx * offset, y: to.y + ny * offset }
  const control = { x: (p0.x + p2.x) / 2 + nx * 2 * bow, y: (p0.y + p2.y) / 2 + ny * 2 * bow }
  const curve = (t: number) => quad(p0, control, p2, t)
  const inFrom = (p: Point) => insideShape(p, from, fromShape, gap)
  const inTo = (p: Point) => insideShape(p, to, toShape, gap)

  const steps = 256
  let leave = 0
  while (leave < steps && inFrom(curve(leave / steps))) leave++
  let reach = steps
  while (reach > 0 && inTo(curve(reach / steps))) reach--
  if (leave >= steps || reach <= 0 || leave >= reach) return null
  const refine = (outside: number, inner: number, isInside: (p: Point) => boolean) => {
    let lo = inner / steps
    let hi = outside / steps
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2
      if (isInside(curve(m))) lo = m
      else hi = m
    }
    return hi
  }
  const t0 = leave === 0 ? 0 : refine(leave, leave - 1, inFrom)
  const t1 = reach === steps ? 1 : refine(reach, reach + 1, inTo)
  if (t1 <= t0) return null

  const start = curve(t0)
  const end = curve(t1)
  if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return null
  // The sub-curve [t0, t1] of a quadratic bezier is a quadratic bezier whose control point follows the tangent at t0.
  const tangent = { x: (1 - t0) * (control.x - p0.x) + t0 * (p2.x - control.x), y: (1 - t0) * (control.y - p0.y) + t0 * (p2.y - control.y) }
  const sub = { x: start.x + (t1 - t0) * tangent.x, y: start.y + (t1 - t0) * tangent.y }

  const s = r2(start)
  const e = r2(end)
  const c = r2(sub)
  const pointAt = (t: number) => r2(quad(start, sub, end, t))
  const points = Array.from({ length: SAMPLES + 1 }, (_, i) => pointAt(i / SAMPLES))
  return { start: s, end: e, mid: pointAt(at), path: `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${e.x} ${e.y}`, points, pointAt }
}

/** True when the polyline enters the box centered on `center` (grown by `margin`). */
export function crossesBox(points: Point[], center: Point, halfW: number, halfH: number, margin: number): boolean {
  return points.some(p => Math.abs(p.x - center.x) < halfW + margin && Math.abs(p.y - center.y) < halfH + margin)
}

/** True when the polyline enters the circle (grown by `margin`). */
export function crossesCircle(points: Point[], center: Point, r: number, margin: number): boolean {
  return points.some(p => Math.hypot(p.x - center.x, p.y - center.y) < r + margin)
}

export type Rect = { x: number; y: number; w: number; h: number }

/** A rectangle centered on `c`. */
export const rectAround = (c: Point, w: number, h: number): Rect => ({ x: c.x - w / 2, y: c.y - h / 2, w, h })

export function rectsOverlap(a: Rect, b: Rect, margin = 0): boolean {
  return a.x < b.x + b.w + margin && b.x < a.x + a.w + margin && a.y < b.y + b.h + margin && b.y < a.y + a.h + margin
}

export function rectHitsCircle(r: Rect, center: Point, radius: number, margin = 0): boolean {
  const nx = Math.max(r.x, Math.min(center.x, r.x + r.w))
  const ny = Math.max(r.y, Math.min(center.y, r.y + r.h))
  return Math.hypot(nx - center.x, ny - center.y) < radius + margin
}
