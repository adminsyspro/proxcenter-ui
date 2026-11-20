'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { Box, IconButton, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { StatusIcon } from '@/app/(dashboard)/infrastructure/inventory/components/TreeIcons'

import {
  MAX_PITCH, MAX_ZOOM, MIN_ZOOM, OUTER_RADIUS, OUTER_TILT, arcPoints, buildConstellation, clamp, depthLook, hiddenChips, hiddenNames, orbitRing, project, rotate, sphereRadius, trimmedPath,
  type Chip, type NamedSpot, type Rect, type Star, type Vec3, type View,
} from './constellationModel'
import { useBoxSize } from './useBoxSize'
import { STATE_DOT } from './ZoneRow'
import { EDGE_COLORS, UNZONED_ID, isPveGroup, type MapEdgeData, type MapNodeData } from './zoneGraph'
import { onKeys } from './ZoneNode'

/** The scene as it opens: seen a little from above, so that the orbits read as ellipses. */
const START: View = { yaw: 0.5, pitch: -0.36, zoom: 1 }
/** The slow turn of the scene, in radians per ms (a full turn in about two minutes and a half). */
const SPIN = 0.000042
/** The points an arc is drawn with: fewer when the map has many arcs. */
const ARC_STEPS = 14
const ARC_STEPS_MANY = 8
const MANY_ARCS = 120
/** The scene is drawn this often at most while it only turns on its own: its slow turn reads the same at 30 frames a second. */
const IDLE_FRAME_MS = 30
/**
 * A frame that draws the scene and takes longer than the screen's own (a large map, a browser without a GPU) slows the
 * turn down: the scene then waits this many times the overrun before it draws itself again, so that the turn it makes
 * on its own never takes more than about a quarter of the main thread. What the user moves is always drawn at once.
 */
const SCREEN_FRAME_MS = 17
const OVERRUN_WAIT = 4
/** How pale, how far and how large a disc: written by steps, so that a frame of the slow turn writes one style per pastille. */
const OPACITY_STEPS = 24
const DEPTH_STEPS = 64
const SIZE_STEPS = 48
const RING_STEPS = 72
/** The two orbits drawn, in the order of `rings`. */
const ORBITS = ['sphere', 'outer'] as const
const DRAG_START = 4
const DOUBLE_CLICK_MS = 600
/** The labels of the arcs are all drawn up to this many arcs; past it only the arc under the pointer says its services. */
const LABELLED_ARCS = 10
/** At most this many points ride the arcs: the busiest observed flows that are still seen. */
const MAX_RIDERS = 6
/** An arc at rest, and one the focus lights (the pointer on a pastille or on the arc, a selection). */
const ARC_OPACITY = 0.6
const ARC_LIT_OPACITY = 1
const CENTRE_ID = 'constellation:centre'
const CENTRE_ZONE_SIZE = 64
/** Where the centre of the scene stands in the height of the box. */
const CENTRE_Y = 0.47
/** The room between a disc and its name, and between two names that are both drawn. */
const NAME_GAP = 4
/** A name keeps this much room around it: two names closer than that read as one. */
const NAME_ROOM = 8

const FADE: Record<string, number> = { 'microseg-dim': 0.3, 'microseg-faint': 0.1, 'microseg-stale': 0.6 }
const fadeOf = (className: string | undefined) => (className ? FADE[className] ?? 1 : 1)

/**
 * The flat disc of a pastille, like the glyphs of the Groups rendering: the paper of the theme, a ring in `ring` (the
 * colour of a zone, or a colour of the theme by its key).
 */
function discSx(size: number, ring: string, width: number, dashed = false) {
  return {
    position: 'absolute', left: -size / 2, top: -size / 2, width: size, height: size, boxSizing: 'border-box', borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper',
    border: `${width}px ${dashed ? 'dashed' : 'solid'}`, borderColor: ring, color: 'text.secondary',
  } as const
}

/** The glyph of a zone, as on the other renderings: a shield in its colour with the dot of its state at its corner. */
function Shield({ color, state, size }: Readonly<{ color: string; state: keyof typeof STATE_DOT; size: number }>) {
  return (
    <Box component='span' sx={{ position: 'relative', display: 'inline-flex', width: size, height: size }}>
      <i className='ri-shield-fill' style={{ fontSize: size, lineHeight: 1, color: color || 'currentColor' }} />
      <Box component='span' data-state={state} sx={{ position: 'absolute', bottom: -2, right: -3, width: size / 2, height: size / 2, borderRadius: '50%', bgcolor: STATE_DOT[state], border: '1.5px solid', borderColor: 'background.paper' }} />
    </Box>
  )
}

const isHex = (color: string | undefined): color is string => !!color && /^#[0-9a-f]{3,8}$/i.test(color)
/** The ring of a zone: its colour, the divider of the theme for a zone without one (like its circle on the Groups rendering). */
const zoneRing = (color: string | undefined) => (isHex(color) ? color : 'divider')

/** What a click (or Enter) on a pastille does: it opens a zone, or selects a guest. */
type StarAct = { zone: string } | { guest: string }
/** `sub`: the line under the name (the members of a zone, the cluster of a guest on a shared policy); `tip`: what its tooltip says. */
type StarLook = { size: number; ring: string; ringWidth: number; dashed?: boolean; icon: ReactNode; name: string; sub?: string; tip?: ReactNode; label: string; act?: StarAct; zoneId?: string; dimmed?: number }

type StarT = (key: string, values?: Record<string, string | number>) => string

/** What a pastille shows and does, from the node of the map it stands for. */
function starLook(star: Star, tNode: StarT, tState: StarT, zoneColor: string): StarLook {
  const d = star.data
  const outer = star.shell === 'outer'
  if (d.kind === 'zone') {
    const members = d.members === null ? tNode('membersUnknown') : tNode('members', { count: d.members })
    const label = tNode('aria', { name: d.zone.name, state: tState(d.state), members })
    return {
      // Like its circle on the Groups rendering: what it is, and how to enter it.
      tip: `${label} · ${tNode('enterHint')}`,
      size: outer ? 40 : 48, ring: zoneRing(d.zone.color), ringWidth: 2, name: d.zone.name, sub: d.members === null ? undefined : members, zoneId: d.zone.id,
      dimmed: d.state === 'disabled' ? 0.65 : 1, label, act: { zone: d.zone.id },
      icon: <Shield color={d.zone.color} state={d.state} size={outer ? 18 : 20} />,
    }
  }
  if (d.kind === 'guest') {
    const m = d.member
    return {
      // On a policy shared by several clusters, the cluster of the guest is said under its name.
      sub: m.cluster?.name,
      // The same details as on the Groups rendering: where the guest runs (its cluster too, on a shared policy), its addresses.
      tip: (
        <Box>
          <Typography variant='caption' fontWeight={600} sx={{ display: 'block' }}>{m.name}</Typography>
          <Typography variant='caption' sx={{ display: 'block' }}>
            {m.cluster ? tNode('guestWhereCluster', { vmid: m.vmid, node: m.node, cluster: m.cluster.name }) : tNode('guestWhere', { vmid: m.vmid, node: m.node })}
          </Typography>
          <Typography variant='caption' sx={{ display: 'block' }}>{m.ips.length ? tNode('guestIps', { ips: m.ips.join(', ') }) : tNode('guestNoIp')}</Typography>
          {m.pending && <Typography variant='caption' sx={{ display: 'block' }}>{tNode('guestPending')}</Typography>}
        </Box>
      ),
      size: 38, ring: m.pending ? 'warning.main' : zoneRing(d.color ?? zoneColor), ringWidth: 2, dashed: m.pending, name: m.name, act: { guest: star.id },
      label: m.cluster ? tNode('guestAriaCluster', { name: m.name, vmid: m.vmid, cluster: m.cluster.name }) : tNode('guestAria', { name: m.name, vmid: m.vmid }),
      icon: <StatusIcon type='vm' vmType={m.type} status={m.status} size={16} />,
    }
  }
  if (d.kind === 'more') {
    const zone = d.groupId && d.groupId !== UNZONED_ID && !isPveGroup(d.groupId) ? d.groupId : null
    return {
      size: 38, ring: 'divider', ringWidth: 1.5, name: `+${d.count}`, label: zone ? tNode('moreHint', { count: d.count }) : `+${d.count}`, act: zone ? { zone } : undefined,
      icon: <Typography component='span' sx={{ fontSize: '0.72rem', fontWeight: 600, color: 'text.primary' }}>{`+${d.count}`}</Typography>,
    }
  }
  if (d.kind === 'unzoned') {
    const name = tNode('unzoned', { count: d.count })
    return { size: outer ? 40 : 46, ring: 'text.disabled', ringWidth: 2, dashed: true, name, label: name, icon: <i className='ri-question-line' style={{ fontSize: 20, opacity: 0.7 }} /> }
  }
  if (d.kind === 'ip') {
    const gateway = d.gatewayOf?.join(', ')
    let icon = 'ri-map-pin-line'
    if (d.network) icon = 'ri-global-line'
    else if (gateway) icon = 'ri-router-line'
    const name = d.network ?? (gateway ? tNode('gateway') : d.ip)
    return { size: 38, ring: 'text.disabled', ringWidth: 1, dashed: true, name, label: name, icon: <i className={icon} style={{ fontSize: 18 }} /> }
  }
  const boundary = d.kind === 'outside' ? 'outside' : 'external'
  const name = tNode(boundary)
  return { size: 40, ring: 'text.disabled', ringWidth: 1, dashed: true, name, label: name, icon: <i className={boundary === 'outside' ? 'ri-cloud-line' : 'ri-global-line'} style={{ fontSize: 18 }} /> }
}

type PastilleProps = {
  id: string
  look: StarLook
  selected: boolean
  target: boolean
  register: (id: string, el: HTMLDivElement | null) => void
  onAct: (act: StarAct) => void
  onHover: (id: string | null) => void
  onFocusNode: (id: string | null) => void
}

/**
 * A pastille: a flat disc with its glyph and the ring of its zone, its name (and count) under it in the text colours
 * of the theme. The primary colour only rings it under the pointer, when selected or targeted. The frame loop moves
 * it; React draws what it says.
 */
const Pastille = memo(function Pastille({ id, look, selected, target, register, onAct, onHover, onFocusNode }: Readonly<PastilleProps>) {
  const theme = useTheme()
  const ref = useCallback((el: HTMLDivElement | null) => register(id, el), [register, id])
  const act = look.act
  const button = act
    ? {
      role: 'button', tabIndex: 0, 'aria-pressed': selected, onKeyDown: onKeys(() => onAct(act)),
      onClick: (event: ReactMouseEvent) => { event.stopPropagation(); onAct(act) },
      onFocus: () => onFocusNode(id), onBlur: () => onFocusNode(null),
    }
    : { role: 'img' }
  const primary = theme.palette.primary.main
  let ring = 'none'
  if (target) ring = `0 0 0 3px ${primary}`
  else if (selected) ring = `0 0 0 4px ${alpha(primary, 0.25)}`
  return (
    <Box
      ref={ref}
      className='constellation-star'
      data-star={id}
      data-zone={look.zoneId}
      data-size={look.size}
      data-dim={look.dimmed ?? 1}
      data-pinned={selected || target ? 'true' : undefined}
      aria-label={look.label}
      {...button}
      onPointerEnter={() => onHover(id)}
      onPointerLeave={() => onHover(null)}
      sx={{
        cursor: act ? 'pointer' : 'default',
        '&:hover .constellation-disc': act && !selected && !target ? { boxShadow: `0 0 0 2px ${primary}` } : undefined,
        '&:focus-visible .constellation-disc': { outline: `2px solid ${primary}`, outlineOffset: 2 },
      }}
    >
      <Tooltip title={look.tip ?? (look.sub ? `${look.name} · ${look.sub}` : look.name)} placement='top' enterDelay={400} disableInteractive>
        <Box className='constellation-disc' sx={{ ...discSx(look.size, look.ring, look.ringWidth, look.dashed), boxShadow: ring }}>
          {look.icon}
        </Box>
      </Tooltip>
      {/* On the paper of the theme, like the name of a guest on the Groups rendering: an arc goes behind it, not through it. */}
      <Box className='constellation-name' sx={{ position: 'absolute', top: 0, left: 0, width: 'max-content', maxWidth: 150, px: 0.5, borderRadius: 0.5, bgcolor: 'background.paper', transform: `translate(-50%,${look.size / 2 + NAME_GAP}px)`, textAlign: 'center', pointerEvents: 'none' }}>
        <Typography noWrap sx={{ fontSize: '0.82rem', lineHeight: 1.3, fontWeight: 600, color: 'text.primary' }}>{look.name}</Typography>
        {look.sub && <Typography noWrap sx={{ fontSize: '0.72rem', lineHeight: 1.3, color: 'text.secondary' }}>{look.sub}</Typography>}
      </Box>
    </Box>
  )
})

type Props = {
  nodes: Node[]
  edges: Edge[]
  onSelectZone: (zoneId: string) => void
  onEnterZone?: (zoneId: string) => void
  onSelectGuest: (nodeId: string) => void
  onSelectEdge: (edgeId: string) => void
  onHover: (id: string | null) => void
  onFocusNode: (id: string | null) => void
  onClear: () => void
}

type ScreenSpot = { x: number; y: number; r: number; depth: number }
type Arc = { id: string; source: string; target: string; points: Vec3[]; data: MapEdgeData; edge: Edge; fade: number; lit: boolean; rider: boolean; phase: number }

const boxOf = (x: number, y: number, halfW: number, top: number, bottom: number): Rect => ({ left: x - halfW, right: x + halfW, top: y + top, bottom: y + bottom })

/** The observed arcs a point rides: the busiest ones still seen (not faded, not dimmed), a few of them only. */
function ridersOf(arcs: readonly Pick<Arc, 'id' | 'data' | 'edge' | 'fade'>[]): Set<string> {
  const live = arcs.filter(a => a.data.hits !== null && a.fade === 1 && a.edge.className !== 'microseg-stale')
  live.sort((a, b) => (b.data.hits ?? 0) - (a.data.hits ?? 0) || a.id.localeCompare(b.id))
  return new Set(live.slice(0, MAX_RIDERS).map(a => a.id))
}

/**
 * The constellation rendering of the map: the cluster (or an entered zone) in the centre, a pastille per zone (or per
 * guest of the entered zone) on a sphere that turns slowly, what is outside on an outer orbit, the flows as thin arcs
 * in the colours of the map. It wears the theme like the Groups rendering: its background, flat discs on the paper
 * with the ring of their zone, the text colours for the names, the primary colour for the pointer and the selection
 * only. The names are sorted by depth: one that would cover a nearer pastille is not drawn. HTML pastilles placed by
 * a perspective projection computed here (no 3D library), the arcs and the two orbits in SVG. The scene stops turning
 * under the pointer, turns with a drag, zooms with the wheel; with `prefers-reduced-motion` nothing moves on its own.
 * It draws the graph it is given: no request of its own.
 */
export default function ZoneConstellation({ nodes, edges, onSelectZone, onEnterZone, onSelectGuest, onSelectEdge, onHover, onFocusNode, onClear }: Readonly<Props>) {
  const theme = useTheme()
  const t = useTranslations('microsegPilot.overview')
  const tNode = useTranslations('microsegPilot.overview.node') as unknown as StarT
  const tState = useTranslations('microsegPilot.policy.zone.state') as unknown as StarT
  const format = useFormatter()
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [boxRef, size] = useBoxSize<HTMLDivElement>()
  const [spinning, setSpinning] = useState(true)
  const [hoveredArc, setHoveredArc] = useState<string | null>(null)

  const scene = useMemo(() => buildConstellation({ nodes, edges }), [nodes, edges])
  const arcs = useMemo<Arc[]>(() => {
    const origin = { x: 0, y: 0, z: 0 }
    const starAt = new Map(scene.stars.map(s => [s.id, s.at]))
    const steps = scene.links.length > MANY_ARCS ? ARC_STEPS_MANY : ARC_STEPS
    // The focus (the pointer on a pastille or an arc, a selection) dims what it leaves out: what is left is lit.
    const dimmed = (className: string | undefined) => className === 'microseg-dim' || className === 'microseg-faint'
    const focused = scene.links.some(l => dimmed(l.edge.className)) || scene.stars.some(star => dimmed(star.node.className))
    const drawn = scene.links.flatMap((link, i) => {
      const a = link.source === scene.centre?.id ? origin : starAt.get(link.source)
      const b = link.target === scene.centre?.id ? origin : starAt.get(link.target)
      if (!a || !b) return []
      const fade = fadeOf(link.edge.className)
      return [{
        id: link.id, source: link.source === scene.centre?.id ? CENTRE_ID : link.source, target: link.target === scene.centre?.id ? CENTRE_ID : link.target,
        points: arcPoints(a, b, steps), data: link.edge.data as unknown as MapEdgeData, edge: link.edge, fade, lit: focused && !dimmed(link.edge.className),
        rider: false, phase: (i * 0.37) % 1,
      }]
    })
    const riders = ridersOf(drawn)
    return drawn.map(arc => (riders.has(arc.id) ? { ...arc, rider: true } : arc))
  }, [scene])
  // The two orbits: the sphere of the pastilles and the outer one.
  const rings = useMemo(() => [orbitRing(RING_STEPS, 1, 0), orbitRing(RING_STEPS, OUTER_RADIUS, OUTER_TILT)], [])

  const centre = scene.centre ? (scene.centre.data as unknown as MapNodeData) : null
  const centreZone = centre?.kind === 'zone' ? centre : null
  // Nothing is drawn in the centre of the map itself (the connection picker names the cluster): only an entered zone is.
  const centreSize = centreZone ? CENTRE_ZONE_SIZE : 0

  const view = useRef<View>({ ...START })
  const stars = useRef(new Map<string, HTMLDivElement>())
  const arcEls = useRef(new Map<string, SVGGElement>())
  const ringEls = useRef<(SVGPathElement | null)[]>([])
  const labelEls = useRef(new Map<string, HTMLDivElement>())
  const centreEl = useRef<HTMLDivElement | null>(null)
  // The size of each name as it is laid out, read once per render (never in the frame loop).
  const nameSizes = useRef(new Map<string, { w: number; h: number }>())
  const centreNameSize = useRef({ w: 0, h: 0 })
  const chipSizes = useRef(new Map<string, { w: number; h: number }>())
  // The steps last written on each pastille and each arc (see the frame loop).
  const steps = useRef(new Map<string, { opacity: number; z: number; size: number; name: number }>())
  const arcSteps = useRef(new Map<string, number>())
  // Where each arc was last drawn: the points that ride the arcs follow it between two drawings of the scene.
  const arcPaths = useRef(new Map<string, { x: number; y: number }[]>())
  // The scene changed (a turn, a zoom, new data) and is drawn at the next frame; `looping` while the frame loop runs.
  const dirty = useRef(true)
  const looping = useRef(false)
  const pointerInside = useRef(false)
  const drag = useRef<{ x: number; y: number; moved: boolean; id: number } | null>(null)
  const dragged = useRef(false)
  const lastZone = useRef<{ id: string; at: number } | null>(null)
  const register = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) stars.current.set(id, el)
    else { stars.current.delete(id); steps.current.delete(id); nameSizes.current.delete(id) }
  }, [])

  const fades = useMemo(() => new Map(scene.stars.map(s => [s.id, fadeOf(s.node.className)])), [scene.stars])
  // What the frame loop reads: always the last render's, without restarting the loop.
  const live = useRef({ scene, arcs, fades, size, centreSize, hoveredArc })
  useLayoutEffect(() => { live.current = { scene, arcs, fades, size, centreSize, hoveredArc } })

  /** The points that ride the busiest observed arcs, on the arcs as they were last drawn: about four seconds from source to target. */
  const ride = useCallback((now: number) => {
    for (const arc of live.current.arcs) {
      if (!arc.rider) continue
      const dot = arcEls.current.get(arc.id)?.children[2] as SVGCircleElement | undefined
      const pts = arcPaths.current.get(arc.id)
      if (!dot || !pts || pts.length < 2) continue
      const along = ((now * 0.00026 + arc.phase) % 1) * (pts.length - 1)
      const i = Math.min(pts.length - 2, Math.floor(along))
      const f = along - i
      dot.setAttribute('cx', (pts[i].x + (pts[i + 1].x - pts[i].x) * f).toFixed(1))
      dot.setAttribute('cy', (pts[i].y + (pts[i + 1].y - pts[i].y) * f).toFixed(1))
    }
  }, [])

  const draw = useCallback((now: number) => {
    const { scene: sc, arcs: links, fades: starFades, size: box, centreSize: centreDisc, hoveredArc: pointed } = live.current
    if (!box) return
    const { yaw, pitch, zoom } = view.current
    const cx = box.width / 2
    // A little above the middle: the names under the stars at the bottom of the outer orbit stay in the box.
    const cy = box.height * CENTRE_Y
    const radius = sphereRadius(box.width, box.height) * zoom
    // The pastilles grow less than the sphere when it is zoomed: their names stay readable, they do not pile up.
    const grow = Math.sqrt(zoom)
    const spots = new Map<string, ScreenSpot>()
    const centreR = (centreDisc / 2) * grow
    spots.set(CENTRE_ID, { x: cx, y: cy, r: centreR, depth: 0.5 })
    const centreNode = centreEl.current
    if (centreNode) {
      centreNode.style.transform = `translate3d(${cx}px,${cy}px,0)`
      const disc = centreNode.firstElementChild as HTMLElement | null
      const label = centreNode.lastElementChild as HTMLElement | null
      if (disc) disc.style.transform = `scale(${grow.toFixed(3)})`
      if (label) label.style.transform = `translate(-50%,${(centreR + NAME_GAP).toFixed(1)}px)`
    }

    const named: NamedSpot[] = []
    const tops = new Map<string, number>()
    for (const star of sc.stars) {
      const el = stars.current.get(star.id)
      if (!el) continue
      const at = project(rotate(star.at, yaw, pitch), radius)
      const look = depthLook(at.depth)
      const x = cx + at.x
      const y = cy + at.y
      // One write a frame: the place. What changes by steps (how pale, how far, how large its disc) is written when
      // the step changes, which a slow turn does a few times a second. The name is never scaled: it stays sharp.
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)`
      const k = Math.round(look.size * grow * SIZE_STEPS) / SIZE_STEPS
      const half = (Number(el.dataset.size) / 2) * k
      const seen = steps.current.get(star.id) ?? { opacity: -1, z: -1, size: -1, name: -1 }
      if (seen.size !== k) {
        seen.size = k
        const disc = el.firstElementChild as HTMLElement | null
        if (disc) disc.style.transform = `scale(${k})`
      }
      const opacity = Math.round(look.opacity * (starFades.get(star.id) ?? 1) * Number(el.dataset.dim ?? 1) * OPACITY_STEPS)
      if (seen.opacity !== opacity) { seen.opacity = opacity; el.style.opacity = (opacity / OPACITY_STEPS).toFixed(3) }
      // Sorted by depth: a pastille nearer to the viewer is drawn over one further away.
      const z = 100 + Math.round(at.depth * DEPTH_STEPS)
      if (seen.z !== z) { seen.z = z; el.style.zIndex = String(z) }
      steps.current.set(star.id, seen)
      spots.set(star.id, { x, y, r: half, depth: at.depth })
      const measured = nameSizes.current.get(star.id)
      const top = half + NAME_GAP
      tops.set(star.id, top)
      named.push({
        id: star.id, depth: at.depth, pinned: el.dataset.pinned === 'true',
        disc: boxOf(x, y, half, -half, half),
        name: measured && measured.w > 0 ? boxOf(x, y, measured.w / 2 + NAME_ROOM, top - 2, top + measured.h + 2) : null,
      })
    }
    // The names, from the front to the back: one that would cover a nearer pastille (or the centre) is not drawn.
    const centreLabel = centreNameSize.current
    const centreBoxes = centreDisc > 0
      ? [
        boxOf(cx, cy, centreR, -centreR, centreR),
        boxOf(cx, cy, centreLabel.w / 2 + NAME_ROOM, centreR + NAME_GAP, centreR + NAME_GAP + centreLabel.h),
      ]
      : []
    const hidden = hiddenNames(named, centreBoxes)
    // What the labels of the arcs must not cover: the centre, every disc, every name that is drawn.
    const taken = [...centreBoxes, ...named.flatMap(spot => (spot.name && !hidden.has(spot.id) ? [spot.disc, spot.name] : [spot.disc]))]
    const chips: Chip[] = []
    for (const spot of named) {
      const el = stars.current.get(spot.id)
      const seen = steps.current.get(spot.id)
      if (!el || !seen) continue
      // Under its disc, whatever the size of the disc; 0 once hidden.
      const name = hidden.has(spot.id) ? 0 : Math.round((tops.get(spot.id) ?? 0) * 2) / 2
      if (seen.name === name) continue
      seen.name = name
      const label = el.lastElementChild as HTMLElement | null
      if (!label) continue
      label.style.opacity = name ? '1' : '0'
      if (name) label.style.transform = `translate(-50%,${name}px)`
    }

    for (const arc of links) {
      const g = arcEls.current.get(arc.id)
      const a = spots.get(arc.source)
      const b = spots.get(arc.target)
      if (!g || !a || !b) continue
      const pts = arc.points.map(v => { const q = project(rotate(v, yaw, pitch), radius); return { x: cx + q.x, y: cy + q.y } })
      const d = trimmedPath(pts, a.r + 2, b.r + 7)
      const depth = (a.depth + b.depth) / 2
      const paths = g.children
      // The wide path that takes the pointer is only kept in place under the pointer, where the scene does not turn.
      if (pointerInside.current) paths[0].setAttribute('d', d)
      paths[1].setAttribute('d', d)
      const opacity = Math.round((arc.lit ? ARC_LIT_OPACITY : ARC_OPACITY) * (0.7 + 0.3 * depth) * arc.fade * OPACITY_STEPS)
      if (arcSteps.current.get(arc.id) !== opacity) { arcSteps.current.set(arc.id, opacity); g.style.opacity = (opacity / OPACITY_STEPS).toFixed(3) }
      arcPaths.current.set(arc.id, pts)
      const label = labelEls.current.get(arc.id)
      if (label) {
        // Nearer to its target than to its source: the middle of the arcs is where they cross.
        const mid = pts[Math.round((pts.length - 1) * 0.64)]
        label.style.transform = `translate3d(${mid.x.toFixed(1)}px,${mid.y.toFixed(1)}px,0) translate(-50%,-50%)`
        const measured = chipSizes.current.get(arc.id)
        if (measured) chips.push({ id: arc.id, box: boxOf(mid.x, mid.y, measured.w / 2 + NAME_GAP, -measured.h / 2 - 2, measured.h / 2 + 2), rank: (arc.fade === 1 ? 2 : 0) + depth, pinned: arc.id === pointed })
      }
    }
    // The labels of the arcs, the lit ones and the front first: one that would cover a pastille or another label is not drawn.
    const hiddenLabels = hiddenChips(chips, taken)
    for (const arc of links) {
      const label = labelEls.current.get(arc.id)
      if (!label) continue
      let opacity = arc.fade < 1 ? '0.4' : '1'
      if (hiddenLabels.has(arc.id)) opacity = '0'
      if (label.style.opacity !== opacity) label.style.opacity = opacity
    }

    rings.forEach((ring, i) => {
      const path = ringEls.current[i]
      if (!path) return
      const d = ring.map((v, n) => { const q = project(rotate(v, yaw, pitch), radius); return `${n ? 'L' : 'M'}${(cx + q.x).toFixed(1)} ${(cy + q.y).toFixed(1)}` }).join('')
      path.setAttribute('d', `${d}Z`)
    })
    ride(now)
  }, [rings, ride])

  /** The scene is drawn again at the next frame (by the frame loop, or by a frame of its own when nothing loops). */
  const invalidate = useCallback(() => {
    if (dirty.current) return
    dirty.current = true
    if (looping.current) return
    requestAnimationFrame(now => {
      if (!dirty.current) return
      dirty.current = false
      draw(now)
    })
  }, [draw])

  // Every render is measured (the names) and drawn at once (a star added is at its place before the next frame).
  useLayoutEffect(() => {
    for (const id of arcPaths.current.keys()) if (!arcEls.current.has(id)) { arcPaths.current.delete(id); arcSteps.current.delete(id) }
    for (const [id, el] of stars.current) {
      const label = el.lastElementChild as HTMLElement | null
      if (label) nameSizes.current.set(id, { w: label.offsetWidth, h: label.offsetHeight })
    }
    const centreLabel = centreEl.current?.lastElementChild as HTMLElement | null | undefined
    centreNameSize.current = { w: centreLabel?.offsetWidth ?? 0, h: centreLabel?.offsetHeight ?? 0 }
    chipSizes.current = new Map([...labelEls.current].map(([id, el]) => [id, { w: el.offsetWidth, h: el.offsetHeight }]))
    dirty.current = false
    draw(performance.now())
  })

  // The frame loop: the slow turn (not under the pointer, not while dragged, never with reduced motion) and the points
  // that ride the arcs. With reduced motion nothing moves on its own: the scene is drawn when it changes.
  const turning = spinning && !reduced
  useEffect(() => {
    if (reduced) return
    let frame = 0
    let last = performance.now()
    let drawn = last
    // How long a frame that drew the scene lasts (smoothed), measured from its start to the start of the next one.
    let cost = SCREEN_FRAME_MS
    let measuring = false
    looping.current = true
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick)
      if (measuring) {
        cost += (Math.min(now - drawn, 250) - cost) * 0.2
        measuring = false
      }
      // What the user moves is drawn at once; what moves on its own (the slow turn, the riding points) at 30 frames a
      // second at most, the turn less often when drawing it overruns the frame of the screen.
      if (!dirty.current && now - last < IDLE_FRAME_MS) return
      last = now
      const spin = turning && !pointerInside.current && !drag.current
      const wait = IDLE_FRAME_MS + OVERRUN_WAIT * Math.max(0, cost - SCREEN_FRAME_MS)
      if (dirty.current || (spin && now - drawn >= wait)) {
        if (spin) view.current.yaw += Math.min(now - drawn, 400) * SPIN
        drawn = now
        measuring = true
        dirty.current = false
        draw(now)
      } else {
        if (!spin) drawn = now
        ride(now)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => { looping.current = false; cancelAnimationFrame(frame) }
  }, [reduced, turning, draw, ride])

  // The wheel zooms the scene instead of scrolling the page (a passive listener could not prevent it).
  const boxEl = useRef<HTMLDivElement | null>(null)
  const setBox = useCallback((el: HTMLDivElement | null) => { boxEl.current = el; boxRef(el) }, [boxRef])
  useEffect(() => {
    const el = boxEl.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      view.current.zoom = clamp(view.current.zoom * Math.exp(-event.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
      invalidate()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [invalidate])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.constellation-controls')) return
    drag.current = { x: event.clientX, y: event.clientY, moved: false, id: event.pointerId }
    dragged.current = false
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (!d.moved) {
      if (Math.hypot(dx, dy) < DRAG_START) return
      d.moved = true
      dragged.current = true
      event.currentTarget.setPointerCapture?.(d.id)
    }
    d.x = event.clientX
    d.y = event.clientY
    view.current.yaw += dx * 0.006
    view.current.pitch = clamp(view.current.pitch - dy * 0.006, -MAX_PITCH, MAX_PITCH)
    invalidate()
  }
  const endDrag = () => { drag.current = null }

  // A double click on a zone enters it. Its first click already opened the panel of the zone: the box got narrower
  // and the pastille moved, so the zone entered is the one of the first click wherever the second one falls.
  const onClickCapture = (event: ReactMouseEvent) => {
    if (dragged.current) {
      dragged.current = false
      event.stopPropagation()
      return
    }
    const first = lastZone.current
    if (event.detail !== 2 || !first || !onEnterZone) return
    lastZone.current = null
    if (Date.now() - first.at > DOUBLE_CLICK_MS) return
    event.stopPropagation()
    onEnterZone(first.id)
  }
  const act = useCallback((what: StarAct) => {
    if ('zone' in what) {
      lastZone.current = { id: what.zone, at: Date.now() }
      onSelectZone(what.zone)
    } else {
      lastZone.current = null
      onSelectGuest(what.guest)
    }
  }, [onSelectZone, onSelectGuest])

  const zoomBy = (factor: number) => { view.current.zoom = clamp(view.current.zoom * factor, MIN_ZOOM, MAX_ZOOM); invalidate() }
  const reset = () => { view.current = { ...START }; invalidate() }

  const primary = theme.palette.primary.main
  const centreColor = centreZone?.zone.color ?? ''
  const centreMembers = centreZone && centreZone.members !== null ? tNode('members', { count: centreZone.members }) : null
  const centreSelected = !!scene.centre?.selected
  const labelled = arcs.length <= LABELLED_ARCS
  const arcLabel = (d: MapEdgeData) => [d.label, d.hits === null ? null : format.number(d.hits, { notation: 'compact' })].filter(Boolean).join(' · ')
  const controlSx = { width: 28, height: 28, borderRadius: 0, color: 'text.primary', borderBottom: 1, borderColor: 'divider', '&:last-of-type': { borderBottom: 0 }, '&:hover': { bgcolor: 'action.hover' } } as const

  return (
    <Box
      ref={setBox}
      data-testid='zone-constellation'
      data-turning={turning ? 'true' : 'false'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => { pointerInside.current = true; invalidate() }}
      onPointerLeave={() => { pointerInside.current = false }}
      onClickCapture={onClickCapture}
      onClick={() => { lastZone.current = null; onClear() }}
      sx={{
        // The background of the theme, like the other renderings of the map: nothing is painted here. Its own stacking
        // context: the depths of the pastilles stay inside it, under what the map draws over it (the way back, the isolation).
        position: 'absolute', inset: 0, zIndex: 0, isolation: 'isolate', overflow: 'hidden', userSelect: 'none', touchAction: 'none', cursor: 'grab', '&:active': { cursor: 'grabbing' },
        // No `will-change` on the pastilles: a layer per pastille is not worth its cost on a map of 150 of them.
        '& .constellation-star': { position: 'absolute', left: 0, top: 0, width: 0, height: 0, opacity: 0, outline: 'none' },
        '& .constellation-arc .hit': { stroke: 'transparent', strokeWidth: 14, fill: 'none', pointerEvents: 'stroke', cursor: 'pointer' },
        '& .constellation-arc .line': { fill: 'none', pointerEvents: 'none' },
        '& .constellation-arc:hover .line': { strokeWidth: 2.25 },
        '& .constellation-orbit': { fill: 'none', stroke: 'currentColor', strokeWidth: 1, pointerEvents: 'none' },
        '@keyframes constellationIn': { from: { opacity: 0 }, to: { opacity: 1 } },
        '& .constellation-layer': { position: 'absolute', inset: 0, animation: reduced ? 'none' : 'constellationIn 200ms ease-out' },
      }}
    >
      <Box className='constellation-layer' key={scene.centre?.id ?? 'cluster'}>
        <svg role='group' aria-label={t('constellation.flows')} width='100%' height='100%' style={{ position: 'absolute', inset: 0, zIndex: 50, overflow: 'visible', pointerEvents: 'none' }}>
          <defs>
            {Object.entries(EDGE_COLORS).map(([kind, color]) => (
              <marker key={kind} id={`constellation-arrow-${kind}`} viewBox='0 0 10 10' refX='8' refY='5' markerWidth='7' markerHeight='7' markerUnits='userSpaceOnUse' orient='auto'>
                <path d='M0 0L10 5L0 10z' fill={color} />
              </marker>
            ))}
          </defs>
          {/* The two orbits, in the divider colour of the theme. */}
          <Box component='g' aria-hidden sx={{ color: 'divider' }}>
            {ORBITS.map((orbit, i) => <path key={orbit} ref={el => { ringEls.current[i] = el }} className='constellation-orbit' />)}
          </Box>
          {arcs.map(arc => {
            const style = arc.edge.style ?? {}
            // Thin lines: 1.25 px for an observed flow, 1.5 px for an allowed one, a little more once lit.
            const width = (arc.data.hits === null ? 1.5 : 1.25) + (arc.lit ? 0.5 : 0)
            return (
              <g
                key={arc.id}
                ref={el => { if (el) arcEls.current.set(arc.id, el); else { arcEls.current.delete(arc.id); arcSteps.current.delete(arc.id) } }}
                className='constellation-arc'
                data-arc={arc.id}
                data-kind={arc.data.kind}
                data-lit={arc.lit ? 'true' : undefined}
                role='img'
                aria-label={arc.edge.ariaLabel ?? arc.data.label}
                onClick={event => { event.stopPropagation(); lastZone.current = null; onSelectEdge(arc.id) }}
                onPointerEnter={() => { setHoveredArc(arc.id); onHover(arc.id) }}
                onPointerLeave={() => { setHoveredArc(null); onHover(null) }}
              >
                <path className='hit' />
                <path className='line' stroke={arc.data.color} strokeWidth={width} strokeDasharray={style.strokeDasharray as string | undefined} strokeLinecap='round' markerEnd={`url(#constellation-arrow-${arc.data.kind})`} />
                {arc.rider && !reduced && <circle r={2.25} fill={arc.data.color} style={{ pointerEvents: 'none' }} />}
              </g>
            )
          })}
        </svg>
        {arcs.filter(arc => labelled || arc.id === hoveredArc).map(arc => {
          const text = arcLabel(arc.data)
          if (!text) return null
          return (
            <Box
              key={arc.id}
              ref={(el: HTMLDivElement | null) => { if (el) labelEls.current.set(arc.id, el); else labelEls.current.delete(arc.id) }}
              data-arc-label={arc.id}
              sx={{ position: 'absolute', left: 0, top: 0, zIndex: 950, pointerEvents: 'none', px: 0.75, borderRadius: 1, bgcolor: 'background.paper', border: 1, borderColor: 'divider', whiteSpace: 'nowrap' }}
            >
              <Typography sx={{ fontSize: '0.7rem', lineHeight: 1.6, fontWeight: 600, color: 'text.primary' }}>{text}</Typography>
            </Box>
          )
        })}
        {/* The centre: the entered zone with its ring, in the middle of the depths. */}
        {centreZone && (
        <Box
          ref={centreEl}
          data-testid='constellation-centre'
          className='constellation-centre'
          role='button'
          tabIndex={0}
          aria-pressed={centreSelected}
          aria-label={tNode('aria', { name: centreZone.zone.name, state: tState(centreZone.state), members: centreMembers ?? tNode('membersUnknown') })}
          onClick={(event: ReactMouseEvent) => { event.stopPropagation(); lastZone.current = null; onSelectZone(centreZone.zone.id) }}
          onKeyDown={onKeys(() => onSelectZone(centreZone.zone.id))}
          sx={{
            position: 'absolute', left: 0, top: 0, width: 0, height: 0, zIndex: 100 + DEPTH_STEPS / 2, cursor: 'pointer', outline: 'none',
            '&:hover > div:first-of-type': centreSelected ? undefined : { boxShadow: `0 0 0 2px ${primary}` },
            '&:focus-visible > div:first-of-type': { outline: `2px solid ${primary}`, outlineOffset: 2 },
          }}
        >
          <Box sx={{ ...discSx(centreSize, zoneRing(centreColor), 2), boxShadow: centreSelected ? `0 0 0 4px ${alpha(primary, 0.25)}` : 'none' }}>
            <Shield color={centreColor} state={centreZone.state} size={26} />
          </Box>
          <Box sx={{ position: 'absolute', top: 0, left: 0, width: 'max-content', maxWidth: 240, px: 0.5, borderRadius: 0.5, bgcolor: 'background.paper', transform: `translate(-50%,${centreSize / 2 + NAME_GAP}px)`, textAlign: 'center', pointerEvents: 'none' }}>
            <Typography noWrap sx={{ fontSize: '0.9rem', lineHeight: 1.3, fontWeight: 600, color: 'text.primary' }}>{centreZone.zone.name}</Typography>
            {centreMembers && <Typography noWrap sx={{ fontSize: '0.75rem', lineHeight: 1.3, color: 'text.secondary' }}>{centreMembers}</Typography>}
          </Box>
        </Box>
        )}
        {scene.stars.map(star => (
          <Pastille
            key={star.id}
            id={star.id}
            look={starLook(star, tNode, tState, centreColor)}
            selected={!!star.node.selected}
            target={star.node.className === 'microseg-target'}
            register={register}
            onAct={act}
            onHover={onHover}
            onFocusNode={onFocusNode}
          />
        ))}
      </Box>
      <Box
        className='constellation-controls'
        role='group'
        aria-label={t('controls')}
        onClick={event => event.stopPropagation()}
        sx={{ position: 'absolute', left: 12, bottom: 12, zIndex: 1000, display: 'flex', flexDirection: 'column', borderRadius: 1, overflow: 'hidden', bgcolor: 'background.paper', boxShadow: 1, cursor: 'default' }}
      >
        <Tooltip title={t('zoomIn')} placement='right'><IconButton size='small' aria-label={t('zoomIn')} onClick={() => zoomBy(1.25)} sx={controlSx}><i className='ri-add-line' aria-hidden style={{ fontSize: 16 }} /></IconButton></Tooltip>
        <Tooltip title={t('zoomOut')} placement='right'><IconButton size='small' aria-label={t('zoomOut')} onClick={() => zoomBy(0.8)} sx={controlSx}><i className='ri-subtract-line' aria-hidden style={{ fontSize: 16 }} /></IconButton></Tooltip>
        <Tooltip title={t('fitView')} placement='right'><IconButton size='small' aria-label={t('fitView')} onClick={reset} sx={controlSx}><i className='ri-fullscreen-line' aria-hidden style={{ fontSize: 16 }} /></IconButton></Tooltip>
        {!reduced && (
          <Tooltip title={t(spinning ? 'constellation.pause' : 'constellation.play')} placement='right'>
            <IconButton size='small' aria-label={t(spinning ? 'constellation.pause' : 'constellation.play')} aria-pressed={!spinning} onClick={() => setSpinning(s => !s)} sx={controlSx}>
              <i className={spinning ? 'ri-pause-line' : 'ri-play-line'} aria-hidden style={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  )
}
