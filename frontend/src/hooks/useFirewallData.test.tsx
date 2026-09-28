/**
 * Coverage for the Network Security page's main load. Each failed fetch still
 * degrades to an empty value so the rest of the page loads, but the failure is
 * kept in `loadError` instead of rendering as "firewall OFF, 0 rules" (#1022).
 * No automatic RTL cleanup is configured in this repo.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FirewallRule } from '@/lib/api/firewall'

vi.mock('@/lib/api/firewall', () => ({
  getAliases: vi.fn(),
  getIPSets: vi.fn(),
  getSecurityGroups: vi.fn(),
  getClusterOptions: vi.fn(),
  getClusterRules: vi.fn(),
  getNodeOptions: vi.fn(),
  getNodeRules: vi.fn(),
}))

import * as firewallAPI from '@/lib/api/firewall'

import { useFirewallData } from './useFirewallData'

const api = vi.mocked(firewallAPI)

const rule = (pos: number): FirewallRule => ({ pos, type: 'in', action: 'ACCEPT', enable: 1 })

/** Answer the nodes request with these node names, or with a failed response. */
function mockNodes(nodes: string[] | 'fail' | 'throw') {
  vi.stubGlobal('fetch', vi.fn(async () => {
    if (nodes === 'throw') throw new Error('network down')
    if (nodes === 'fail') return { ok: false, json: async () => ({}) } as Response

    return { ok: true, json: async () => ({ data: nodes.map(node => ({ node })) }) } as Response
  }))
}

beforeEach(() => {
  api.getAliases.mockReset().mockResolvedValue([{ name: 'mgmt', cidr: '10.0.0.0/24' }])
  api.getIPSets.mockReset().mockResolvedValue([{ name: 'management' }])
  api.getSecurityGroups.mockReset().mockResolvedValue([])
  api.getClusterOptions.mockReset().mockResolvedValue({ enable: 1, policy_in: 'DROP' })
  api.getClusterRules.mockReset().mockResolvedValue([rule(0), rule(1)])
  api.getNodeOptions.mockReset().mockResolvedValue({ enable: 1 })
  api.getNodeRules.mockReset().mockResolvedValue([rule(0)])
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useFirewallData', () => {
  it('loads a cluster and reports no error', async () => {
    mockNodes(['pve1', 'pve2'])

    const { result } = renderHook(() => useFirewallData('conn-1', true))

    await waitFor(() => expect(result.current.clusterRules).toHaveLength(2))

    expect(result.current.loadError).toBeNull()
    expect(result.current.firewallMode).toBe('cluster')
    expect(result.current.nodesList).toEqual(['pve1', 'pve2'])
    expect(result.current.clusterOptions).toEqual({ enable: 1, policy_in: 'DROP' })
    expect(result.current.aliases).toHaveLength(1)
    expect(result.current.connectionInfo).toMatchObject({ mode: 'cluster', node_count: 2 })
    expect(api.getNodeOptions).not.toHaveBeenCalled()
  })

  it('keeps what loaded and reports every distinct failure, unwrapped', async () => {
    mockNodes(['pve1', 'pve2'])
    api.getClusterRules.mockRejectedValue(new Error(
      'Orchestrator 500: {"error":"failed to parse cluster rules: json: cannot unmarshal string into Go struct field FirewallRule.ipversion of type int"}\n',
    ))
    api.getAliases.mockRejectedValue(new Error('Orchestrator 403: {"error":"This feature requires a license","code":"FEATURE_REQUIRED"}'))
    api.getIPSets.mockRejectedValue(new Error('Orchestrator 403: {"error":"This feature requires a license","code":"FEATURE_REQUIRED"}'))

    const { result } = renderHook(() => useFirewallData('conn-1', true))

    await waitFor(() => expect(result.current.loadError).not.toBeNull())

    expect(result.current.loadError).toBe(
      'This feature requires a license · failed to parse cluster rules: json: cannot unmarshal string into Go struct field FirewallRule.ipversion of type int',
    )
    expect(result.current.clusterRules).toEqual([])
    expect(result.current.aliases).toEqual([])
    expect(result.current.clusterOptions).toEqual({ enable: 1, policy_in: 'DROP' })
  })

  it('treats non-array answers as empty lists', async () => {
    mockNodes(['pve1', 'pve2'])
    api.getAliases.mockResolvedValue(null as never)
    api.getIPSets.mockResolvedValue({} as never)
    api.getSecurityGroups.mockResolvedValue('x' as never)
    api.getClusterRules.mockResolvedValue(undefined as never)

    const { result } = renderHook(() => useFirewallData('conn-1', true))

    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.nodesList).toHaveLength(2))

    expect(result.current.aliases).toEqual([])
    expect(result.current.ipsets).toEqual([])
    expect(result.current.securityGroups).toEqual([])
    expect(result.current.clusterRules).toEqual([])
    expect(result.current.loadError).toBeNull()
  })

  it('loads the node firewall of a standalone host', async () => {
    mockNodes(['pve1'])
    api.getNodeRules.mockResolvedValue([rule(0), rule(1), rule(2)])

    const { result } = renderHook(() => useFirewallData('conn-1', true))

    await waitFor(() => expect(result.current.nodeRules).toHaveLength(3))

    expect(result.current.firewallMode).toBe('standalone')
    expect(result.current.nodeOptions).toEqual({ enable: 1 })
    expect(result.current.connectionInfo).toMatchObject({ mode: 'standalone', primary_node: 'pve1', has_node_fw: true })
    expect(api.getNodeOptions).toHaveBeenCalledWith('conn-1', 'pve1')
    expect(result.current.loadError).toBeNull()
  })

  it('reports a standalone node firewall that fails to load', async () => {
    mockNodes(['pve1'])
    api.getNodeOptions.mockRejectedValue(new Error('HTTP 502'))

    const { result } = renderHook(() => useFirewallData('conn-1', true))

    await waitFor(() => expect(result.current.loadError).toBe('HTTP 502'))

    expect(result.current.nodeOptions).toBeNull()
    expect(result.current.nodeRules).toEqual([])
  })

  it('treats a non-array standalone rules answer as no rules', async () => {
    mockNodes(['pve1'])
    api.getNodeRules.mockResolvedValue(null as never)

    const { result } = renderHook(() => useFirewallData('conn-1', true))

    await waitFor(() => expect(result.current.nodeOptions).toEqual({ enable: 1 }))

    expect(result.current.nodeRules).toEqual([])
  })

  it('falls back to a nodeless standalone view when the nodes request fails', async () => {
    for (const failure of ['fail', 'throw'] as const) {
      mockNodes(failure)

      const { result, unmount } = renderHook(() => useFirewallData('conn-1', true))

      await waitFor(() => expect(result.current.connectionInfo).not.toBeNull())

      expect(result.current.firewallMode).toBe('standalone')
      expect(result.current.connectionInfo).toMatchObject({ primary_node: '', has_node_fw: false })
      expect(api.getNodeOptions).not.toHaveBeenCalled()
      unmount()
    }
  })

  it('loads nothing without a connection or an Enterprise license', async () => {
    mockNodes(['pve1', 'pve2'])

    const { result, rerender } = renderHook(
      ({ id, enterprise }: { id: string | null, enterprise: boolean }) => useFirewallData(id, enterprise),
      { initialProps: { id: 'conn-1' as string | null, enterprise: false } },
    )

    rerender({ id: null, enterprise: true })

    await act(async () => {
      await result.current.reload()
    })

    expect(api.getClusterRules).not.toHaveBeenCalled()
    expect(result.current.loadError).toBeNull()
  })

  it('clears the previous error when the connection changes', async () => {
    mockNodes(['pve1', 'pve2'])
    api.getClusterRules.mockRejectedValueOnce(new Error('HTTP 500'))

    const { result, rerender } = renderHook(({ id }: { id: string }) => useFirewallData(id, true), {
      initialProps: { id: 'conn-1' },
    })

    await waitFor(() => expect(result.current.loadError).toBe('HTTP 500'))

    rerender({ id: 'conn-2' })

    await waitFor(() => expect(result.current.clusterRules).toHaveLength(2))
    expect(result.current.loadError).toBeNull()
  })
})
