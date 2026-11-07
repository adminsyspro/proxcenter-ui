/**
 * loadSudoRules: the rules of the sudoers template and of the Test SSH check,
 * with the sFlow configure rule pinned to the collector Network Flows saved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const orchestratorFetch = vi.fn()
const readDesiredSFlowConfig = vi.fn()

vi.mock('@/lib/orchestrator', () => ({ orchestratorFetch: (...a: unknown[]) => orchestratorFetch(...a) }))
vi.mock('@/lib/sflow/reconciler', () => ({ readDesiredSFlowConfig: (...a: unknown[]) => readDesiredSFlowConfig(...a) }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-a' }))

import { loadSudoRules } from './loadSudoRules'

const ORCH_RULE = { id: 'apt-update', profile: 'node-ops', path: '/usr/bin/apt-get', args: '^update -qq$', usedBy: 'Node upgrade', example: 'update -qq' }
const sflowRule = (rules: { id: string }[]) => rules.find(r => r.id === 'ui-sflow-configure') as any

describe('loadSudoRules', () => {
  beforeEach(() => {
    orchestratorFetch.mockReset().mockResolvedValue({ rules: [ORCH_RULE] })
    readDesiredSFlowConfig.mockReset().mockResolvedValue(null)
  })

  it('merges the orchestrator rules and leaves sFlow open without a saved collector', async () => {
    const loaded = await loadSudoRules()

    expect(loaded.orchestratorAvailable).toBe(true)
    expect(loaded.rules[0]).toEqual(ORCH_RULE)
    expect(loaded.sflowCollector).toBeNull()
    expect(sflowRule(loaded.rules).sensitive).toBe(true)
  })

  it('pins the sFlow rule to the collector the tenant saved', async () => {
    readDesiredSFlowConfig.mockResolvedValue({ collectorTarget: '10.42.0.2:6343', samplingRate: 512, pollingInterval: 30 })
    const loaded = await loadSudoRules()

    expect(readDesiredSFlowConfig).toHaveBeenCalledWith('tenant-a')
    expect(loaded.sflowCollector).toBe('10.42.0.2:6343')
    expect(sflowRule(loaded.rules).args).toContain('target="10\\.42\\.0\\.2:6343"')
    expect(sflowRule(loaded.rules).sensitive).toBe(false)
  })

  it('keeps the rule open when the saved collector is unusable or cannot be read', async () => {
    readDesiredSFlowConfig.mockResolvedValue({ collectorTarget: 'x"; id', samplingRate: 512, pollingInterval: 30 })
    expect((await loadSudoRules()).sflowCollector).toBeNull()

    readDesiredSFlowConfig.mockRejectedValue(new Error('db down'))
    const loaded = await loadSudoRules()

    expect(loaded.sflowCollector).toBeNull()
    expect(sflowRule(loaded.rules).sensitive).toBe(true)
  })

  it('falls back to the frontend rules, still pinned, without the orchestrator', async () => {
    orchestratorFetch.mockRejectedValue(Object.assign(new Error('down'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    readDesiredSFlowConfig.mockResolvedValue({ collectorTarget: '10.42.0.2:6343', samplingRate: 512, pollingInterval: 30 })
    const loaded = await loadSudoRules()

    expect(loaded.orchestratorAvailable).toBe(false)
    expect(loaded.rules.some(r => r.id === 'apt-update')).toBe(false)
    expect(loaded.sflowCollector).toBe('10.42.0.2:6343')
  })
})
