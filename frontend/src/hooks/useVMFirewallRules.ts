import { useState, useCallback } from 'react'
import * as firewallAPI from '@/lib/api/firewall'

export interface VMFirewallInfo {
  vmid: number
  name: string
  node: string
  type: 'qemu' | 'lxc'
  status: string
  firewallEnabled: boolean
  rules: firewallAPI.FirewallRule[]
  options: firewallAPI.VMOptions | null
}

// Helper: Check if firewall is enabled on any NIC from VM config
function checkNICFirewallEnabled(config: Record<string, any>): boolean {
  // Check net0, net1, net2, etc. for firewall=1
  for (let i = 0; i < 10; i++) {
    const netConfig = config[`net${i}`]

    if (netConfig && typeof netConfig === 'string' && netConfig.includes('firewall=1')) {
      return true
    }
  }

  return false
}

interface UseVMFirewallRulesReturn {
  vmFirewallData: VMFirewallInfo[]
  loadingVMRules: boolean
  loadVMFirewallData: () => Promise<void>
  reloadVMFirewallRules: (vm: VMFirewallInfo) => Promise<void>
  setVMFirewallData: React.Dispatch<React.SetStateAction<VMFirewallInfo[]>>
}

export function useVMFirewallRules(connectionId: string | null): UseVMFirewallRulesReturn {
  const [vmFirewallData, setVMFirewallData] = useState<VMFirewallInfo[]>([])
  const [loadingVMRules, setLoadingVMRules] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const loadVMFirewallData = useCallback(async () => {
    if (!connectionId || loaded) return

    setLoadingVMRules(true)

    try {
      // Get all VMs for this connection using the correct API
      const vmsResp = await fetch(`/api/v1/vms?connId=${connectionId}`)
      const vmsData = await vmsResp.json()
      const guests = vmsData?.data?.vms || []

      // Load firewall rules for each VM (limit to avoid too many requests)
      const vmData: VMFirewallInfo[] = []

      for (const guest of guests.slice(0, 50)) { // Limit to 50 VMs
        try {
          // Fetch rules, options, and VM config (for NIC firewall status)
          const [rulesData, optionsData, configResp] = await Promise.all([
            firewallAPI.getVMRules(connectionId, guest.node, guest.type, guest.vmid).catch(() => []),
            firewallAPI.getVMOptions(connectionId, guest.node, guest.type, guest.vmid).catch(() => null),
            fetch(`/api/v1/connections/${connectionId}/guests/${guest.type}/${guest.node}/${guest.vmid}/config`).then(r => r.json()).catch(() => null)
          ])

          // Firewall is "active" if enabled on at least one NIC
          const nicFirewallEnabled = configResp?.data ? checkNICFirewallEnabled(configResp.data) : false

          vmData.push({
            vmid: parseInt(guest.vmid, 10),
            name: guest.name || `VM ${guest.vmid}`,
            node: guest.node,
            type: guest.type,
            status: guest.status,
            firewallEnabled: nicFirewallEnabled,
            rules: Array.isArray(rulesData) ? rulesData : [],
            options: optionsData
          })
        } catch {
          vmData.push({
            vmid: parseInt(guest.vmid, 10),
            name: guest.name || `VM ${guest.vmid}`,
            node: guest.node,
            type: guest.type,
            status: guest.status,
            firewallEnabled: false,
            rules: [],
            options: null
          })
        }
      }

      // Sort by firewall enabled first, then by rule count
      vmData.sort((a, b) => {
        if (a.firewallEnabled !== b.firewallEnabled) return b.firewallEnabled ? 1 : -1

        return b.rules.length - a.rules.length
      })

      setVMFirewallData(vmData)
    } catch (err) {
      console.error('Failed to load VM firewall data:', err)
      setVMFirewallData([])
    } finally {
      setLoadingVMRules(false)
      setLoaded(true)
    }
  }, [connectionId, loaded])

  // Reload only one VM's firewall data
  const reloadVMFirewallRules = useCallback(async (vm: VMFirewallInfo) => {
    if (!connectionId) return

    try {
      const [rulesData, optionsData, configResp] = await Promise.all([
        firewallAPI.getVMRules(connectionId, vm.node, vm.type, vm.vmid).catch(() => []),
        firewallAPI.getVMOptions(connectionId, vm.node, vm.type, vm.vmid).catch(() => null),
        fetch(`/api/v1/connections/${connectionId}/guests/${vm.type}/${vm.node}/${vm.vmid}/config`).then(r => r.json()).catch(() => null)
      ])

      const nicFirewallEnabled = configResp?.data ? checkNICFirewallEnabled(configResp.data) : false

      setVMFirewallData(prev => prev.map(v =>
        v.vmid === vm.vmid ? {
          ...v,
          firewallEnabled: nicFirewallEnabled,
          rules: Array.isArray(rulesData) ? rulesData : [],
          options: optionsData
        } : v
      ))
    } catch (err) {
      console.error('Failed to reload VM firewall rules:', err)
    }
  }, [connectionId])

  const resetVMFirewallData: typeof setVMFirewallData = (value) => {
    setVMFirewallData(value)
    setLoaded(false)
  }

  return {
    vmFirewallData,
    loadingVMRules,
    loadVMFirewallData,
    reloadVMFirewallRules,
    setVMFirewallData: resetVMFirewallData,
  }
}
