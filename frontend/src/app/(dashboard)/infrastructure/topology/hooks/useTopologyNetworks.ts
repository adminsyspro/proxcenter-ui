'use client'

import { useState, useEffect, useRef } from 'react'

import { NO_SEGMENT_KEY, NO_SEGMENT_LABEL, type NicSegment } from '@/lib/proxmox/nicSegment'

import type { InventoryCluster } from '../types'

export interface VmNetworkInfo {
  bridge: string
  vlanTag: number | null
  ip: string | null
  cidr: number | null
  /**
   * Segment resolved server-side (SDN VNet > per-NIC tag > host bridge VLAN).
   * `vlanTag` alone cannot group SDN-attached guests: a VNet carries its tag on
   * the VNet, never on the guest NIC.
   */
  segment: NicSegment
}

/** Segment of a payload that predates server-side resolution, from its tag. */
function fallbackSegment(vlanTag: number | null, bridge: string): NicSegment {
  if (vlanTag != null) {
    return { key: `vlan-${vlanTag}`, label: `VLAN ${vlanTag}`, vlan: vlanTag, tag: vlanTag, bridgeLabel: bridge }
  }

  return { key: NO_SEGMENT_KEY, label: NO_SEGMENT_LABEL, vlan: null, tag: null, bridgeLabel: bridge }
}

export type NetworkMap = Map<string, VmNetworkInfo[]>

export function useTopologyNetworks(connections: InventoryCluster[], enabled: boolean) {
  const [networkMap, setNetworkMap] = useState<NetworkMap>(new Map())
  const [loading, setLoading] = useState(false)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (!enabled || connections.length === 0) {
      setNetworkMap(new Map())
      fetchedRef.current = false

      return
    }

    // Don't re-fetch if already fetched for the same connections
    if (fetchedRef.current) return

    let cancelled = false

    const vms: Array<{ connId: string; type: string; node: string; vmid: string }> = []

    for (const conn of connections) {
      for (const node of conn.nodes) {
        for (const guest of node.guests || []) {
          const vmid = typeof guest.vmid === 'string' ? guest.vmid : String(guest.vmid)

          vms.push({
            connId: conn.id,
            type: guest.type || 'qemu',
            node: node.node,
            vmid,
          })
        }
      }
    }

    if (vms.length === 0) return

    setLoading(true)

    fetch('/api/v1/vms/networks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vms }),
    })
      .then(res => res.json())
      .then(json => {
        if (cancelled) return
        const map: NetworkMap = new Map()
        const data = json?.data || {}

        for (const [key, value] of Object.entries(data)) {
          const networks = (value as any)?.networks || []

          map.set(key, networks.map((n: any) => {
            const bridge = n.bridge || 'unknown'
            const vlanTag = n.vlanTag ?? null

            return {
              bridge,
              vlanTag,
              ip: n.ip || null,
              cidr: n.cidr ?? null,
              segment: (n.segment as NicSegment | undefined) ?? fallbackSegment(vlanTag, bridge),
            }
          }))
        }

        setNetworkMap(map)
        fetchedRef.current = true
      })
      .catch(() => {
        if (!cancelled) setNetworkMap(new Map())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [connections, enabled])

  return { networkMap, loading }
}
