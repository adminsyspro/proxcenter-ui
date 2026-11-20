import type { Edge, Node } from '@xyflow/react'

import type { MapNodeData, ZoneGraph } from './zoneGraph'

/** A point of the scene: x to the right, y down, z towards the viewer; the sphere of the stars has radius 1. */
export type Vec3 = { x: number; y: number; z: number }

/** Where the camera stands on the z axis, in radii of the sphere: nearer, the front of the sphere grows more. */
export const CAMERA = 3.4
/** The outer orbit (what is outside the thing in the centre), in radii of the sphere, and its tilt. */
export const OUTER_RADIUS = 1.5
export const OUTER_TILT = 0.2
/** No star is placed nearer to a pole than this latitude (y of the unit sphere): the poles pile up on the centre. */
const MAX_LATITUDE = 0.82
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** A sphere draws this many stars at most: past it the last one stands for the rest ("+N"). */
export const MAX_STARS = 150

/**
 * `count` points spread evenly on the unit sphere (Fibonacci lattice), the poles left empty. Deterministic: the same
 * count gives the same points, so a star keeps its place from one refresh to the next.
 */
export function fibonacciSphere(count: number): Vec3[] {
  const points: Vec3[] = []
  for (let i = 0; i < count; i++) {
    const y = count === 1 ? 0 : (1 - (2 * (i + 0.5)) / count) * MAX_LATITUDE
    const r = Math.sqrt(1 - y * y)
    const theta = i * GOLDEN_ANGLE
    points.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r })
  }
  return points
}

/** `count` points evenly spread on a tilted circle of radius `radius` around the centre (the outer orbit). */
export function orbitRing(count: number, radius = OUTER_RADIUS, tilt = OUTER_TILT, phase = 0): Vec3[] {
  const points: Vec3[] = []
  for (let i = 0; i < count; i++) {
    const a = phase + (2 * Math.PI * i) / Math.max(count, 1)
    const x = Math.cos(a) * radius
    const z = Math.sin(a) * radius
    points.push({ x, y: z * Math.sin(tilt), z: z * Math.cos(tilt) })
  }
  return points
}

/** A point turned around the vertical axis (`yaw`), then around the horizontal one (`pitch`). */
export function rotate(p: Vec3, yaw: number, pitch: number): Vec3 {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const x = p.x * cy + p.z * sy
  const z1 = -p.x * sy + p.z * cy
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  return { x, y: p.y * cp - z1 * sp, z: p.y * sp + z1 * cp }
}

export type Projected = {
  /** Offset from the centre of the scene, in px. */
  x: number
  y: number
  /** The perspective factor: 1 at the depth of the centre, above in front of it, under behind it. */
  scale: number
  /** 0 at the back of the scene, 1 at the front. */
  depth: number
}

/** A rotated point seen by the camera: its place on the screen for a sphere of `radius` px, its size and its depth. */
export function project(p: Vec3, radius: number): Projected {
  const scale = CAMERA / (CAMERA - p.z)
  return { x: p.x * radius * scale, y: p.y * radius * scale, scale, depth: Math.min(1, Math.max(0, (p.z / OUTER_RADIUS + 1) / 2)) }
}

/**
 * The points of an arc from `a` to `b`: a curve bowed away from the centre, a little outside the sphere between two
 * neighbours, across it between two stars far apart (it then passes above the centre, never through it). An end in the
 * centre gives the straight radius to the other end.
 */
export function arcPoints(a: Vec3, b: Vec3, steps: number): Vec3[] {
  const la = Math.hypot(a.x, a.y, a.z)
  const lb = Math.hypot(b.x, b.y, b.z)
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }
  let control = mid
  if (la > 1e-6 && lb > 1e-6) {
    const lm = Math.hypot(mid.x, mid.y, mid.z)
    // Half the angle between the two ends: 1 for neighbours, 0 for two opposite stars.
    const closeness = Math.min(1, lm / ((la + lb) / 2))
    // Two opposite stars have no side to bow to: the arc goes over the top of the centre.
    const dir = lm > 0.05 ? { x: mid.x / lm, y: mid.y / lm, z: mid.z / lm } : { x: 0, y: -1, z: 0 }
    const reach = ((la + lb) / 2) * (0.95 + 0.3 * closeness)
    control = { x: dir.x * reach, y: dir.y * reach, z: dir.z * reach }
  }
  const points: Vec3[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    points.push({
      x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
      z: u * u * a.z + 2 * u * t * control.z + t * t * b.z,
    })
  }
  return points
}

export type StarShell = 'sphere' | 'outer'

/** A pastille of the constellation: a node of the map (a zone, a guest, a boundary...) at its place of the scene. */
export type Star = {
  id: string
  shell: StarShell
  /** Its place before any rotation. */
  at: Vec3
  node: Node
  data: MapNodeData
  /** The nodes the star stands for beyond its own (the guests of a circle that is one pastille, the stars folded in a "+N"). */
  folded?: number
}

export type Link = { id: string; source: string; target: string; edge: Edge }

export type Constellation = {
  /** The node in the centre (an entered zone), null when the centre is the cluster itself. */
  centre: Node | null
  stars: Star[]
  /** The stars past MAX_STARS, folded in the last one of the sphere. */
  more: number
  links: Link[]
}

const dataOf = (n: Node) => n.data as unknown as MapNodeData

/** A boundary of the map (and everything around an entered zone) goes on the outer orbit, the rest on the sphere. */
function isOuter(n: Node, centre: Node | null): boolean {
  const kind = dataOf(n).kind
  if (kind === 'external' || kind === 'outside' || kind === 'ip') return true
  return !!centre && n.parentId !== centre.id
}

/**
 * The scene of a map graph. Without an entered zone, every top-level node is a star: the zones and the guests in no
 * zone on the sphere, Unknown / External and Outside on the outer orbit. Inside a zone (its node carries `entered`),
 * the zone is the centre, its guests are the sphere and everything else (the zones it talks to, the addresses, the
 * boundaries) is on the outer orbit; a guest of another circle is drawn by the pastille of that circle. A sphere holds
 * `max` stars at most: past it the last star is a "+N" that stands for the rest. Pure and deterministic.
 */
export function buildConstellation(graph: ZoneGraph, max = MAX_STARS): Constellation {
  const centre = graph.nodes.find(n => { const d = dataOf(n); return d.kind === 'zone' && !!d.entered }) ?? null
  const candidates = graph.nodes.filter(n => n.id !== centre?.id && dataOf(n).kind !== 'pveCluster' && (!n.parentId || n.parentId === centre?.id))
  const sphere = candidates.filter(n => !isOuter(n, centre))
  const outer = candidates.filter(n => isOuter(n, centre))
  const shown = sphere.length > max ? sphere.slice(0, max - 1) : sphere
  const rest = sphere.slice(shown.length)

  const stars: Star[] = []
  const starOf = new Map<string, string>()
  const spots = fibonacciSphere(shown.length + (rest.length ? 1 : 0))
  shown.forEach((node, i) => {
    stars.push({ id: node.id, shell: 'sphere', at: spots[i], node, data: dataOf(node) })
    starOf.set(node.id, node.id)
  })
  if (rest.length) {
    const id = 'constellation:more'
    const node: Node = { id, position: { x: 0, y: 0 }, data: { kind: 'more', count: rest.length, groupId: '' } }
    stars.push({ id, shell: 'sphere', at: spots[shown.length], node, data: dataOf(node), folded: rest.length })
    for (const n of rest) starOf.set(n.id, id)
  }
  // The outer orbit starts on the left, so that two boundaries face each other like on the other renderings.
  const ring = orbitRing(outer.length, OUTER_RADIUS, OUTER_TILT, Math.PI)
  outer.forEach((node, i) => {
    stars.push({ id: node.id, shell: 'outer', at: ring[i], node, data: dataOf(node) })
    starOf.set(node.id, node.id)
  })
  // A guest of a circle that is one pastille (or the circle of a folded star) is drawn by that pastille.
  const children = new Map<string, number>()
  for (const n of graph.nodes) {
    if (starOf.has(n.id) || !n.parentId) continue
    const parent = starOf.get(n.parentId)
    if (!parent) continue
    starOf.set(n.id, parent)
    children.set(parent, (children.get(parent) ?? 0) + 1)
  }
  for (const s of stars) if (!s.folded && children.has(s.id)) s.folded = children.get(s.id)

  const links: Link[] = []
  for (const edge of graph.edges) {
    const source = edge.source === centre?.id ? edge.source : starOf.get(edge.source)
    const target = edge.target === centre?.id ? edge.target : starOf.get(edge.target)
    if (!source || !target || source === target) continue
    links.push({ id: edge.id, source, target, edge })
  }
  return { centre, stars, more: rest.length, links }
}

/** What turns the scene: the angles, the zoom, and what the depth does to a pastille. */
export type View = { yaw: number; pitch: number; zoom: number }

export const MIN_ZOOM = 0.6
export const MAX_ZOOM = 2.4
export const MAX_PITCH = 1.2
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** A pastille at the back is this much smaller and paler than one at the front. */
export const BACK_SIZE = 0.55
export const BACK_OPACITY = 0.45

/** The size factor and the opacity of a pastille at `depth` (0 back, 1 front). */
export function depthLook(depth: number): { size: number; opacity: number } {
  return { size: BACK_SIZE + (1 - BACK_SIZE) * depth, opacity: BACK_OPACITY + (1 - BACK_OPACITY) * depth }
}

/** The radius in px of the sphere in a box: the outer orbit and the labels of the stars stay inside it. */
export function sphereRadius(width: number, height: number): number {
  return Math.max(60, Math.min(height * 0.33, width * 0.21))
}

/** A polyline as an SVG path, cut `startGap` px after its first point and `endGap` px before its last one. */
export function trimmedPath(points: readonly { x: number; y: number }[], startGap: number, endGap: number): string {
  if (points.length < 2) return ''
  let from = 0
  const first = points[0]
  while (from < points.length - 2 && Math.hypot(points[from + 1].x - first.x, points[from + 1].y - first.y) < startGap) from++
  let to = points.length - 1
  const last = points[to]
  while (to > from + 1 && Math.hypot(points[to - 1].x - last.x, points[to - 1].y - last.y) < endGap) to--
  const cut = (inner: { x: number; y: number }, end: { x: number; y: number }, gap: number) => {
    const d = Math.hypot(inner.x - end.x, inner.y - end.y)
    if (d <= gap || d === 0) return inner
    const k = gap / d
    return { x: end.x + (inner.x - end.x) * k, y: end.y + (inner.y - end.y) * k }
  }
  const head = cut(points[from + 1] ?? points[from], first, startGap)
  const tail = cut(points[to - 1] ?? points[to], last, endGap)
  const middle = points.slice(from + 1, to)
  const all = [head, ...middle, tail]
  return all.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')
}

export type Rect = { left: number; top: number; right: number; bottom: number }

/** A pastille on the screen: its depth (0 back, 1 front), the box of its disc and the box of its name (null without one). */
export type NamedSpot = { id: string; depth: number; disc: Rect; name: Rect | null; /** Its name is always shown (a selected pastille). */ pinned?: boolean }

const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * The pastilles whose name is not drawn: from the front to the back, a name that would cover (or be covered by) the
 * disc or the name of a pastille nearer to the viewer, or one of the `fixed` boxes (the centre), is hidden. The names
 * of the front are therefore always read, and a pastille at the back keeps its name only where there is room for it.
 */
export function hiddenNames(spots: readonly NamedSpot[], fixed: readonly Rect[] = []): Set<string> {
  const order = [...spots].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.depth - a.depth || a.id.localeCompare(b.id))
  const taken = [...fixed]
  const hidden = new Set<string>()
  for (const spot of order) {
    const name = spot.name
    if (name && !spot.pinned && taken.some(box => overlaps(box, name))) hidden.add(spot.id)
    else if (name) taken.push(name)
    taken.push(spot.disc)
  }
  return hidden
}

/** The label of an arc on the screen: its box, and how much it matters (a lit arc before a dimmed one, the front before the back). */
export type Chip = { id: string; box: Rect; rank: number; /** Always shown (the arc under the pointer). */ pinned?: boolean }

/**
 * The labels of arcs that are not drawn: by rank, one that would cover a box already `taken` (a disc, a name that is
 * drawn, the centre) or a label of a higher rank is hidden.
 */
export function hiddenChips(chips: readonly Chip[], taken: readonly Rect[]): Set<string> {
  const order = [...chips].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.rank - a.rank || a.id.localeCompare(b.id))
  const boxes = [...taken]
  const hidden = new Set<string>()
  for (const chip of order) {
    if (!chip.pinned && boxes.some(box => overlaps(box, chip.box))) hidden.add(chip.id)
    else boxes.push(chip.box)
  }
  return hidden
}
