import { useState, useCallback, useEffect } from 'react'
import * as firewallAPI from '@/lib/api/firewall'

export interface Connection {
  id: string
  name: string
  type: 'pve' | 'pbs'
  baseUrl: string
}

interface UseFirewallDataReturn {
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  securityGroups: firewallAPI.SecurityGroup[]
  clusterOptions: firewallAPI.ClusterOptions | null
  clusterRules: firewallAPI.FirewallRule[]
  nodeOptions: firewallAPI.NodeOptions | null
  nodeRules: firewallAPI.FirewallRule[]
  firewallMode: firewallAPI.FirewallMode
  connectionInfo: firewallAPI.ConnectionFirewallInfo | null
  nodesList: string[]
  loading: boolean
  reload: () => void
  setClusterRules: React.Dispatch<React.SetStateAction<firewallAPI.FirewallRule[]>>
  setClusterOptions: React.Dispatch<React.SetStateAction<firewallAPI.ClusterOptions | null>>
}

export function useFirewallData(connectionId: string | null, isEnterprise: boolean): UseFirewallDataReturn {
  const [aliases, setAliases] = useState<firewallAPI.Alias[]>([])
  const [ipsets, setIPSets] = useState<firewallAPI.IPSet[]>([])
  const [securityGroups, setSecurityGroups] = useState<firewallAPI.SecurityGroup[]>([])
  const [clusterOptions, setClusterOptions] = useState<firewallAPI.ClusterOptions | null>(null)
  const [clusterRules, setClusterRules] = useState<firewallAPI.FirewallRule[]>([])
  const [nodeOptions, setNodeOptions] = useState<firewallAPI.NodeOptions | null>(null)
  const [nodeRules, setNodeRules] = useState<firewallAPI.FirewallRule[]>([])
  const [firewallMode, setFirewallMode] = useState<firewallAPI.FirewallMode>('cluster')
  const [connectionInfo, setConnectionInfo] = useState<firewallAPI.ConnectionFirewallInfo | null>(null)
  const [nodesList, setNodesList] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const loadFirewallData = useCallback(async () => {
    if (!connectionId) return

    setLoading(true)

    // Clear previous data first
    setNodesList([])

    try {
      const [aliasesData, ipsetsData, groupsData, clusterOpts, clusterRulesData] = await Promise.all([
        firewallAPI.getAliases(connectionId).catch(() => []),
        firewallAPI.getIPSets(connectionId).catch(() => []),
        firewallAPI.getSecurityGroups(connectionId).catch(() => []),
        firewallAPI.getClusterOptions(connectionId).catch(() => null),
        firewallAPI.getClusterRules(connectionId).catch(() => []),
      ])

      setAliases(Array.isArray(aliasesData) ? aliasesData : [])
      setIPSets(Array.isArray(ipsetsData) ? ipsetsData : [])
      setSecurityGroups(Array.isArray(groupsData) ? groupsData : [])
      setClusterOptions(clusterOpts)
      setClusterRules(Array.isArray(clusterRulesData) ? clusterRulesData : [])

      // Fetch nodes list from VMs API
      let nodes: string[] = []

      try {
        const vmsResp = await fetch(`/api/v1/vms?connId=${connectionId}`)

        if (vmsResp.ok) {
          const vmsJson = await vmsResp.json()
          const vms = vmsJson?.data?.vms || []

          // Extract unique nodes
          nodes = [...new Set(vms.map((vm: any) => vm.node).filter(Boolean))] as string[]
          setNodesList(nodes)
        }
      } catch {
        setNodesList([])
      }

      // Detect mode: standalone if only 1 node, cluster if multiple nodes
      const isStandalone = nodes.length <= 1

      if (!isStandalone) {
        setFirewallMode('cluster')
        setConnectionInfo({
          mode: 'cluster',
          node_count: nodes.length,
          primary_node: '',
          has_cluster_fw: true,
          has_node_fw: true,
        })
      } else {
        setFirewallMode('standalone')
        const standaloneNode = nodes[0] || ''

        setConnectionInfo({
          mode: 'standalone',
          node_count: nodes.length,
          primary_node: standaloneNode,
          has_cluster_fw: false,
          has_node_fw: !!standaloneNode,
        })

        // In standalone mode, load node-level firewall options (only if we have a real node name)
        if (standaloneNode) {
          try {
            const nodeOpts = await firewallAPI.getNodeOptions(connectionId, standaloneNode)

            setNodeOptions(nodeOpts)
            const nodeRulesData = await firewallAPI.getNodeRules(connectionId, standaloneNode)

            setNodeRules(Array.isArray(nodeRulesData) ? nodeRulesData : [])
          } catch {
            // Node firewall might not be configured
            setNodeOptions(null)
            setNodeRules([])
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to load firewall data:', err)
    } finally {
      setLoading(false)
    }
  }, [connectionId])

  // Reset data when connection changes
  useEffect(() => {
    setAliases([])
    setIPSets([])
    setSecurityGroups([])
    setClusterOptions(null)
    setClusterRules([])
    setNodeOptions(null)
    setNodeRules([])
    setNodesList([])
    setFirewallMode('cluster')
    setConnectionInfo(null)
  }, [connectionId])

  // Load firewall data when connection changes
  useEffect(() => {
    if (isEnterprise && connectionId) {
      loadFirewallData()
    }
  }, [connectionId, loadFirewallData, isEnterprise])

  return {
    aliases,
    ipsets,
    securityGroups,
    clusterOptions,
    clusterRules,
    nodeOptions,
    nodeRules,
    firewallMode,
    connectionInfo,
    nodesList,
    loading,
    reload: loadFirewallData,
    setClusterRules,
    setClusterOptions,
  }
}
