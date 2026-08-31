'use client'

import { useCallback, useRef, useState } from 'react'

import type { VMFirewallInfo } from '@/hooks/useVMFirewallRules'

/**
 * Guest IP addresses for the east-west view, keyed by vmid.
 *
 * Loaded on demand through the existing bulk `/api/v1/vms/ips` route, which
 * already tries the QEMU agent / LXC interfaces first and falls back to the
 * static config (cloud-init `ipconfig0`, LXC `net0 ip=`). A guest the route
 * cannot resolve simply has no entry: the view shows it greyed out rather than
 * guessing.
 */
export function useGuestIps(connectionId: string | null) {
  const [ipsByVmid, setIpsByVmid] = useState<Map<number, string[]>>(new Map())
  const [loadingIps, setLoadingIps] = useState(false)

  // One load per connection unless explicitly refreshed.
  const loadedForRef = useRef<string | null>(null)

  const loadGuestIps = useCallback(async (guests: VMFirewallInfo[], force = false) => {
    if (!connectionId || guests.length === 0) return
    if (!force && loadedForRef.current === connectionId) return

    loadedForRef.current = connectionId
    setLoadingIps(true)
    try {
      const resp = await fetch('/api/v1/vms/ips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vms: guests.map(g => ({ connId: connectionId, type: g.type, node: g.node, vmid: String(g.vmid), status: g.status })),
        }),
      })
      const json = await resp.json()

      const next = new Map<number, string[]>()
      for (const guest of guests) {
        const ip = json?.data?.[`${connectionId}:${guest.type}:${guest.node}:${guest.vmid}`]?.ip
        if (typeof ip === 'string' && ip.length > 0) next.set(guest.vmid, [ip])
      }
      setIpsByVmid(next)
    } catch {
      // Leave the map as it is; the view degrades to config-less matching.
      loadedForRef.current = null
    } finally {
      setLoadingIps(false)
    }
  }, [connectionId])

  const resetGuestIps = useCallback(() => {
    loadedForRef.current = null
    setIpsByVmid(new Map())
  }, [])

  return { ipsByVmid, loadingIps, loadGuestIps, resetGuestIps }
}
