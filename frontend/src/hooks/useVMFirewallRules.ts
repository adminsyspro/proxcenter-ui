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
  vlans: number[]
}

// Helper: Check if firewall is enabled on any NIC from VM config
function checkNICFirewallEnabled(config: Record<string, any>): boolean {
  for (let i = 0; i < 10; i++) {
    const netConfig = config[`net${i}`]
    if (netConfig && typeof netConfig === 'string' && netConfig.includes('firewall=1')) {
      return true
    }
  }
  return false
}

// Helper: Extract unique VLAN tags from NIC config (tag=XXX)
function extractVLANs(config: Record<string, any>): number[] {
  const vlans = new Set<number>()
  for (let i = 0; i < 10; i++) {
    const netConfig = config[`net${i}`]
    if (netConfig && typeof netConfig === 'string') {
      const match = netConfig.match(/tag=(\d+)/)
      if (match) vlans.add(Number.parseInt(match[1], 10))
    }
  }
  return Array.from(vlans).sort((a, b) => a - b)
}

interface UseVMFirewallRulesReturn {
  vmFirewallData: VMFirewallInfo[]
  loadingVMRules: boolean
  /**
   * Guests left out by the scan cap. Anything reading `vmFirewallData` as a
   * count — security group membership, firewall coverage — is partial when this
   * is above zero, and must say so rather than report a confident wrong number.
   */
  guestsNotScanned: number
  loadVMFirewallData: () => Promise<void>
  reloadVMFirewallRules: (vm: VMFirewallInfo) => Promise<void>
  setVMFirewallData: React.Dispatch<React.SetStateAction<VMFirewallInfo[]>>
}

/**
 * Guests scanned at most, and how many are fetched at a time. Each guest costs
 * three requests (rules, options, config), so the scan is bounded twice: the cap
 * keeps a large cluster from firing hundreds of requests, and the window keeps
 * them from going out one after another as they used to.
 */
const SCAN_LIMIT = 200
const SCAN_CONCURRENCY = 8

export function useVMFirewallRules(connectionId: string | null): UseVMFirewallRulesReturn {
  const [vmFirewallData, setVMFirewallData] = useState<VMFirewallInfo[]>([])
  const [loadingVMRules, setLoadingVMRules] = useState(false)
  const [guestsNotScanned, setGuestsNotScanned] = useState(0)
  const [loaded, setLoaded] = useState(false)

  const loadVMFirewallData = useCallback(async () => {
    if (!connectionId || loaded) return

    setLoadingVMRules(true)

    try {
      // Get all VMs for this connection using the correct API
      const vmsResp = await fetch(`/api/v1/vms?connId=${connectionId}`)
      const vmsData = await vmsResp.json()
      const allGuests = vmsData?.data?.vms || []
      const guests = allGuests.filter((g: any) => !g.template)

      const scanned = guests.slice(0, SCAN_LIMIT)

      setGuestsNotScanned(Math.max(0, guests.length - scanned.length))

      const loadOneGuest = async (guest: any): Promise<VMFirewallInfo> => {
        const base = {
          vmid: Number.parseInt(guest.vmid, 10),
          name: guest.name || `VM ${guest.vmid}`,
          node: guest.node,
          type: guest.type,
          status: guest.status,
        }

        try {
          // Fetch rules, options, and VM config (for NIC firewall status)
          const [rulesData, optionsData, configResp] = await Promise.all([
            firewallAPI.getVMRules(connectionId, guest.node, guest.type, guest.vmid).catch(() => []),
            firewallAPI.getVMOptions(connectionId, guest.node, guest.type, guest.vmid).catch(() => null),
            fetch(`/api/v1/connections/${connectionId}/guests/${guest.type}/${guest.node}/${guest.vmid}/config`).then(r => r.json()).catch(() => null)
          ])

          // Firewall is "active" if enabled on at least one NIC
          const nicFirewallEnabled = configResp?.data ? checkNICFirewallEnabled(configResp.data) : false
          const vlans = configResp?.data ? extractVLANs(configResp.data) : []

          return {
            ...base,
            firewallEnabled: nicFirewallEnabled,
            rules: Array.isArray(rulesData) ? rulesData : [],
            options: optionsData,
            vlans,
          }
        } catch {
          return { ...base, firewallEnabled: false, rules: [], options: null, vlans: [] }
        }
      }

      // Load firewall data in small parallel batches rather than guest by guest.
      const vmData: VMFirewallInfo[] = []

      for (let i = 0; i < scanned.length; i += SCAN_CONCURRENCY) {
        const batch = await Promise.all(scanned.slice(i, i + SCAN_CONCURRENCY).map(loadOneGuest))

        vmData.push(...batch)
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
      const vlans = configResp?.data ? extractVLANs(configResp.data) : []

      setVMFirewallData(prev => prev.map(v =>
        v.vmid === vm.vmid ? {
          ...v,
          firewallEnabled: nicFirewallEnabled,
          rules: Array.isArray(rulesData) ? rulesData : [],
          options: optionsData,
          vlans,
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
    guestsNotScanned,
    loadVMFirewallData,
    reloadVMFirewallRules,
    setVMFirewallData: resetVMFirewallData,
  }
}
