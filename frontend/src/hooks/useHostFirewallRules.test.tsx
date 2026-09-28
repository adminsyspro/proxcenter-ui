/**
 * Coverage for the per-node host rules load: a node whose rules fail to load
 * still gets an empty list, but the failure is reported instead of passing for
 * "0 rules" (#1022). No automatic RTL cleanup is configured in this repo.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FirewallRule } from '@/lib/api/firewall'

vi.mock('@/lib/api/firewall', () => ({
  getNodeRules: vi.fn(),
}))

import * as firewallAPI from '@/lib/api/firewall'

import { useHostFirewallRules } from './useHostFirewallRules'

const getNodeRules = vi.mocked(firewallAPI.getNodeRules)

const rule = (pos: number): FirewallRule => ({ pos, type: 'in', action: 'ACCEPT', enable: 1 })

beforeEach(() => {
  getNodeRules.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useHostFirewallRules', () => {
  it('loads the rules of every node and reports no error', async () => {
    getNodeRules.mockImplementation(async (_conn, node) => (node === 'pve1' ? [rule(0), rule(1)] : []))

    const { result } = renderHook(() => useHostFirewallRules('conn-1', ['pve1', 'pve2']))

    await act(async () => {
      await result.current.loadHostRules()
    })

    expect(result.current.hostRulesByNode).toEqual({ pve1: [rule(0), rule(1)], pve2: [] })
    expect(result.current.hostRulesError).toBeNull()
    expect(result.current.loadingHostRules).toBe(false)
  })

  it('keeps the nodes that loaded and reports the ones that failed, once per cause', async () => {
    getNodeRules.mockImplementation(async (_conn, node) => {
      if (node === 'pve1') return [rule(0)]

      throw new Error('Orchestrator 500: {"error":"failed to parse node rules"}\n')
    })

    const { result } = renderHook(() => useHostFirewallRules('conn-1', ['pve1', 'pve2', 'pve3']))

    await act(async () => {
      await result.current.loadHostRules()
    })

    expect(result.current.hostRulesByNode).toEqual({ pve1: [rule(0)], pve2: [], pve3: [] })
    expect(result.current.hostRulesError).toBe('failed to parse node rules')
  })

  it('treats a non-array answer as no rules', async () => {
    getNodeRules.mockResolvedValue(null as unknown as FirewallRule[])

    const { result } = renderHook(() => useHostFirewallRules('conn-1', ['pve1']))

    await act(async () => {
      await result.current.loadHostRules()
    })

    expect(result.current.hostRulesByNode).toEqual({ pve1: [] })
  })

  it('uses the overrides, and does nothing without a connection or nodes', async () => {
    getNodeRules.mockResolvedValue([rule(0)])

    const { result } = renderHook(() => useHostFirewallRules(null, []))

    await act(async () => {
      await result.current.loadHostRules()
    })

    expect(getNodeRules).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.loadHostRules('conn-2', ['pve9'])
    })

    expect(getNodeRules).toHaveBeenCalledWith('conn-2', 'pve9')
    expect(result.current.hostRulesByNode).toEqual({ pve9: [rule(0)] })
  })

  it('reloads a single node and leaves the others alone', async () => {
    getNodeRules.mockResolvedValue([rule(0)])

    const { result } = renderHook(() => useHostFirewallRules('conn-1', ['pve1', 'pve2']))

    await act(async () => {
      await result.current.loadHostRules()
    })

    getNodeRules.mockResolvedValue([rule(0), rule(1)])
    await act(async () => {
      await result.current.reloadHostRulesForNode('pve2')
    })

    expect(result.current.hostRulesByNode).toEqual({ pve1: [rule(0)], pve2: [rule(0), rule(1)] })

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    getNodeRules.mockRejectedValue(new Error('HTTP 502'))
    await act(async () => {
      await result.current.reloadHostRulesForNode('pve1')
    })

    expect(result.current.hostRulesByNode.pve1).toEqual([rule(0)])
    expect(consoleError).toHaveBeenCalled()
  })

  it('does not reload a node without a connection', async () => {
    const { result } = renderHook(() => useHostFirewallRules(null, ['pve1']))

    await act(async () => {
      await result.current.reloadHostRulesForNode('pve1')
    })

    expect(getNodeRules).not.toHaveBeenCalled()
  })
})
