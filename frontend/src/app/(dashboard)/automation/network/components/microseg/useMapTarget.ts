import { useCallback, useMemo, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

import { targetCandidates, targetPeers, type TargetGuest } from './targetModel'
import type { PolicyGuest, ZoneMember } from './zoneModel'

/**
 * The guest the Overview is targeted on (UA43). Not kept anywhere: a link with `?vm=<vmid>` targets that guest when
 * the map opens, until the admin picks another one or clears it (the parameter then leaves the address, so a reload
 * or a re-render does not target it again). The page hands the VMID of the link (`linkedVm`); without it (the map
 * on its own) the address is read here. The target follows the inventory (a guest that
 * stops or goes away is no longer targeted). Its panel shows while no zone or edge panel is asked for. `shared`: the
 * map draws a shared policy, its guests are keyed by their cluster.
 */
export function useMapTarget(guests: PolicyGuest[], membersByZone: ReadonlyMap<string, ZoneMember[]>, linkedVm?: string | null, shared = false) {
  const params = useSearchParams()
  const pathname = usePathname()
  const linked = (linkedVm === undefined ? params?.get('vm') : linkedVm)?.trim() ?? ''
  const candidates = useMemo(() => targetCandidates(guests, membersByZone, shared), [guests, membersByZone, shared])
  const peers = useMemo(() => targetPeers(guests), [guests])
  // undefined: nothing picked yet, the link (if any) decides; null: cleared.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const [panelOpen, setPanelOpen] = useState(true)
  // The pick is a guestId: two clusters of a shared policy can hold the same type and VMID.
  const id = picked === undefined ? candidates.find(c => linked !== '' && String(c.vmid) === linked)?.id ?? null : picked
  const target: TargetGuest | null = useMemo(() => (id ? candidates.find(c => c.id === id) ?? null : null), [id, candidates])

  const pick = useCallback((next: TargetGuest | null) => {
    setPicked(next?.id ?? null)
    setPanelOpen(!!next)
    if (params?.has('vm')) {
      const rest = new URLSearchParams(params.toString())
      rest.delete('vm')
      const query = rest.toString()
      window.history.replaceState(window.history.state, '', `${pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    }
  }, [params, pathname])
  const showPanel = useCallback(() => setPanelOpen(true), [])
  const hidePanel = useCallback(() => setPanelOpen(false), [])

  return { candidates, peers, target, pick, panelOpen, showPanel, hidePanel }
}
