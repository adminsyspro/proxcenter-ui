/**
 * The Sankey layout is pure: sources on the left, destinations on the right, a ribbon per pair and kind, the
 * observed ones as wide as the square root of their hits, the allowed ones thin, every node as tall as its ribbons.
 */

import { describe, expect, it } from 'vitest'

import { demoInput, flow, seen, zone } from './mapViewsTestKit'
import { buildMatrix } from './matrixModel'
import {
  ALLOWED_W, BAR_W, COMPACT_W, FOOT, HEAD, LABEL_W, MAX_FILL_W, MAX_W, MIN_PITCH, MIN_W, NODE_GAP, buildSankey, ribbonWidth, type SankeyLayout,
} from './sankeyModel'
import { ALL_FLOWS } from './zoneGraph'

const web = zone('zw', 'web')
const db = zone('zd', 'db')
const app = zone('za', 'app')

describe('ribbonWidth', () => {
  it('follows the square root of the hits, the busiest at the widest, never under the minimum', () => {
    expect(ribbonWidth(100, 100)).toBe(MAX_W)
    expect(ribbonWidth(25, 100)).toBe(MAX_W / 2)
    expect(ribbonWidth(0, 100)).toBe(MIN_W)
    expect(ribbonWidth(1, 1_000_000)).toBe(MIN_W)
    expect(ribbonWidth(5, 0)).toBe(MIN_W)
  })
})

describe('buildSankey', () => {
  const matrix = buildMatrix({
    zones: [web, db, app],
    flows: [flow('f1'), flow('f2', { src_zone_id: 'za', dst_zone_id: 'zd' }), flow('f3', { dst_zone_id: '', dst_cidr: '10.0.0.0/8' })],
    suggestions: [
      seen('s1', { hits: 100 }),
      seen('s2', { kind: 'blocked', hits: 25 }),
      seen('s3', { src_zone_id: 'za', dst_zone_id: 'zw', hits: 4 }),
      seen('s4', { src_zone_id: '', src_ip: '10.9.0.1', dst_zone_id: 'za', hits: 9 }),
    ],
  })
  const layout = buildSankey(matrix, ALL_FLOWS)

  it('draws a ribbon per pair and kind, observed ones by their hits, allowed ones thin', () => {
    const byId = new Map(layout.ribbons.map(r => [r.id, r]))
    expect([...byId.keys()].sort()).toEqual([
      'allowed:cell:zone:za>zone:zd',
      'allowed:cell:zone:zw>zone:zd',
      'blocked:cell:zone:zw>zone:zd',
      'outside:cell:zone:zw>outside',
      'unprotected:cell:external>zone:za',
      'unprotected:cell:zone:za>zone:zw',
      'unprotected:cell:zone:zw>zone:zd',
    ])
    expect(byId.get('unprotected:cell:zone:zw>zone:zd')).toMatchObject({ width: MAX_W, hits: 100, count: 1, cell: 'cell:zone:zw>zone:zd' })
    expect(byId.get('blocked:cell:zone:zw>zone:zd')!.width).toBe(MAX_W / 2)
    expect(byId.get('allowed:cell:zone:zw>zone:zd')).toMatchObject({ width: ALLOWED_W, hits: 0, count: 1, services: ['tcp/443'] })
  })

  it('orders the nodes by hits, then by name', () => {
    expect(layout.sources.map(n => n.id)).toEqual(['zone:zw', 'external', 'zone:za'])
    expect(layout.targets.map(n => n.id)).toEqual(['zone:zd', 'zone:za', 'zone:zw', 'outside'])
    expect(layout.sources[0]).toMatchObject({ hits: 125, zone: web })
  })

  it('stacks the nodes with a gap (a thin node takes MIN_PITCH), each as tall as its ribbons, the ribbons side by side inside it', () => {
    for (const side of [layout.sources, layout.targets]) {
      let top = 0
      for (const n of side) {
        expect(n.y, n.id).toBe(top)
        const own = layout.ribbons.filter(r => (side === layout.sources ? r.source : r.target) === n.id)
        const ends = own.map(r => (side === layout.sources ? r.y0 : r.y1)).sort((a, b) => a - b)
        expect(own.reduce((s, r) => s + r.width, 0), n.id).toBeCloseTo(n.height)
        expect(ends[0], n.id).toBe(n.y)
        top = n.y + Math.max(n.height, MIN_PITCH) + NODE_GAP
      }
    }
    expect(layout.height).toBe(Math.max(...[...layout.sources, ...layout.targets].map(n => n.y + Math.max(n.height, MIN_PITCH))))
    expect(layout.targets.find(n => n.id === 'outside')!.height).toBeLessThan(MIN_PITCH)
  })

  it('orders the ribbons of a node by the other end, then unprotected, blocked, allowed', () => {
    const atWeb = layout.ribbons.filter(r => r.source === 'zone:zw').sort((a, b) => a.y0 - b.y0).map(r => r.id)
    expect(atWeb).toEqual(['unprotected:cell:zone:zw>zone:zd', 'blocked:cell:zone:zw>zone:zd', 'allowed:cell:zone:zw>zone:zd', 'outside:cell:zone:zw>outside'])
  })

  it('follows the checkboxes', () => {
    const observedOnly = buildSankey(matrix, { ...ALL_FLOWS, allowed: false })
    expect(observedOnly.ribbons.every(r => r.kind === 'unprotected' || r.kind === 'blocked')).toBe(true)
    expect(observedOnly.targets.some(n => n.id === 'outside')).toBe(false)
    const blockedOnly = buildSankey(matrix, { allowed: false, unprotected: false, blocked: true })
    expect(blockedOnly.ribbons.map(r => r.id)).toEqual(['blocked:cell:zone:zw>zone:zd'])
    expect(blockedOnly.ribbons[0].width).toBe(MAX_W)
    expect(buildSankey(matrix, { allowed: false, unprotected: false, blocked: false })).toEqual({ sources: [], targets: [], ribbons: [], height: 0, width: COMPACT_W, leftX: LABEL_W, rightX: COMPACT_W - LABEL_W - BAR_W, fill: false })
  })

  it('is deterministic on the demo-like draft', () => {
    const input = demoInput()
    const a = buildSankey(buildMatrix(input), ALL_FLOWS)
    const b = buildSankey(buildMatrix({ ...input, zones: [...input.zones].reverse(), flows: [...input.flows].reverse(), suggestions: [...input.suggestions].reverse() }), ALL_FLOWS)
    expect(b).toEqual(a)
    expect(a.sources[0].id).toBe('zone:zw')
  })
})

describe('buildSankey filling the map box', () => {
  const demo = () => buildMatrix(demoInput())
  const bottom = (layout: SankeyLayout) => Math.max(...[...layout.sources, ...layout.targets].map(n => n.y + Math.max(n.height, MIN_PITCH)))
  const top = (layout: SankeyLayout) => Math.min(...[...layout.sources, ...layout.targets].map(n => n.y))

  it('puts the bars at about 22 % and 78 % of the width, labels outside, and scales the positions with the box', () => {
    const small = buildSankey(demo(), ALL_FLOWS, { width: 1200, height: 700 })
    const large = buildSankey(demo(), ALL_FLOWS, { width: 1600, height: 900 })
    expect(small).toMatchObject({ fill: true, width: 1200, leftX: 252, rightX: 936 })
    expect(large).toMatchObject({ fill: true, width: 1600, leftX: 340, rightX: 1248 })
    // The nodes span the height under the headings: the tallest column from the top to the bottom.
    expect(small.height).toBe(700 - HEAD - FOOT)
    expect(large.height).toBe(900 - HEAD - FOOT)
    expect(bottom(large)).toBeGreaterThan(bottom(small))
    expect(bottom(small)).toBeLessThanOrEqual(small.height)
    expect(bottom(small) - top(small)).toBeGreaterThan(small.height * 0.9)
  })

  it('widens the ribbons with the height, within MIN_W and MAX_FILL_W, the allowed ones unchanged', () => {
    const compact = buildSankey(demo(), ALL_FLOWS)
    const tall = buildSankey(demo(), ALL_FLOWS, { width: 1400, height: 1400 })
    const widest = (layout: SankeyLayout) => Math.max(...layout.ribbons.map(r => r.width))
    expect(widest(compact)).toBe(MAX_W)
    expect(widest(tall)).toBeGreaterThan(MAX_W)
    for (const r of tall.ribbons) {
      expect(r.width).toBeGreaterThanOrEqual(MIN_W)
      expect(r.width).toBeLessThanOrEqual(MAX_FILL_W)
      if (!r.hits) expect(r.width).toBe(ALLOWED_W)
    }
    // A huge box: the ribbons stop at MAX_FILL_W, the columns are centred in what is left.
    const huge = buildSankey(demo(), ALL_FLOWS, { width: 2000, height: 6000 })
    expect(widest(huge)).toBeLessThanOrEqual(MAX_FILL_W)
    expect(top(huge)).toBeGreaterThan(0)
  })

  it('keeps the label room on a narrow box, and the compact drawing under 720 px or without a size', () => {
    const narrow = buildSankey(demo(), ALL_FLOWS, { width: 800, height: 600 })
    expect(narrow.leftX).toBe(LABEL_W)
    expect(narrow.rightX).toBe(800 - LABEL_W - BAR_W)
    const compact = buildSankey(demo(), ALL_FLOWS)
    expect(buildSankey(demo(), ALL_FLOWS, { width: 700, height: 900 })).toEqual(compact)
    expect(buildSankey(demo(), ALL_FLOWS, null)).toEqual(compact)
    expect(compact).toMatchObject({ fill: false, width: COMPACT_W })
  })

  it('keeps the least gaps (and scrolls) when the box is too short for the nodes', () => {
    const short = buildSankey(demo(), ALL_FLOWS, { width: 1200, height: 120 })
    expect(Math.max(...short.ribbons.map(r => r.width))).toBe(MAX_W)
    expect(short.height).toBeGreaterThan(120 - HEAD - FOOT)
    expect(short.sources[1].y - short.sources[0].y - Math.max(short.sources[0].height, MIN_PITCH)).toBeCloseTo(NODE_GAP, 0)
  })
})
