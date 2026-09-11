import { describe, expect, it } from 'vitest'

import { familyScope } from '../prometheus'
import { FAMILY_REGISTRY, REGISTERED_NAMES, family } from './registry'

describe('family registry', () => {
  it('declares every family exactly once', () => {
    expect(new Set(REGISTERED_NAMES).size).toBe(REGISTERED_NAMES.length)
    expect(FAMILY_REGISTRY).toHaveLength(30)
  })

  it('uses only Prometheus-legal names under the proxcenter namespace', () => {
    for (const entry of FAMILY_REGISTRY) {
      expect(entry.name).toMatch(/^proxcenter_[a-z_]+$/)
    }
  })

  it('carries a real English help string for every family', () => {
    for (const entry of FAMILY_REGISTRY) {
      expect(entry.help.length).toBeGreaterThan(10)
      expect(entry.help).not.toMatch(/TODO|TBD/)
    }
  })

  /**
   * The registry does not get to disagree with the prefix table: the prefix
   * table is what the handler enforces per request, so a registry claiming a
   * different scope would describe a filter nobody applies.
   */
  it('agrees with the prefix table the handler actually enforces', () => {
    for (const entry of FAMILY_REGISTRY) {
      expect(familyScope(entry.name)).toBe(entry.scope)
    }
  })

  it('spans exactly the three read scopes plus the unscoped case', () => {
    expect(new Set(FAMILY_REGISTRY.map(entry => entry.scope)))
      .toEqual(new Set(['nodes:read', 'vms:read', 'backups:read', null]))
  })

  it('exposes exactly one unscoped family, the build info', () => {
    expect(FAMILY_REGISTRY.filter(entry => entry.scope === null).map(entry => entry.name))
      .toEqual(['proxcenter_build_info'])
  })

  /**
   * The seven families shipped on 3 August are a published contract: a
   * rename here is a silent break for every customer already scraping.
   */
  it('still declares the seven families shipped on 3 August', () => {
    for (const name of [
      'proxcenter_node_online',
      'proxcenter_node_cpu_usage_ratio',
      'proxcenter_node_mem_usage_ratio',
      'proxcenter_vm_status',
      'proxcenter_vm_cpu_usage_ratio',
      'proxcenter_vm_agent_enabled',
      'proxcenter_backup_age_seconds',
    ]) {
      expect(REGISTERED_NAMES).toContain(name)
    }
  })
})

describe('family()', () => {
  it('takes the help text from the declaration, so it is written once', () => {
    expect(family('proxcenter_pbs_up', [])).toEqual({
      name: 'proxcenter_pbs_up',
      help: 'PBS server reachability (1 online, 0 otherwise)',
      type: 'gauge',
      samples: [],
    })
  })

  /**
   * A typo in a builder must be a loud failure, not a series no dashboard
   * can chart and no scope can filter.
   */
  it('refuses an unregistered name rather than emitting it', () => {
    expect(() => family('proxcenter_typo_here', [])).toThrow('Unregistered metric family: proxcenter_typo_here')
  })
})
