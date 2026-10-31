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

type GuestRef = { key: string; connId: string; type: string; node: string; vmid: string }

/** Every guest of the inventory, keyed exactly like `/api/v1/vms/networks` keys its answer. */
function listGuests(connections: InventoryCluster[]): GuestRef[] {
  const guests: GuestRef[] = []

  for (const conn of connections) {
    for (const node of conn.nodes) {
      for (const guest of node.guests || []) {
        const vmid = typeof guest.vmid === 'string' ? guest.vmid : String(guest.vmid)
        const type = guest.type || 'qemu'

        guests.push({ key: `${conn.id}:${type}:${node.node}:${vmid}`, connId: conn.id, type, node: node.node, vmid })
      }
    }
  }

  return guests
}

function toNetworkInfo(n: any): VmNetworkInfo {
  const bridge = n.bridge || 'unknown'
  const vlanTag = n.vlanTag ?? null

  return {
    bridge,
    vlanTag,
    ip: n.ip || null,
    cidr: n.cidr ?? null,
    segment: (n.segment as NicSegment | undefined) ?? fallbackSegment(vlanTag, bridge),
  }
}

/**
 * NIC/segment data of the inventory guests for the topology network view.
 *
 * `/api/v1/vms/networks` reads each guest config on PVE, so it is never polled:
 * a guest is asked for once, and an inventory refresh only triggers a request
 * for the guests it did not hold before (created, or moved to another node).
 * Guests that left the inventory are dropped locally. A refresh that brings
 * the same guests costs no request at all, and a request still in flight is
 * never re-issued. A NIC edited on an existing guest is not picked up until
 * the view is toggled: nothing in the inventory signals it.
 */
export function useTopologyNetworks(connections: InventoryCluster[], enabled: boolean) {
  const [networkMap, setNetworkMap] = useState<NetworkMap>(new Map())
  const [loading, setLoading] = useState(false)
  // Guests already asked for (answered or in flight) in the current session of the view.
  const requestedRef = useRef<Set<string>>(new Set())
  // Bumped when the view is disabled or unmounted: answers of an older session are dropped.
  const sessionRef = useRef(0)
  const inFlightRef = useRef(0)

  useEffect(() => () => {
    sessionRef.current++
    requestedRef.current = new Set()
    inFlightRef.current = 0
  }, [])

  useEffect(() => {
    if (!enabled || connections.length === 0) {
      // Keep an already empty map's identity: this branch runs on every effect
      // pass, and handing back a fresh Map re-renders the caller, which would
      // loop forever for a caller passing an inline `[]` as its connections.
      setNetworkMap(prev => (prev.size === 0 ? prev : new Map()))
      if (requestedRef.current.size > 0 || inFlightRef.current > 0) {
        sessionRef.current++
        requestedRef.current = new Set()
        inFlightRef.current = 0
        setLoading(false)
      }

      return
    }

    const guests = listGuests(connections)
    const present = new Set(guests.map(g => g.key))

    // Guests gone from the inventory (deleted, or moved: the old node key).
    // Deleting the entry being visited is safe while iterating a Set.
    for (const key of requestedRef.current) {
      if (!present.has(key)) requestedRef.current.delete(key)
    }
    setNetworkMap(prev => {
      if ([...prev.keys()].every(key => present.has(key))) return prev

      return new Map([...prev].filter(([key]) => present.has(key)))
    })

    const missing = guests.filter(g => !requestedRef.current.has(g.key))

    if (missing.length === 0) return

    for (const g of missing) requestedRef.current.add(g.key)
    const session = sessionRef.current

    inFlightRef.current++
    setLoading(true)

    fetch('/api/v1/vms/networks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vms: missing.map(({ connId, type, node, vmid }) => ({ connId, type, node, vmid })) }),
    })
      .then(res => res.json())
      .then(json => {
        if (session !== sessionRef.current) return
        const data = json?.data || {}

        setNetworkMap(prev => {
          const next: NetworkMap = new Map(prev)

          for (const [key, value] of Object.entries(data)) {
            // A guest that left the inventory while the request was in flight stays out.
            if (!requestedRef.current.has(key)) continue
            next.set(key, ((value as any)?.networks || []).map(toNetworkInfo))
          }

          return next
        })
      })
      .catch(() => {
        // Asked again on the next inventory change, as before: no retry of its own.
        if (session === sessionRef.current) {
          for (const g of missing) requestedRef.current.delete(g.key)
        }
      })
      .finally(() => {
        if (session !== sessionRef.current) return
        inFlightRef.current = Math.max(0, inFlightRef.current - 1)
        if (inFlightRef.current === 0) setLoading(false)
      })
    // No cleanup on purpose: a new inventory answer must not abort a request
    // it would only issue again.
  }, [connections, enabled])

  return { networkMap, loading }
}
