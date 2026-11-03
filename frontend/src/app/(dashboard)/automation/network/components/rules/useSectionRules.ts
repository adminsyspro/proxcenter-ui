'use client'

import { useCallback, useRef, useState } from 'react'

import * as firewallAPI from '@/lib/api/firewall'
import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

type Args = {
  connectionId: string
  hostRulesByNode: Record<string, firewallAPI.FirewallRule[]>
  setHostRulesByNode: React.Dispatch<React.SetStateAction<Record<string, firewallAPI.FirewallRule[]>>>
  loadGuestRules: (vm: VMFirewallInfo) => Promise<firewallAPI.FirewallRule[]>
}

/**
 * The rules of a host or a guest section, read when the section is opened (UA44, UA51): one request for a guest's
 * rules, two for a host (its rules, then its firewall options, one after the other). Never for every section at once;
 * a section already read is not read again until Refresh.
 */
export function useSectionRules({ connectionId, hostRulesByNode, setHostRulesByNode, loadGuestRules }: Args) {
  const [nodeOptions, setNodeOptions] = useState<Record<string, firewallAPI.NodeOptions>>({})
  const [reading, setReading] = useState<Set<string>>(() => new Set())
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const inFlight = useRef(new Set<string>())

  const track = useCallback(async (key: string, read: () => Promise<unknown>) => {
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)
    setReading(prev => new Set(prev).add(key))
    setFailed(prev => { const n = new Set(prev); n.delete(key); return n })
    try {
      await read()
    } catch {
      setFailed(prev => new Set(prev).add(key))
    } finally {
      inFlight.current.delete(key)
      setReading(prev => { const n = new Set(prev); n.delete(key); return n })
    }
  }, [])

  const readHost = useCallback((node: string) => track(`host:${node}`, async () => {
    const rules = await firewallAPI.getNodeRules(connectionId, node)
    setHostRulesByNode(prev => ({ ...prev, [node]: Array.isArray(rules) ? rules : [] }))
    const options = await firewallAPI.getNodeOptions(connectionId, node)
    setNodeOptions(prev => ({ ...prev, [node]: options ?? {} }))
  }), [connectionId, setHostRulesByNode, track])

  const readGuest = useCallback((vm: VMFirewallInfo) => track(`guest:${vm.type}/${vm.vmid}`, () => loadGuestRules(vm)), [loadGuestRules, track])

  /** Opening a section reads it the first time only. */
  const openHost = useCallback((node: string) => (node in hostRulesByNode ? Promise.resolve() : readHost(node)), [hostRulesByNode, readHost])
  const openGuest = useCallback((vm: VMFirewallInfo) => (vm.rulesLoaded ? Promise.resolve() : readGuest(vm)), [readGuest])

  return { nodeOptions, setNodeOptions, reading, failed, openHost, openGuest, readHost, readGuest }
}
