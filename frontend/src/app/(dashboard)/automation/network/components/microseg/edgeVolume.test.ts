import { describe, expect, it } from 'vitest'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegVolumeBucket } from '@/lib/microseg/types'
import { VOLUME_LEVELS } from '@/lib/microseg/volume'

import { edgeVolumes, volumeEnd, zoneLevelEnd } from './edgeVolume'
import { EXTERNAL_ID, OUTSIDE_ID, UNZONED_ID } from './zoneGraph'

const row = (src: string, dst: string, port: number, bytes: number): MicrosegVolumeBucket => ({ at: 'x', src_zone: src, dst_zone: dst, proto: 'tcp', port, bytes, packets: 1 })
const flow = (src: string, dst: string, dport: string) => ({ src_zone_id: src, src_cidr: '', dst_zone_id: dst, dst_cidr: '', proto: 'tcp', dport } as MicrosegFlow)
const seen = (src: string, dst: string, dport: string) => ({ src_zone_id: src, dst_zone_id: dst, proto: 'tcp', dport } as MicrosegSuggestion)
const edge = (id: string, source: string, target: string, kind: string, flows: MicrosegFlow[], observed: MicrosegSuggestion[] = []) => ({ id, source, target, data: { kind, flows, observed } })
const NAMES: Record<string, string> = { zw: 'web', zd: 'db' }
const zoneName = (id: string) => NAMES[id]

describe('edgeVolumes', () => {
  const ROWS = [row('web', 'db', 5432, 1_000_000), row('web', 'db', 22, 1_000), row('', 'web', 443, 50_000)]

  it('gives each edge between zones the bytes of its flows, and a gauge against the largest edge', () => {
    const volumes = edgeVolumes([
      edge('a', 'zone:zw', 'zone:zd', 'allowed', [flow('zw', 'zd', '5432')]),
      edge('b', 'zone:zw', 'zone:zd', 'blocked', [], [seen('zw', 'zd', '22')]),
      edge('c', EXTERNAL_ID, 'zone:zw', 'unprotected', [], [seen('', 'zw', '443')]),
      edge('d', 'zone:zd', OUTSIDE_ID, 'outside', [flow('zd', '', '53')]),
    ], ROWS, zoneName)
    expect(volumes.get('a')).toEqual({ figure: { bytes: 1_000_000, packets: 1 }, level: VOLUME_LEVELS, shared: false, untold: false, rules: expect.any(Array), pair: null })
    expect(volumes.get('b')!.figure.bytes).toBe(1_000)
    expect(volumes.get('b')!.level).toBeLessThan(VOLUME_LEVELS)
    expect(volumes.get('b')!.level).toBeGreaterThan(0)
    expect(volumes.get('c')!.figure.bytes).toBe(50_000)
    // Measured, nothing carried: zero, and no gauge.
    expect(volumes.get('d')).toEqual({ figure: { bytes: 0, packets: 0 }, level: 0, shared: false, untold: false, rules: [], pair: null })
  })

  it('gives none to an exception or an edge without data', () => {
    const volumes = edgeVolumes([
      edge('x', 'zone:zw', 'zone:zd', 'exception', []),
      { id: 'n', source: 'zone:zw', target: 'zone:zd' },
    ], ROWS, zoneName)
    expect(volumes.size).toBe(0)
  })

  it('gives an edge from a guest in no zone the traffic in no zone it alone draws, the whole pair when several draw it', () => {
    const alone = edgeVolumes([edge('v', `guest:${UNZONED_ID}:qemu/7`, 'guest:zw:qemu/100', 'unprotected', [], [seen('', 'zw', '443')])], ROWS, zoneName)
    expect(alone.get('v')!.figure.bytes).toBe(50_000)
    const both = edgeVolumes([
      edge('v', `guest:${UNZONED_ID}:qemu/7`, 'guest:zw:qemu/100', 'unprotected', [], [seen('', 'zw', '443')]),
      edge('i', 'ip:10.30.0.14', 'guest:zw:qemu/100', 'unprotected', [], [seen('', 'zw', '443')]),
    ], ROWS, zoneName)
    expect(both.get('v')).toMatchObject({ figure: { bytes: 0, packets: 0 }, shared: true, pair: { from: '', to: 'web', figure: { bytes: 50_000, packets: 1 } } })
    expect(both.get('i')!.shared).toBe(true)
  })

  it('shows each byte on one edge: the allowed edge that covers it, else the one observed edge drawing it, else none', () => {
    const alone = edgeVolumes([edge('g', 'guest:zw:qemu/100', 'guest:zd:qemu/200', 'blocked', [], [seen('zw', 'zd', '5432')])], ROWS, zoneName)
    expect(alone.get('g')).toEqual({ figure: { bytes: 1_000_000, packets: 1 }, level: VOLUME_LEVELS, shared: false, untold: false, rules: expect.any(Array), pair: null })
    const many = edgeVolumes([
      // web -> db tcp/22 on two observed edges: shown on neither.
      edge('g1', 'guest:zw:qemu/100', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432'), seen('zw', 'zd', '22')]),
      edge('g2', 'guest:zw:qemu/101', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '22')]),
      // web -> db tcp/5432 allowed (in the draft) and observed: shown on the allowed edge.
      edge('a', 'zone:zw', 'zone:zd', 'allowed', [flow('zw', 'zd', '5432')]),
    ], ROWS, zoneName)
    expect(many.get('a')!.rules).toEqual([{ src: 'web', dst: 'db', proto: 'tcp', dport: '5432' }])
    expect(many.get('a')).toEqual({ figure: { bytes: 1_000_000, packets: 1 }, level: VOLUME_LEVELS, shared: false, untold: false, rules: expect.any(Array), pair: null })
    // A shared edge has the volume of its whole pair of zones beside its own: the figure of the panel of the pair.
    const whole = { from: 'web', to: 'db', figure: { bytes: 1_001_000, packets: 2 } }
    expect(many.get('g1')).toEqual({ figure: { bytes: 0, packets: 0 }, level: 0, shared: true, untold: false, rules: [], pair: whole })
    expect(many.get('g2')).toEqual({ figure: { bytes: 0, packets: 0 }, level: 0, shared: true, untold: false, rules: [], pair: whole })
    const sum = [...many.values()].reduce((n, v) => n + v.figure.bytes, 0)
    expect(sum).toBeLessThanOrEqual(ROWS.filter(r => r.src_zone === 'web').reduce((n, r) => n + r.bytes, 0))
  })

  it('tells the ends the volume can be told for', () => {
    expect(zoneLevelEnd('zone:zw')).toBe(true)
    expect(zoneLevelEnd(EXTERNAL_ID)).toBe(true)
    expect(zoneLevelEnd(OUTSIDE_ID)).toBe(true)
    expect(zoneLevelEnd(UNZONED_ID)).toBe(false)
    expect(zoneLevelEnd('guest:zw:qemu/100')).toBe(false)
    expect(volumeEnd('guest:zw:qemu/100')).toBe(true)
    expect(volumeEnd('more:zw')).toBe(true)
    expect(volumeEnd(EXTERNAL_ID)).toBe(true)
    expect(volumeEnd(`guest:${UNZONED_ID}:qemu/7`)).toBe(true)
    expect(volumeEnd(`more:${UNZONED_ID}`)).toBe(true)
    expect(volumeEnd(UNZONED_ID)).toBe(true)
    expect(volumeEnd('ip:10.0.0.9')).toBe(true)
    expect(volumeEnd('pve:c1:pve1')).toBe(false)
  })

  describe('by pair of guests', () => {
    const guestRow = (src: number, dst: number, port: number, bytes: number, zones: [string, string] = ['web', 'db']) =>
      ({ ...row(zones[0], zones[1], port, bytes), src_vmid: src, dst_vmid: dst, conn: 'c1' })
    const refs: Record<string, { conn: string; vmid: number }> = { 'qemu/100': { conn: 'c1', vmid: 100 }, 'qemu/101': { conn: 'c1', vmid: 101 }, 'qemu/200': { conn: 'c1', vmid: 200 }, 'qemu/7': { conn: 'c1', vmid: 7 } }
    const of = (nodeId: string) => (nodeId.startsWith('guest:') ? refs[nodeId.slice(nodeId.lastIndexOf(':') + 1)] : undefined)
    const ZONES = [row('web', 'db', 5432, 3_500), row('', 'web', 443, 900)]

    it('gives each edge its own pair of guests, the zone edge what no drawn pair carries, nothing counted twice', () => {
      const rows = [guestRow(100, 200, 5432, 1_000), guestRow(101, 200, 5432, 2_000), guestRow(102, 200, 5432, 400)]
      const volumes = edgeVolumes([
        edge('g1', 'guest:zw:qemu/100', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432')]),
        edge('g2', 'guest:zw:qemu/101', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432')]),
        // The circle of web: the sources no edge is drawn from (the guest 102).
        edge('z', 'zone:zw', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432')]),
      ], ZONES, zoneName, { rows, of })
      expect(volumes.get('g1')).toMatchObject({ figure: { bytes: 1_000, packets: 1 }, shared: false, pair: null, guest: { conn: 'c1', src: 100, dst: 200 } })
      expect(volumes.get('g2')).toMatchObject({ figure: { bytes: 2_000, packets: 1 }, guest: { conn: 'c1', src: 101, dst: 200 } })
      expect(volumes.get('z')).toMatchObject({ figure: { bytes: 400, packets: 1 }, guest: { conn: 'c1', dst: 200 } })
      // 100 of the 3 500 between the zones are told by no pair: under 5 %, the gap of the two reads, not traffic.
      expect([...volumes.values()].reduce((n, v) => n + v.figure.bytes, 0)).toBe(3_400)
    })

    it('says an edge shares the traffic of its zones that no pair of guests tells (counted before they were kept)', () => {
      const volumes = edgeVolumes([
        edge('g1', 'guest:zw:qemu/100', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432')]),
        edge('z', 'zone:zw', 'zone:zd', 'blocked', [], [seen('zw', 'zd', '5432')]),
      ], ZONES, zoneName, { rows: [guestRow(100, 200, 5432, 1_000)], of })
      // Shared with what no guest is named for, not with another edge.
      expect(volumes.get('g1')).toMatchObject({ figure: { bytes: 1_000, packets: 1 }, shared: true, untold: true, pair: { from: 'web', to: 'db', figure: { bytes: 3_500, packets: 1 } } })
      // The edge between the zones counts what no pair tells.
      expect(volumes.get('z')!.figure.bytes).toBe(2_500)
    })

    it('keeps the traffic an allowed flow covers on the allowed edge, and a guest of another cluster apart', () => {
      const rows = [guestRow(100, 200, 5432, 1_000), { ...guestRow(100, 200, 5432, 700), conn: 'c2' }]
      const volumes = edgeVolumes([
        edge('a', 'zone:zw', 'zone:zd', 'allowed', [flow('zw', 'zd', '5432')]),
        edge('g1', 'guest:zw:qemu/100', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432')]),
      ], ZONES, zoneName, { rows, of })
      // The allowed edge counts the pairs of both clusters and what no pair tells: all the 3 500.
      expect(volumes.get('a')!.figure.bytes).toBe(3_500)
      expect(volumes.get('g1')).toMatchObject({ figure: { bytes: 0, packets: 0 }, shared: true, untold: false })
      // Without the allowed flow, the guest edge counts its cluster's pair only (VMID 100 of c2 is another guest).
      const alone = edgeVolumes([edge('g1', 'guest:zw:qemu/100', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432')])], ZONES, zoneName, { rows, of })
      expect(alone.get('g1')!.figure.bytes).toBe(1_000)
    })

    it('tells a guest in no zone from the other sources in no zone, and two edges as close share a row', () => {
      const rows = [guestRow(7, 100, 443, 600, ['', 'web']), guestRow(0, 100, 443, 300, ['', 'web'])]
      const volumes = edgeVolumes([
        edge('job', `guest:${UNZONED_ID}:qemu/7`, 'guest:zw:qemu/100', 'unprotected', [], [seen('', 'zw', '443')]),
        edge('ext', EXTERNAL_ID, 'guest:zw:qemu/100', 'unprotected', [], [seen('', 'zw', '443')]),
        edge('ip', 'ip:10.30.0.14', 'guest:zw:qemu/100', 'unprotected', [], [seen('', 'zw', '443')]),
      ], ZONES, zoneName, { rows, of })
      expect(volumes.get('job')).toMatchObject({ figure: { bytes: 600, packets: 1 }, shared: false })
      // The source that is no guest is drawn from External and from an address: on neither.
      expect(volumes.get('ext')).toMatchObject({ figure: { bytes: 0, packets: 0 }, shared: true })
      expect(volumes.get('ip')!.shared).toBe(true)
    })

    it('carries the samples of what an edge shows, those the pairs of guests leave to the zones too', () => {
      const zones = [{ ...row('web', 'db', 5432, 3_500), samples: 9 }]
      const volumes = edgeVolumes([
        edge('g1', 'guest:zw:qemu/100', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432')]),
        edge('z', 'zone:zw', 'zone:zd', 'blocked', [], [seen('zw', 'zd', '5432')]),
      ], zones, zoneName, { rows: [{ ...guestRow(100, 200, 5432, 1_000), samples: 2 }], of })
      expect(volumes.get('g1')!.figure).toEqual({ bytes: 1_000, packets: 1, samples: 2 })
      expect(volumes.get('z')!.figure).toEqual({ bytes: 2_500, packets: 0, samples: 7 })
    })

    it('tells the edges by their zones when no pair of guests is kept', () => {
      const volumes = edgeVolumes([edge('g1', 'guest:zw:qemu/100', 'guest:zd:qemu/200', 'unprotected', [], [seen('zw', 'zd', '5432')])], ZONES, zoneName, { rows: [], of })
      expect(volumes.get('g1')).toMatchObject({ figure: { bytes: 3_500, packets: 1 }, shared: false })
      expect(volumes.get('g1')!.guest).toBeUndefined()
    })
  })
})
