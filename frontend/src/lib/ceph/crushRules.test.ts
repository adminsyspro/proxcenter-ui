import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCrushMap, poolTolerance, ruleFailureDomain, type CrushRule, type CrushStep } from './crushRules'

const rule = (steps: CrushStep[], type: CrushRule['type'] = 'replicated'): CrushRule => ({ id: 9, name: 'r', type, steps })
const take = (item = 'default', deviceClass?: string): CrushStep => ({ op: 'take', item, deviceClass })
const choose = (op: string, num: number, type: string): CrushStep => ({ op, num, type })
const emit: CrushStep = { op: 'emit' }

const load = (name: string) => parseCrushMap(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'))

describe('parseCrushMap', () => {
  const map = load('crushmap-3hosts.txt')

  it('reads types, buckets and OSD devices, ignoring comments and shadow ids', () => {
    expect(map.types).toContain('datacenter')
    const hosts = map.buckets.filter(b => b.type === 'host')
    expect(hosts.map(h => h.name)).toEqual(['pve1', 'pve2', 'pve3'])
    expect(hosts.every(h => h.id < 0 && h.children.length === 1)).toBe(true)
    const osds = map.buckets.filter(b => b.type === 'osd')
    expect(osds).toHaveLength(3)
    expect(osds[0]).toMatchObject({ id: 0, name: 'osd.0', deviceClass: 'hdd' })
    const root = map.buckets.find(b => b.name === 'default')!
    expect(root.id).toBe(-1)
    expect(root.children).toEqual(hosts.map(h => h.id))
  })

  it('reads rules and their steps', () => {
    expect(map.rules).toHaveLength(1)
    const rule = map.rules[0]
    expect(rule).toMatchObject({ id: 0, name: 'replicated_rule', type: 'replicated' })
    expect(rule.steps.map(s => s.op)).toEqual(['take', 'chooseleaf_firstn', 'emit'])
    expect(rule.steps[1]).toMatchObject({ num: 0, type: 'host' })
  })

  it('reads the device class of a take step', () => {
    const rule = load('crushmap-ssd.txt').rules[0]
    expect(rule.steps[0]).toMatchObject({ op: 'take', item: 'default', deviceClass: 'ssd' })
  })
})

describe('ruleFailureDomain', () => {
  it('uses the type of the first choose step', () => {
    expect(ruleFailureDomain(load('crushmap-3hosts.txt').rules[0])).toEqual({ domain: 'host', perDomain: 1, deviceClass: null })
  })

  it('handles a stretch rule', () => {
    expect(ruleFailureDomain(load('crushmap-stretch.txt').rules[0])).toEqual({ domain: 'datacenter', perDomain: 2, deviceClass: null })
  })

  it('reads the class and defaults to osd without choose', () => {
    expect(ruleFailureDomain(load('crushmap-ssd.txt').rules[0]).deviceClass).toBe('ssd')
    expect(ruleFailureDomain({ steps: [{ op: 'take', item: 'default' }, { op: 'emit' }] }).domain).toBe('osd')
  })
})

describe('poolTolerance', () => {
  it('tolerates one host loss with 3 replicas on 3 hosts', () => {
    const m = load('crushmap-3hosts.txt')
    expect(poolTolerance({ size: 3, minSize: 2 }, m.rules[0], m.buckets)).toEqual({
      level: 'tolerates', tolerated: 1, domain: 'host', domains: 3, needed: 3,
    })
  })

  it('is insufficient with 2 hosts', () => {
    const m = load('crushmap-2hosts.txt')
    const t = poolTolerance({ size: 3, minSize: 2 }, m.rules[0], m.buckets)
    expect(t.level).toBe('insufficient')
    expect(t.domains).toBe(2)
  })

  it('blocks I/O on the first loss when size equals min_size', () => {
    const m = load('crushmap-3hosts.txt')
    const t = poolTolerance({ size: 2, minSize: 2 }, m.rules[0], m.buckets)
    expect(t.level).toBe('blocks')
    expect(t.tolerated).toBe(0)
  })

  it('tolerates one datacenter loss on a stretch cluster', () => {
    const m = load('crushmap-stretch.txt')
    expect(poolTolerance({ size: 4, minSize: 2 }, m.rules[0], m.buckets)).toEqual({
      level: 'tolerates', tolerated: 1, domain: 'datacenter', domains: 2, needed: 2,
    })
  })

  it('only counts domains holding an OSD of the rule class', () => {
    const m = load('crushmap-ssd.txt')
    const t = poolTolerance({ size: 3, minSize: 2 }, m.rules[0], m.buckets)
    expect(t.domains).toBe(1)
    expect(t.level).toBe('insufficient')
  })

  it('blocks for EC 2+1 with min_size 3', () => {
    const m = load('crushmap-ec21.txt')
    expect(poolTolerance({ size: 3, minSize: 3 }, m.rules[0], m.buckets).level).toBe('blocks')
  })

  it('tolerates one loss for EC 4+2 with min_size 5', () => {
    const m = load('crushmap-ec42.txt')
    const t = poolTolerance({ size: 6, minSize: 5 }, m.rules[0], m.buckets)
    expect(t.level).toBe('tolerates')
    expect(t.tolerated).toBe(1)
  })

  it('multiplies the numbers of the steps after the first choose', () => {
    const m = load('crushmap-stretch.txt')
    const r = rule([take(), choose('choose_firstn', 2, 'datacenter'), choose('chooseleaf_firstn', 2, 'host'), emit])
    expect(ruleFailureDomain(r, 4)).toEqual({ domain: 'datacenter', perDomain: 2, deviceClass: null })
    expect(poolTolerance({ size: 4, minSize: 2 }, r, m.buckets)).toEqual({
      level: 'tolerates', tolerated: 1, domain: 'datacenter', domains: 2, needed: 2,
    })
  })

  it('blocks for EC 4+2 spread as 2 chunks per host on 3 hosts', () => {
    const m = load('crushmap-3hosts.txt')
    const r = rule([take(), choose('choose_indep', 0, 'host'), choose('choose_indep', 2, 'osd'), emit], 'erasure')
    expect(ruleFailureDomain(r, 6).perDomain).toBe(2)
    const t = poolTolerance({ size: 6, minSize: 5 }, r, m.buckets)
    expect(t).toMatchObject({ level: 'blocks', tolerated: 0, domain: 'host', domains: 3, needed: 3 })
  })

  it('resolves a negative num against the pool size', () => {
    const r = rule([take(), choose('choose_firstn', 0, 'datacenter'), choose('chooseleaf_firstn', -1, 'host'), emit])
    expect(ruleFailureDomain(r, 3).perDomain).toBe(2)
  })

  it('bounds perDomain to the pool size', () => {
    const r = rule([take(), choose('choose_firstn', 0, 'datacenter'), choose('chooseleaf_firstn', 5, 'host'), emit])
    expect(ruleFailureDomain(r, 3).perDomain).toBe(3)
  })

  it('counts a terminal chooseleaf of a two-step rule', () => {
    const r = rule([take(), choose('choose_firstn', 0, 'rack'), choose('chooseleaf_firstn', 0, 'host'), emit])
    expect(ruleFailureDomain(r, 4).perDomain).toBe(4)
    expect(ruleFailureDomain(r).perDomain).toBe(1)
  })

  it('counts the domains under the taken bucket only', () => {
    const m = load('crushmap-tworoots.txt')
    const def = m.rules.find(r => r.name === 'replicated_rule')!
    const ssd = m.rules.find(r => r.name === 'ssd_rule')!
    expect(poolTolerance({ size: 2, minSize: 1 }, ssd, m.buckets).domains).toBe(2)
    expect(poolTolerance({ size: 3, minSize: 2 }, def, m.buckets).domains).toBe(3)
  })

  it('returns unknown for forms it does not model', () => {
    const m = load('crushmap-3hosts.txt')
    const pool = { size: 3, minSize: 2 }
    const chooseleaf = choose('chooseleaf_firstn', 0, 'host')
    const forms: CrushStep[][] = [
      [take(), chooseleaf, emit, take(), chooseleaf, emit],
      [take(), { op: 'choosemsr', num: 0, type: 'host' }, emit],
      [take(), { op: 'chooseleafmsr', num: 0, type: 'host' }, emit],
      [chooseleaf, emit],
      [take(), chooseleaf],
      [take('nope'), chooseleaf, emit],
    ]
    for (const steps of forms) {
      expect(poolTolerance(pool, rule(steps), m.buckets).level).toBe('unknown')
    }
  })

  it('ignores set_* tuning steps', () => {
    const m = load('crushmap-3hosts.txt')
    const r = rule([{ op: 'set_chooseleaf_tries', num: 5 }, take(), choose('chooseleaf_indep', 0, 'host'), emit], 'erasure')
    expect(poolTolerance({ size: 3, minSize: 2 }, r, m.buckets).level).toBe('tolerates')
  })
})
