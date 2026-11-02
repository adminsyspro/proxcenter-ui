import { describe, expect, it } from 'vitest'

import { osdOutImpact } from './osdOutImpact'
import {
  flattenGroups, forceForVerdict, groupOsdsByHost, osdDotState, resolvePveNode, needsOsdNameTyping, okToStopVerdict, osdFilterCounts, pageOfOsd, paginateGroups, poolsOnOsd, projectedBefore, toOsdLoad,
} from './osdTable'
import type { CephOsd } from './types'

const GiB = 1024 ** 3
const TiB = 1024 ** 4

const osd = (id: number, host: string, over: Partial<CephOsd> = {}): CephOsd => ({
  id, name: `osd.${id}`, host, status: 'up', up: true, in: true, deviceClass: 'hdd', totalBytes: 0.1 * TiB, usedBytes: 0, availBytes: 0,
  usedPct: 50, commitLatencyMs: 1, applyLatencyMs: 1, reweight: 1, pgs: 10, version: '20.2.4', ...over,
})

// 6 OSD: one down, one out, one past nearfull, three healthy.
const SIX = [
  osd(0, 'pve1'),
  osd(1, 'pve1', { up: false, status: 'down' }),
  osd(2, 'pve2', { in: false }),
  osd(3, 'pve2', { usedPct: 88 }),
  osd(4, 'pve3'),
  osd(5, 'pve3'),
]

describe('osdFilterCounts', () => {
  it('counts all, problem, down and out on 6 OSD', () => {
    expect(osdFilterCounts(SIX)).toEqual({ all: 6, problem: 3, down: 1, out: 1 })
  })

  it('counts an OSD cited by a health check as a problem, and an OSD that is down and out once', () => {
    const list = [osd(0, 'a'), osd(1, 'a', { up: false, in: false })]

    expect(osdFilterCounts(list, { issues: new Map([[0, [{ code: 'OSD_SCRUB_ERRORS' }]]]) })).toEqual({ all: 2, problem: 2, down: 1, out: 1 })
  })

  it('reads nearfull from the ratios it is given', () => {
    expect(osdFilterCounts([osd(0, 'a', { usedPct: 70 })], { ratios: { nearfull: 0.65, full: 0.9 } }).problem).toBe(1)
    expect(osdFilterCounts([osd(0, 'a', { usedPct: 70 })]).problem).toBe(0)
  })
})

describe('groupOsdsByHost', () => {
  it('groups by host in natural order and sorts the OSDs by id', () => {
    const groups = groupOsdsByHost([osd(10, 'pve10'), osd(2, 'pve2'), osd(1, 'pve2')])

    expect(groups.map(g => g.host)).toEqual(['pve2', 'pve10'])
    expect(groups[0].osds.map(o => o.id)).toEqual([1, 2])
  })

  it('filters by quick filter, host, class and search, and drops empty groups', () => {
    const list = [...SIX, osd(6, 'pve3', { deviceClass: 'ssd' })]

    expect(flattenGroups(groupOsdsByHost(list, { filter: 'down' })).map(o => o.id)).toEqual([1])
    expect(flattenGroups(groupOsdsByHost(list, { filter: 'problem' })).map(o => o.id)).toEqual([1, 2, 3])
    expect(groupOsdsByHost(list, { host: 'pve3' }).map(g => g.host)).toEqual(['pve3'])
    expect(flattenGroups(groupOsdsByHost(list, { deviceClass: 'ssd' })).map(o => o.id)).toEqual([6])
    expect(flattenGroups(groupOsdsByHost(list, { search: ' OSD.4 ' })).map(o => o.id)).toEqual([4])
    expect(flattenGroups(groupOsdsByHost(list, { search: 'pve2' })).map(o => o.id)).toEqual([2, 3])
    expect(groupOsdsByHost(list, { search: 'nothing' })).toEqual([])
  })
})

describe('paginateGroups', () => {
  const many = Array.from({ length: 45 }, (_, i) => osd(i, `pve${Math.floor(i / 15) + 1}`))
  const groups = groupOsdsByHost(many)

  it('cuts 20 rows per page across the groups and keeps the group size', () => {
    const p0 = paginateGroups(groups, new Set(), 0)
    const p1 = paginateGroups(groups, new Set(), 1)
    const p2 = paginateGroups(groups, new Set(), 2)

    expect(p0.pageCount).toBe(3)
    expect(p0.shown.map(g => [g.host, g.rows.length, g.osds.length])).toEqual([['pve1', 15, 15], ['pve2', 5, 15]])
    expect(p1.shown.map(g => [g.host, g.rows.length])).toEqual([['pve2', 10], ['pve3', 10]])
    expect(p2.shown.map(g => [g.host, g.rows.length])).toEqual([['pve3', 5]])
  })

  it('clamps the page and counts only the rows of unfolded groups', () => {
    expect(paginateGroups(groups, new Set(), 99).page).toBe(2)

    const folded = paginateGroups(groups, new Set(['pve1']), 0)

    expect(folded.rowCount).toBe(30)
    expect(folded.pageCount).toBe(2)
    expect(folded.shown[0]).toMatchObject({ host: 'pve1', rows: [], folded: true })
    expect(folded.shown[1].rows).toHaveLength(15)
  })

  it('has one empty page when nothing is left', () => {
    expect(paginateGroups([], new Set(), 3)).toMatchObject({ page: 0, pageCount: 1, rowCount: 0, shown: [] })
  })

  it('finds the page of an OSD', () => {
    expect(pageOfOsd(groups, new Set(), 3)).toBe(0)
    expect(pageOfOsd(groups, new Set(), 20)).toBe(1)
    expect(pageOfOsd(groups, new Set(), 44)).toBe(2)
    expect(pageOfOsd(groups, new Set(), 999)).toBe(0)
  })
})

describe('toOsdLoad', () => {
  it('takes the measured size and used bytes when the route has them', () => {
    expect(toOsdLoad(osd(0, 'a', { usedBytes: 30 * GiB, availBytes: 70 * GiB, totalBytes: 0 }))).toMatchObject({ usedBytes: 30 * GiB, totalBytes: 100 * GiB })
  })

  it('rebuilds used bytes from the fill when kb_used is not reported (zero bytes)', () => {
    const load = toOsdLoad(osd(0, 'a', { usedPct: 80, totalBytes: 100 * GiB }))

    expect(load.totalBytes).toBe(100 * GiB)
    expect(load.usedBytes).toBeCloseTo(80 * GiB)
    expect(load.crushWeight).toBeCloseTo(100 / 1024)
  })

  it('feeds osdOutImpact with real figures on the lab shape', () => {
    const list = [osd(0, 'a', { usedPct: 81 }), osd(1, 'b', { usedPct: 82 }), osd(2, 'c', { usedPct: 79 })]
    const impact = osdOutImpact(list.map(toOsdLoad), 1, { nearfull: 0.85, full: 0.95 })

    expect(impact.movedBytes).toBeGreaterThan(0)
    expect(impact.overNearfull).toBe(true)
    expect(projectedBefore(list, impact)).toBeGreaterThan(0.78)
  })
})

describe('poolsOnOsd', () => {
  const inv = {
    pools: { total: 2, list: [{ name: 'fast', crushRule: 1, crushRootId: -1 }, { name: 'bulk', crushRule: 0, crushRootId: -1 }] },
    crushTree: [{ id: -1, name: 'default', type: 'root', children: [{ id: -2, name: 'pve1', type: 'host', children: [{ id: 0, name: 'osd.0', type: 'osd' }] }] }],
    crushRules: [
      { id: 0, name: 'replicated_rule', steps: [{ op: 'take', type: '', num: 0, item: -1, item_name: 'default' }] },
      { id: 1, name: 'ssd_rule', steps: [{ op: 'take', type: '', num: 0, item: -3, item_name: 'default~ssd' }] },
    ],
  } as unknown as Parameters<typeof poolsOnOsd>[0]

  it('lists the pools whose root holds the OSD and whose class matches', () => {
    expect(poolsOnOsd(inv, { id: 0, deviceClass: 'hdd' })).toEqual(['bulk'])
    expect(poolsOnOsd(inv, { id: 0, deviceClass: 'ssd' })).toEqual(['fast', 'bulk'])
    expect(poolsOnOsd(inv, { id: 9, deviceClass: 'hdd' })).toEqual([])
  })
})

describe('okToStopVerdict and needsOsdNameTyping', () => {
  const calm = { overNearfull: false }

  it('tells checking, ok, refused and unknown apart', () => {
    expect(okToStopVerdict(null, true)).toBe('checking')
    expect(okToStopVerdict({ ok: true, message: null })).toBe('ok')
    expect(okToStopVerdict({ ok: false, message: null })).toBe('refused')
    expect(okToStopVerdict(null)).toBe('unknown')
    expect(okToStopVerdict({ ok: false, message: 'ssh failed' })).toBe('unknown')
    expect(okToStopVerdict({ ok: true, message: 'odd' })).toBe('unknown')
  })

  it('asks for the name unless the verdict is ok and the fill stays under nearfull', () => {
    expect(needsOsdNameTyping('ok', calm)).toBe(false)
    expect(needsOsdNameTyping('ok', { overNearfull: true })).toBe(true)
    expect(needsOsdNameTyping('refused', calm)).toBe(true)
    expect(needsOsdNameTyping('unknown', calm)).toBe(true)
    expect(needsOsdNameTyping('checking', calm)).toBe(true)
  })
})

describe('unknown load', () => {
  const R = { nearfull: 0.85, full: 0.95 }
  const typingFor = (target: CephOsd) => {
    const list = [target, osd(10, 'other', { usedPct: 10 }), osd(11, 'other2', { usedPct: 10 })]
    const impact = osdOutImpact(list.map(toOsdLoad), target.id, R)

    return { impact, typing: needsOsdNameTyping('ok', impact) }
  }

  it('OSD sans taille connue -> saisie exigee', () => {
    const { impact, typing } = typingFor(osd(1, 'a', { totalBytes: 0, usedBytes: 0, availBytes: 0, usedPct: 0, pgs: 20 }))

    expect(toOsdLoad(osd(1, 'a', { totalBytes: 0, usedPct: 0 })).loadKnown).toBe(false)
    expect(impact.unknown).toBe(true)
    expect(typing).toBe(true)
  })

  it('OSD down -> saisie exigee, even with an ok verdict', () => {
    const { impact, typing } = typingFor(osd(1, 'a', { up: false, status: 'down', usedPct: 0, pgs: 40 }))

    expect(impact.unknown).toBe(true)
    expect(typing).toBe(true)
  })

  it('no fill reported while the OSD holds PGs is unknown, an empty OSD is a known zero', () => {
    expect(toOsdLoad(osd(1, 'a', { usedPct: 0, pgs: 12 })).loadKnown).toBe(false)
    expect(toOsdLoad(osd(1, 'a', { usedPct: 0, pgs: 0 })).loadKnown).toBe(true)
    expect(typingFor(osd(1, 'a', { usedPct: 40 })).typing).toBe(false)
  })

  it('an OSD that is already out has nothing to estimate', () => {
    expect(typingFor(osd(1, 'a', { in: false, up: false, usedPct: 0 })).typing).toBe(false)
  })

  it('measured bytes win over the fill percentage', () => {
    expect(toOsdLoad(osd(0, 'a', { usedBytes: 30 * GiB, availBytes: 70 * GiB, usedPct: 99 })).usedBytes).toBe(30 * GiB)
  })
})

describe('forceForVerdict', () => {
  it('forces only when the verdict is overridden', () => {
    expect(forceForVerdict('ok')).toBe(false)
    expect(forceForVerdict('refused')).toBe(true)
    expect(forceForVerdict('unknown')).toBe(true)
  })
})

describe('osdDotState', () => {
  const R = { nearfull: 0.85, full: 0.95 }

  it('reads down, full and error checks as error; out, nearfull and warnings as warn', () => {
    expect(osdDotState(osd(0, 'a'), R)).toBe('ok')
    expect(osdDotState(osd(0, 'a', { up: false }), R)).toBe('error')
    expect(osdDotState(osd(0, 'a', { usedPct: 96 }), R)).toBe('error')
    expect(osdDotState(osd(0, 'a'), R, [{ severity: 'error' }])).toBe('error')
    expect(osdDotState(osd(0, 'a', { in: false }), R)).toBe('warn')
    expect(osdDotState(osd(0, 'a', { usedPct: 86 }), R)).toBe('warn')
    expect(osdDotState(osd(0, 'a'), R, [{ severity: 'warning' }])).toBe('warn')
  })
})

describe('resolvePveNode', () => {
  it('maps a FQDN CRUSH host to its node, exact names first', () => {
    expect(resolvePveNode('pve1.example.lan', ['pve1', 'pve2'])).toBe('pve1')
    expect(resolvePveNode('PVE2', ['pve1', 'pve2'])).toBe('pve2')
    expect(resolvePveNode('pve1', ['pve1', 'pve1.x'])).toBe('pve1')
  })

  it('is null without a matching node, with an ambiguous one, or without a node list', () => {
    expect(resolvePveNode('pve9.example.lan', ['pve1', 'pve2'])).toBeNull()
    expect(resolvePveNode('pve1.lan', ['pve1.a', 'pve1.b'])).toBeNull()
    expect(resolvePveNode('pve1', undefined)).toBeNull()
    expect(resolvePveNode('pve1', [])).toBeNull()
  })
})
