import { useState, useCallback } from 'react'
import * as firewallAPI from '@/lib/api/firewall'

interface UseHostFirewallRulesReturn {
  hostRulesByNode: Record<string, firewallAPI.FirewallRule[]>
  loadingHostRules: boolean
  loadHostRules: (connectionIdOverride?: string, nodesOverride?: string[]) => Promise<void>
  reloadHostRulesForNode: (node: string) => Promise<void>
  setHostRulesByNode: React.Dispatch<React.SetStateAction<Record<string, firewallAPI.FirewallRule[]>>>
}

export function useHostFirewallRules(connectionId: string | null, nodesList: string[]): UseHostFirewallRulesReturn {
  const [hostRulesByNode, setHostRulesByNode] = useState<Record<string, firewallAPI.FirewallRule[]>>({})
  const [loadingHostRules, setLoadingHostRules] = useState(false)

  const loadHostRules = useCallback(async (connectionIdOverride?: string, nodesOverride?: string[]) => {
    const connId = connectionIdOverride || connectionId
    const nodeList = nodesOverride || nodesList

    if (!connId || nodeList.length === 0) return

    setLoadingHostRules(true)

    try {
      const rulesMap: Record<string, firewallAPI.FirewallRule[]> = {}

      await Promise.all(
        nodeList.map(async (node) => {
          try {
            const rules = await firewallAPI.getNodeRules(connId, node)

            rulesMap[node] = Array.isArray(rules) ? rules : []
          } catch {
            rulesMap[node] = []
          }
        })
      )

      setHostRulesByNode(rulesMap)
    } catch (err) {
      console.error('Failed to load host rules:', err)
    } finally {
      setLoadingHostRules(false)
    }
  }, [connectionId, nodesList])

  const reloadHostRulesForNode = useCallback(async (node: string) => {
    if (!connectionId) return

    try {
      const rules = await firewallAPI.getNodeRules(connectionId, node)

      setHostRulesByNode(prev => ({
        ...prev,
        [node]: Array.isArray(rules) ? rules : []
      }))
    } catch (err) {
      console.error(`Error reloading rules for node ${node}:`, err)
    }
  }, [connectionId])

  return {
    hostRulesByNode,
    loadingHostRules,
    loadHostRules,
    reloadHostRulesForNode,
    setHostRulesByNode,
  }
}
