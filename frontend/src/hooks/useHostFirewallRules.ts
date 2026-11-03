import { useState, useCallback, useEffect, useRef } from 'react'
import * as firewallAPI from '@/lib/api/firewall'
import { errorMessage } from '@/lib/firewall/loadError'

interface UseHostFirewallRulesReturn {
  hostRulesByNode: Record<string, firewallAPI.FirewallRule[]>
  loadingHostRules: boolean
  /** What failed on the last load, null when every node loaded. */
  hostRulesError: string | null
  loadHostRules: (connectionIdOverride?: string, nodesOverride?: string[]) => Promise<void>
  reloadHostRulesForNode: (node: string) => Promise<void>
  setHostRulesByNode: React.Dispatch<React.SetStateAction<Record<string, firewallAPI.FirewallRule[]>>>
}

export function useHostFirewallRules(connectionId: string | null, nodesList: string[]): UseHostFirewallRulesReturn {
  const [hostRulesByNode, setHostRulesByNode] = useState<Record<string, firewallAPI.FirewallRule[]>>({})
  const [loadingHostRules, setLoadingHostRules] = useState(false)
  const [hostRulesError, setHostRulesError] = useState<string | null>(null)

  // Each load takes a number; only the latest one may write state, so a slow answer of the connection
  // that was just left never lands on the new one.
  const latestLoad = useRef(0)

  useEffect(() => {
    latestLoad.current += 1
    setHostRulesByNode({})
    setLoadingHostRules(false)
    setHostRulesError(null)
  }, [connectionId])

  const loadHostRules = useCallback(async (connectionIdOverride?: string, nodesOverride?: string[]) => {
    const connId = connectionIdOverride || connectionId
    const nodeList = nodesOverride || nodesList

    if (!connId || nodeList.length === 0) return

    const loadId = ++latestLoad.current
    const isLatest = () => latestLoad.current === loadId

    setLoadingHostRules(true)

    const errors = new Set<string>()

    try {
      const rulesMap: Record<string, firewallAPI.FirewallRule[]> = {}

      await Promise.all(
        nodeList.map(async (node) => {
          try {
            const rules = await firewallAPI.getNodeRules(connId, node)

            rulesMap[node] = Array.isArray(rules) ? rules : []
          } catch (err) {
            errors.add(errorMessage(err))
            rulesMap[node] = []
          }
        })
      )

      if (isLatest()) setHostRulesByNode(rulesMap)
    } catch (err) {
      if (isLatest()) {
        console.error('Failed to load host rules:', err)
        errors.add(errorMessage(err))
      }
    } finally {
      if (isLatest()) {
        setHostRulesError(errors.size > 0 ? [...errors].join(' · ') : null)
        setLoadingHostRules(false)
      }
    }
  }, [connectionId, nodesList])

  const reloadHostRulesForNode = useCallback(async (node: string) => {
    if (!connectionId) return

    const loadId = latestLoad.current

    try {
      const rules = await firewallAPI.getNodeRules(connectionId, node)

      if (latestLoad.current !== loadId) return
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
    hostRulesError,
    loadHostRules,
    reloadHostRulesForNode,
    setHostRulesByNode,
  }
}
