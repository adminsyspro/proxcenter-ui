export type Point = { x: number; y: number }

export type GeometryOptions = {
  halfW: number
  halfH: number
  /** Room kept between an edge end and the box it leaves or reaches. */
  gap: number
  /** Shift of the whole edge along its own normal (the left-hand normal of from -> to). */
  offset: number
  /** How far the middle of the edge bows away from the straight line, along the same normal (0: straight). */
  bow?: number
  /** Where the label sits along the visible edge, 0 (start) to 1 (end). */
  at?: number
}

export type EdgeShape = {
  start: Point
  end: Point
  /** Where the label goes. */
  mid: Point
  path: string
  /** The visible edge as a polyline, to check it against other boxes. */
  points: Point[]
}

const SAMPLES = 48
const round = (v: number) => Math.round(v * 100) / 100 + 0


/** A point of a quadratic bezier. */
function quad(p0: Point, c: Point, p2: Point, t: number): Point {
  const u = 1 - t
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y }
}

/**
 * An edge between two node centers: a straight line, or a quadratic curve when
 * `bow` is set, clipped on the side of the two boxes, then shifted along its
 * own normal by `offset` (so the edges of a pair run side by side, each
 * direction on its own side). Null when there is no room for an edge between
 * the boxes.
 */
export function edgeGeometry(from: Point, to: Point, { halfW, halfH, gap, offset, bow = 0, at = 0.5 }: GeometryOptions): EdgeShape | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return null
  const nx = -dy / len
  const ny = dx / len

  const p0 = { x: from.x + nx * offset, y: from.y + ny * offset }
  const p2 = { x: to.x + nx * offset, y: to.y + ny * offset }
  const control = { x: (p0.x + p2.x) / 2 + nx * 2 * bow, y: (p0.y + p2.y) / 2 + ny * 2 * bow }
  const at_ = (t: number) => quad(p0, control, p2, t)
  const inside = (p: Point, c: Point) => Math.abs(p.x - c.x) < halfW + gap && Math.abs(p.y - c.y) < halfH + gap

  // The curve leaves the first box and reaches the second one: find both crossings, then refine them.
  const steps = 256
  let leave = 0
  while (leave < steps && inside(at_(leave / steps), from)) leave++
  let reach = steps
  while (reach > 0 && inside(at_(reach / steps), to)) reach--
  if (leave >= steps || reach <= 0 || leave >= reach) return null
  const refine = (outside: number, inner: number, isInside: (p: Point) => boolean) => {
    let lo = inner / steps
    let hi = outside / steps
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2
      if (isInside(at_(mid))) lo = mid
      else hi = mid
    }
    return hi
  }
  const t0 = leave === 0 ? 0 : refine(leave, leave - 1, p => inside(p, from))
  const t1 = reach === steps ? 1 : refine(reach, reach + 1, p => inside(p, to))
  if (t1 <= t0) return null

  const start = at_(t0)
  const end = at_(t1)
  // The sub-curve [t0, t1] of a quadratic bezier is a quadratic bezier whose control point follows the tangent at t0.
  const tangent = { x: (1 - t0) * (control.x - p0.x) + t0 * (p2.x - control.x), y: (1 - t0) * (control.y - p0.y) + t0 * (p2.y - control.y) }
  const subControl = { x: start.x + (t1 - t0) * tangent.x, y: start.y + (t1 - t0) * tangent.y }
  if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return null

  const r = (p: Point): Point => ({ x: round(p.x), y: round(p.y) })
  const s = r(start)
  const e = r(end)
  const c = r(subControl)
  const points = Array.from({ length: SAMPLES + 1 }, (_, i) => r(quad(start, subControl, end, i / SAMPLES)))
  return { start: s, end: e, mid: r(quad(start, subControl, end, at)), path: `M ${s.x} ${s.y} Q ${c.x} ${c.y} ${e.x} ${e.y}`, points }
}

/** True when the polyline enters the box centered on `center` (grown by `margin`). */
export function crossesBox(points: Point[], center: Point, halfW: number, halfH: number, margin: number): boolean {
  return points.some(p => Math.abs(p.x - center.x) < halfW + margin && Math.abs(p.y - center.y) < halfH + margin)
}

