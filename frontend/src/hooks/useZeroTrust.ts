import { useCallback, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { useRefreshInterval } from './useRefreshInterval'
import { PVE_DEFAULT_POLICY_IN, PVE_DEFAULT_POLICY_OUT } from '@/lib/firewall/pveDefaults'
import type { GuestCoverageRow } from '@/lib/firewall/guestCoverage'

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

/** GET /api/v1/firewall/coverage/{connectionId}: the server counts, bounds and caches (lib/firewall/guestCoverage.ts). */
export type FirewallCoverage = {
  total: number
  measured: number
  enabled: number
  disabled: number
  unknown: number
  sampled: boolean
  partial: boolean
  computedAt: string
  /** The server is still computing: the figures above are the previous ones, or absent. */
  computing: boolean
  /** One row per guest asked (firewall state, options, VLANs, tags), never the rules. */
  guests?: GuestCoverageRow[]
}

/** While the server computes, it is asked again this often (a cheap read: it joins the running computation). */
export const COVERAGE_POLL_MS = 5000

export function firewallCoverageUrl(connectionId: string): string {
  return `/api/v1/firewall/coverage/${encodeURIComponent(connectionId)}`
}

async function readCoverage(url: string, signal?: AbortSignal): Promise<FirewallCoverage> {
  const res = await fetch(url, { cache: 'no-store', signal })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)

  return body as FirewallCoverage
}

/**
 * Firewall coverage of the guests of a connection, for the Dashboard tab: one read when the component mounts (the tab
 * is visible), none on an interval, a short poll only while the server is still computing, and `refresh()` for new
 * figures. The request in flight is aborted when the component goes away. The per-guest Proxmox calls are the
 * server's, bounded there: the browser never asks a guest config, rules or options for this.
 */
export function useVMFirewallCoverage(connectionId: string | null | undefined) {
  const key = connectionId ? firewallCoverageUrl(connectionId) : null
  // Every read in flight, the mount read and a refresh alike: a refresh must not lose the controller of the first.
  const controllers = useRef(new Set<AbortController>())
  const mounted = useRef(false)
  const [refreshing, setRefreshing] = useState(false)

  // Aborted on a real unmount only: React's development double mount runs the cleanup and mounts again at once.
  useEffect(() => {
    mounted.current = true
    const inFlight = controllers.current
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (mounted.current) return
        for (const c of inFlight) c.abort()
        inFlight.clear()
      }, 0)
    }
  }, [])

  const fetcher = useCallback((url: string) => {
    const controller = new AbortController()
    controllers.current.add(controller)
    return readCoverage(url, controller.signal).finally(() => controllers.current.delete(controller))
  }, [])

  const { data, error, isLoading, mutate } = useSWR<FirewallCoverage, Error>(key, fetcher, {
    refreshInterval: latest => (latest?.computing ? COVERAGE_POLL_MS : 0),
    revalidateOnFocus: false,
    dedupingInterval: 5000,
    shouldRetryOnError: false,
  })

  const refresh = useCallback(async () => {
    if (!key) return
    setRefreshing(true)
    try {
      await mutate(fetcher(`${key}?refresh=1`), { revalidate: false })
    } catch {
      // The error is SWR's to show.
    } finally {
      if (mounted.current) setRefreshing(false)
    }
  }, [key, mutate, fetcher])

  return { data, error, loading: isLoading, refreshing, refresh }
}
