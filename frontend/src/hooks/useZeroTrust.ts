import useSWR from 'swr'
import { useSWRFetch } from './useSWRFetch'

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

export function useClusterFirewallOptions(refreshInterval = 30000) {
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
        const policyIn = fwData?.policy_in || 'ACCEPT'
        const policyOut = fwData?.policy_out || 'ACCEPT'
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

export function useFirewallScores(refreshInterval = 60000) {
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

export function useClusterSecurityGroups(refreshInterval = 60000) {
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
        const [configRes, rulesRes] = await Promise.all([
          fetch(`/api/v1/connections/${pveConn.id}/guests/${vm.type}/${vm.node}/${vm.vmid}/config`),
          fetch(`/api/v1/firewall/vms/${pveConn.id}/${vm.node}/${vm.type}/${vm.vmid}?type=rules`).catch(() => null)
        ])

        let firewallEnabled = false
        if (configRes.ok) {
          const configJson = await configRes.json()
          const config = configJson?.data || {}
          for (let i = 0; i < 10; i++) {
            const netConfig = config[`net${i}`]
            if (netConfig && typeof netConfig === 'string' && netConfig.includes('firewall=1')) {
              firewallEnabled = true
              break
            }
          }
        }

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

export function useVMFirewallCoverage(isEnterprise: boolean, refreshInterval = 60000) {
  return useSWR(
    isEnterprise ? 'zero-trust/vm-coverage' : null,
    vmFirewallCoverageFetcher,
    { refreshInterval }
  )
}
