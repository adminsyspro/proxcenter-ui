import { describe, expect, it } from 'vitest'

import { DENSE_MAX_CELLS_PER_LINE, denseRowMinWidth, denseTagsWidth, problemHosts, fillTone, hostGroups, hostMapMode, hostSummary, osdCell, osdIssues } from './hostMap'
import type { CephHealthIssue, CephInventory } from './types'

const RATIOS = { nearfull: 0.85, full: 0.95 }

type Osd = CephInventory['osds']['list'][number]

const osd = (id: number, host: string, over: Partial<Osd> = {}): Osd => ({
  id,
  name: `osd.${id}`,
  host,
  status: 'up',
  up: true,
  in: true,
  deviceClass: 'hdd',
  totalBytes: 0,
  usedBytes: 0,
  availBytes: 0,
  usedPct: 50,
  commitLatencyMs: 1,
  applyLatencyMs: 1,
  pgs: 43,
  version: '20.2.4',
  ...over,
})

const hosts = (perHost: number[]) => perHost.map((n, h) => ({ osds: Array.from({ length: n }, (_, i) => osd(h * 10 + i, `node${h}`)) }))

const inventory = (list: Osd[], extra: Partial<CephInventory> = {}) => ({
  osds: { total: list.length, up: list.length, in: list.length, down: 0, out: 0, list },
  monitors: { total: 0, inQuorum: 0, quorumNames: [], list: [] },
  managers: { active: null, standbys: [] },
  mds: { total: 0, list: [] },
  ...extra,
}) as unknown as CephInventory

const chk = (name: string, severity: string, details: string[]): CephHealthIssue => ({ name, severity, summary: name, detail: details.map(message => ({ message })) })

describe('hostMapMode', () => {
  it('stays on cards with 3 hosts of 4 OSDs', () => {
    expect(hostMapMode(hosts([4, 4, 4]))).toBe('cards')
  })

  it('switches to dense as soon as one host carries 5 OSDs', () => {
    expect(hostMapMode(hosts([1, 5, 1]))).toBe('dense')
  })

  it('keeps cards for an empty map', () => {
    expect(hostMapMode([])).toBe('cards')
  })
})

describe('osdCell', () => {
  it('turns the used percentage into a ratio, bounded', () => {
    expect(osdCell(osd(0, 'a', { usedPct: 81.8 }))).toEqual({ fillRatio: 0.818, down: false, out: false, flagged: false })
    expect(osdCell(osd(0, 'a', { usedPct: 140 })).fillRatio).toBe(1)
    expect(osdCell(osd(0, 'a', { usedPct: Number.NaN })).fillRatio).toBe(0)
  })

  it('marks a down, an out and a flagged OSD', () => {
    expect(osdCell(osd(0, 'a', { up: false, in: false }), ['noout'])).toEqual({ fillRatio: 0.5, down: true, out: true, flagged: true })
  })
})

describe('fillTone', () => {
  it('follows the sequential scale and the cluster thresholds', () => {
    expect(fillTone(0.4, RATIOS)).toBe('low')
    expect(fillTone(0.7, RATIOS)).toBe('mid')
    expect(fillTone(0.85, RATIOS)).toBe('nearfull')
    expect(fillTone(0.95, RATIOS)).toBe('full')
  })

  it('reads the thresholds it is given', () => {
    expect(fillTone(0.8, { nearfull: 0.75, full: 0.9 })).toBe('nearfull')
  })
})

describe('hostGroups', () => {
  it('groups OSDs by host in natural order, OSDs by id', () => {
    const groups = hostGroups(inventory([osd(10, 'pve10'), osd(2, 'pve2'), osd(1, 'pve2'), osd(0, 'pve1')]))

    expect(groups.map(g => g.name)).toEqual(['pve1', 'pve2', 'pve10'])
    expect(groups[1].osds.map(o => o.id)).toEqual([1, 2])
  })

  it('names the services each host runs', () => {
    const groups = hostGroups(inventory([osd(0, 'pve1'), osd(1, 'pve2')], {
      monitors: {
        total: 2, inQuorum: 1, quorumNames: ['pve1'], list: [
          { name: 'pve1', host: 'pve1', addr: '', inQuorum: true, leader: true, storeStats: null },
          { name: 'pve2', host: 'pve2', addr: '', inQuorum: false, leader: false, storeStats: null },
        ],
      },
      managers: { active: { name: 'pve1', host: 'pve1' }, standbys: [{ name: 'pve2', host: 'pve2' }] },
      mds: { total: 1, list: [{ name: 'a', host: 'pve2', addr: '', state: 'up:active' }] },
    }))

    expect(groups[0]).toMatchObject({ mon: { leader: true, inQuorum: true }, mgr: 'active', mds: 0 })
    expect(groups[1]).toMatchObject({ mon: { leader: false, inQuorum: false }, mgr: 'standby', mds: 1 })
  })
})

describe('hostSummary', () => {
  it('puts a down OSD first, then the fullest one', () => {
    expect(hostSummary([osd(0, 'a', { up: false }), osd(1, 'a', { usedPct: 96 })], RATIOS)).toMatchObject({ tone: 'down', down: 1 })
    expect(hostSummary([osd(0, 'a', { usedPct: 60 }), osd(1, 'a', { usedPct: 96 })], RATIOS)).toMatchObject({ tone: 'full', max: 0.96 })
    expect(hostSummary([osd(0, 'a', { usedPct: 60 }), osd(1, 'a', { usedPct: 88 })], RATIOS)).toMatchObject({ tone: 'nearfull' })
    expect(hostSummary([osd(0, 'a', { usedPct: 60 }), osd(1, 'a', { usedPct: 80 })], RATIOS)).toMatchObject({ tone: 'ok', avg: 0.7 })
  })

  it('leaves down OSDs out of the average fill', () => {
    expect(hostSummary([osd(0, 'a', { up: false, usedPct: 0 }), osd(1, 'a', { usedPct: 80 })], RATIOS).avg).toBe(0.8)
  })
})

describe('osdIssues', () => {
  it('maps OSD checks to the OSDs they cite, worst first', () => {
    const issues = osdIssues([
      chk('OSD_NEARFULL', 'HEALTH_WARN', ['osd.1 is near full']),
      chk('PG_DAMAGED', 'HEALTH_ERR', ['pg 2.1f is active+clean+inconsistent, acting [1,0,2]']),
      chk('SLOW_OPS', 'HEALTH_WARN', ['slow ops, oldest one blocked for 31 sec, daemons [osd.2] have slow ops.']),
    ])

    expect(issues.get(1)).toEqual([{ code: 'PG_DAMAGED', severity: 'error' }, { code: 'OSD_NEARFULL', severity: 'warning' }])
    expect(issues.get(2)).toEqual([{ code: 'SLOW_OPS', severity: 'warning' }])
  })

  // The lab's AUTH_INSECURE_SERVICE_KEY_TYPE lists "entity osd.0 using insecure key type": not a disk problem.
  it('ignores checks that only name an OSD as an auth entity', () => {
    expect(osdIssues([chk('AUTH_INSECURE_SERVICE_KEY_TYPE', 'HEALTH_ERR', ['entity osd.0 using insecure key type: aes'])]).size).toBe(0)
  })
})

describe('denseRowMinWidth', () => {
  const rows = (n: number, per: number) => Array.from({ length: n }, (_, h) => ({ name: `node-${h}`, osds: Array.from({ length: per }, () => ({})) }))

  it('grows with the squares of the row and the name, from content', () => {
    expect(denseRowMinWidth(rows(2, 12))).toBeGreaterThan(denseRowMinWidth(rows(2, 8)))
    expect(denseRowMinWidth([{ name: 'a-much-longer-host-name', osds: [{}] }])).toBeGreaterThan(denseRowMinWidth([{ name: 'n', osds: [{}] }]))
  })

  it('60 hosts of 8 OSDs fit 3 or more columns in 1500 px, 24 hosts of 12 fit 3', () => {
    expect(Math.floor((1500 + 24) / (denseRowMinWidth(rows(60, 8)) + 24))).toBeGreaterThanOrEqual(3)
    expect(Math.floor((1500 + 24) / (denseRowMinWidth(rows(24, 12)) + 24))).toBeGreaterThanOrEqual(3)
  })

  it('a host with 24 OSDs does not widen the row past the cap: its squares wrap', () => {
    expect(denseRowMinWidth(rows(1, 24))).toBe(denseRowMinWidth(rows(1, DENSE_MAX_CELLS_PER_LINE)))
  })
})

describe('problemHosts', () => {
  it('keeps hosts with an OSD down, out, past nearfull or cited by a check', () => {
    const inv = inventory([
      osd(0, 'a'), osd(1, 'b', { up: false }), osd(2, 'c', { in: false }), osd(3, 'd', { usedPct: 90 }), osd(4, 'e'), osd(5, 'f'),
    ])
    const groups = hostGroups(inv)
    const ctx = { ratios: RATIOS, issues: new Map([[5, [{ code: 'OSD_SCRUB_ERRORS' }]]]) }

    expect(problemHosts(groups, ctx).map(h => h.name)).toEqual(['b', 'c', 'd', 'f'])
  })
})

describe('dense row width counts the role tags', () => {
  const bare = { name: 'pve3-dr', osds: [{}] }
  // Per tag: characters * 6.8 + 18 padding + 6 gap.
  const tag = (chars: number) => chars * 6.8 + 18 + 6

  it('adds the exact width of each tag present', () => {
    expect(denseTagsWidth(bare)).toBe(0)
    expect(denseTagsWidth({ ...bare, mon: { leader: false } })).toBeCloseTo(tag(3))
    expect(denseTagsWidth({ ...bare, mon: { leader: true } })).toBeCloseTo(tag(5))
    expect(denseTagsWidth({ ...bare, mgr: 'standby' })).toBeCloseTo(tag(3))
    expect(denseTagsWidth({ ...bare, mgr: 'active' })).toBeCloseTo(tag(10))
    expect(denseTagsWidth({ ...bare, mds: 2 })).toBeCloseTo(tag(3))
    expect(denseTagsWidth({ ...bare, mds: 0 })).toBe(0)
    expect(denseTagsWidth({ ...bare, mon: { leader: true }, mgr: 'active', mds: 1 })).toBeCloseTo(tag(5) + tag(10) + tag(3))
  })

  it('a flag tag counts its name plus 3 characters for the icon and gap', () => {
    expect(denseTagsWidth(bare, ['noout'])).toBeCloseTo(tag(8))
  })

  it('the row width follows the tags and the flags', () => {
    const tagged = { ...bare, mon: { leader: true }, mgr: 'active' as const }

    expect(denseRowMinWidth([tagged]) - denseRowMinWidth([bare])).toBeCloseTo(tag(5) + tag(10))
    expect(denseRowMinWidth([bare], () => ['noout']) - denseRowMinWidth([bare])).toBeCloseTo(tag(8))
  })
})
