import useSWR from 'swr'
import { useSWRFetch } from './useSWRFetch'
import { useRefreshInterval } from './useRefreshInterval'
import { hasNICFirewall, PVE_DEFAULT_POLICY_IN, PVE_DEFAULT_POLICY_OUT } from '@/lib/firewall/pveDefaults'

// Fetcher that chains connections -> firewall options for a single PVE connection
const clusterFirewallFetcher = async (url: string) => {
  const connRes = await fetch('/api/v1/connections')
  const connJson = await connRes.json()
  const pveConn = connJson.data?.find((c: any) => c.type === 'pve')
  if (!pveConn) return null

  const fwRes = await fetch(`/api/v1/firewall/cluster/${pveConn.id}?type=options`)
  if (!fwRes.ok) return null
  const fwData = await fwRes.json()
  return { ...fwData, connectionId: pveConn.id, connectionName: pveConn.name }
}

export function useClusterFirewallOptions() {
  const refreshInterval = useRefreshInterval(120000)
  return useSWR('zero-trust/firewall-options', clusterFirewallFetcher, { refreshInterval })
}

// Fetcher for firewall scores across all PVE clusters
const firewallScoresFetcher = async () => {
  const connRes = await fetch('/api/v1/connections')
  const connJson = await connRes.json()
  const pveConns = (connJson.data || []).filter((c: any) => c.type === 'pve')
  if (pveConns.length === 0) return []

  return Promise.all(
    pveConns.map(async (conn: any) => {
      try {
        const fwRes = await fetch(`/api/v1/firewall/cluster/${conn.id}?type=options`)
        let fwData = null
        if (fwRes?.ok) fwData = await fwRes.json()

        let score = 0
        const enabled = fwData?.enable === 1
        const policyIn = fwData?.policy_in || PVE_DEFAULT_POLICY_IN
        const policyOut = fwData?.policy_out || PVE_DEFAULT_POLICY_OUT
        if (enabled) score += 40
        if (policyIn === 'DROP') score += 30
        if (policyOut === 'DROP') score += 30

        return { id: conn.id, name: conn.name, enabled, policyIn, policyOut, score }
      } catch {
        return { id: conn.id, name: conn.name, enabled: false, policyIn: 'N/A', policyOut: 'N/A', score: 0 }
      }
    })
  )
}

export function useFirewallScores() {
  const refreshInterval = useRefreshInterval(60000)
  return useSWR('zero-trust/firewall-scores', firewallScoresFetcher, { refreshInterval })
}

// Fetcher for security groups across all PVE clusters
const securityGroupsFetcher = async () => {
  const connRes = await fetch('/api/v1/connections')
  const connJson = await connRes.json()
  const pveConns = (connJson.data || []).filter((c: any) => c.type === 'pve')
  if (pveConns.length === 0) return []

  return Promise.all(
    pveConns.map(async (conn: any) => {
      try {
        const sgRes = await fetch(`/api/v1/firewall/groups/${conn.id}`)
        let groups: any[] = []
        if (sgRes?.ok) {
          const sgJson = await sgRes.json()
          groups = Array.isArray(sgJson) ? sgJson : []
        }
        return { id: conn.id, name: conn.name, groups: groups.slice(0, 10) }
      } catch {
        return { id: conn.id, name: conn.name, groups: [] }
      }
    })
  )
}

export function useClusterSecurityGroups() {
  const refreshInterval = useRefreshInterval(60000)
  return useSWR('zero-trust/security-groups', securityGroupsFetcher, { refreshInterval })
}

// Fetcher for VM firewall coverage (Enterprise only)
const vmFirewallCoverageFetcher = async () => {
  const connRes = await fetch('/api/v1/connections')
  const connJson = await connRes.json()
  const pveConn = connJson.data?.find((c: any) => c.type === 'pve')
  if (!pveConn) return []

  const vmsRes = await fetch(`/api/v1/vms?connId=${pveConn.id}`)
  if (!vmsRes?.ok) return []
  const vmsJson = await vmsRes.json()
  const guests = vmsJson?.data?.vms || []

  return Promise.all(
    guests.slice(0, 30).map(async (vm: any) => {
      try {
        const [configRes, rulesRes, optionsRes] = await Promise.all([
          fetch(`/api/v1/connections/${pveConn.id}/guests/${vm.type}/${vm.node}/${vm.vmid}/config`),
          fetch(`/api/v1/firewall/vms/${pveConn.id}/${vm.node}/${vm.type}/${vm.vmid}?type=rules`).catch(() => null),
          fetch(`/api/v1/firewall/vms/${pveConn.id}/${vm.node}/${vm.type}/${vm.vmid}?type=options`).catch(() => null)
        ])

        // PVE filters the guest only when its firewall options AND one of its
        // NICs have the firewall on (#1065).
        const config = configRes.ok ? (await configRes.json())?.data : null
        const options = optionsRes?.ok ? await optionsRes.json() : null
        const firewallEnabled = options?.enable === 1 && hasNICFirewall(config)

        let rules: any[] = []
        let hasSG = false
        if (rulesRes?.ok) {
          rules = await rulesRes.json()
          if (Array.isArray(rules)) hasSG = rules.some((r: any) => r.type === 'group')
        }

        return { ...vm, firewallEnabled, hasRules: Array.isArray(rules) && rules.length > 0, hasSG }
      } catch {
        return { ...vm, firewallEnabled: false, hasRules: false, hasSG: false }
      }
    })
  )
}

export function useVMFirewallCoverage(isEnterprise: boolean) {
  const refreshInterval = useRefreshInterval(60000)
  return useSWR(
    isEnterprise ? 'zero-trust/vm-coverage' : null,
    vmFirewallCoverageFetcher,
    { refreshInterval }
  )
}
