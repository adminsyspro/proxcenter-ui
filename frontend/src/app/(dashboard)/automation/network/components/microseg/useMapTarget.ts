import { useCallback, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { targetCandidates, targetPeers, type TargetGuest } from './targetModel'
import type { PolicyGuest, ZoneMember } from './zoneModel'

/**
 * The guest the Overview is targeted on (UA43). Not kept anywhere: a link with `?vm=<vmid>` targets that guest when
 * the map opens, until the admin picks another one or clears it (the parameter then leaves the address, so a reload
 * or a re-render does not target it again). The target follows the inventory (a guest that
 * stops or goes away is no longer targeted). Its panel shows while no zone or edge panel is asked for.
 */
export function useMapTarget(guests: PolicyGuest[], membersByZone: ReadonlyMap<string, ZoneMember[]>) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const linked = params?.get('vm')?.trim() ?? ''
  const candidates = useMemo(() => targetCandidates(guests, membersByZone), [guests, membersByZone])
  const peers = useMemo(() => targetPeers(guests), [guests])
  // undefined: nothing picked yet, the link (if any) decides; null: cleared.
  const [picked, setPicked] = useState<string | null | undefined>(undefined)
  const [panelOpen, setPanelOpen] = useState(true)
  const key = picked === undefined ? candidates.find(c => linked !== '' && String(c.vmid) === linked)?.key ?? null : picked
  const target: TargetGuest | null = useMemo(() => (key ? candidates.find(c => c.key === key) ?? null : null), [key, candidates])

  const pick = useCallback((next: TargetGuest | null) => {
    setPicked(next?.key ?? null)
    setPanelOpen(!!next)
    if (params?.has('vm')) {
      const rest = new URLSearchParams(params.toString())
      rest.delete('vm')
      const query = rest.toString()
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    }
  }, [params, router, pathname])
  const showPanel = useCallback(() => setPanelOpen(true), [])
  const hidePanel = useCallback(() => setPanelOpen(false), [])

  return { candidates, peers, target, pick, panelOpen, showPanel, hidePanel }
}
