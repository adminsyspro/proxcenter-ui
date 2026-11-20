import { useCallback, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

import type { MicrosegZone } from '@/lib/microseg/types'

import { filterItems, guestItemId, mapFilter, type FilterItem } from './mapFilterModel'
import { targetCandidates, targetPeers, type TargetGuest } from './targetModel'
import type { MapCluster } from './zoneGraph'
import type { PolicyGuest, ZoneMember } from './zoneModel'

/** What the map can be filtered on beyond its guests: the zones of the policy, and the clusters of a shared policy (null on one cluster). */
export type FilterScope = { zones: readonly MicrosegZone[]; clusters: readonly MapCluster[] | null }

const NO_ZONES: readonly MicrosegZone[] = []

/**
 * What the Overview is filtered on: guests, zones, Proxmox nodes and clusters, picked one after the other (`picked`):
 * the map keeps them and the flows between them, and with `withPeers` what they exchange with too. One guest alone is
 * the target the map always had (UA43): `target`, with its panel, the map left whole and focused on it. Not kept anywhere: a link with `?vm=<vmid>` targets that guest when the map opens, until the admin picks
 * something else or clears it (the parameter then leaves the address, so a reload or a re-render does not target it
 * again). The page hands the VMID of the link (`linkedVm`); without it (the map on its own) the address is read here.
 * The picks follow the inventory and the policy (a guest that stops, a zone that is deleted, is no longer picked).
 * The panel of the target shows while no zone or edge panel is asked for. `shared`: the map draws a shared policy,
 * its guests are keyed by their cluster.
 */
export function useMapTarget(guests: PolicyGuest[], membersByZone: ReadonlyMap<string, ZoneMember[]>, linkedVm?: string | null, shared = false, scope?: FilterScope) {
  const params = useSearchParams()
  const pathname = usePathname()
  const linked = (linkedVm === undefined ? params?.get('vm') : linkedVm)?.trim() ?? ''
  const candidates = useMemo(() => targetCandidates(guests, membersByZone, shared), [guests, membersByZone, shared])
  const peers = useMemo(() => targetPeers(guests), [guests])
  const zones = scope?.zones ?? NO_ZONES
  const clusters = scope?.clusters ?? null
  const items = useMemo(() => filterItems(zones, candidates, clusters), [zones, candidates, clusters])
  // undefined: nothing picked yet, the link (if any) decides; an empty list: cleared.
  const [ids, setIds] = useState<readonly string[] | undefined>(undefined)
  const [withPeers, setWithPeers] = useState(false)
  const [panelOpen, setPanelOpen] = useState(true)
  // A guest is picked by its guestId: two clusters of a shared policy can hold the same type and VMID.
  const linkedGuest = useMemo(() => (linked === '' ? undefined : candidates.find(c => String(c.vmid) === linked)), [candidates, linked])
  const picked = useMemo<FilterItem[]>(() => {
    const wanted = ids ?? (linkedGuest ? [guestItemId(linkedGuest)] : [])
    const byId = new Map(items.map(item => [item.id, item]))
    return wanted.flatMap(id => { const item = byId.get(id); return item ? [item] : [] })
  }, [ids, linkedGuest, items])
  const filter = useMemo(() => mapFilter(picked, candidates, !withPeers), [picked, candidates, withPeers])
  const target: TargetGuest | null = filter?.single ?? null

  const forgetLink = useCallback(() => {
    if (!params?.has('vm')) return
    const rest = new URLSearchParams(params.toString())
    rest.delete('vm')
    const query = rest.toString()
    window.history.replaceState(window.history.state, '', `${pathname}${query ? `?${query}` : ''}${window.location.hash}`)
  }, [params, pathname])
  /** The picks of the picker, in their order. */
  const pickItems = useCallback((next: readonly FilterItem[]) => {
    setIds(next.map(item => item.id))
    setPanelOpen(next.length > 0)
    forgetLink()
  }, [forgetLink])
  /** One guest as the only pick (a click on a guest of the node view), or nothing. */
  const pick = useCallback((next: TargetGuest | null) => {
    setIds(next ? [guestItemId(next)] : [])
    setPanelOpen(!!next)
    forgetLink()
  }, [forgetLink])
  const showPanel = useCallback(() => setPanelOpen(true), [])
  const hidePanel = useCallback(() => setPanelOpen(false), [])

  return { candidates, peers, target, pick, panelOpen, showPanel, hidePanel, items, picked, pickItems, filter, withPeers, setWithPeers }
}
