'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'

import type { CockpitUrlState, HostMapView } from './useCockpitUrlState'

export const HOST_MAP_STORAGE_KEY = 'ceph-cockpit-host-map'

function readStored(): HostMapView | null {
  try {
    const raw = window.localStorage.getItem(HOST_MAP_STORAGE_KEY)

    return raw === 'compact' || raw === 'dense' ? raw : null
  } catch {
    return null
  }
}

function subscribeNothing(): () => void {
  return () => {}
}

function readNothing(): null {
  return null
}

/**
 * Vue de la carte des hotes : l'URL (`map=`) prime, sinon le dernier choix de ce navigateur, sinon `null`
 * (mode automatique). Le stockage est lu apres l'hydratation (le rendu serveur et le premier rendu client valent `null`, pas d'ecart d'hydratation) ; toute erreur de
 * stockage (navigation privee, acces bloque) est ignoree.
 */
export function useHostMapView(url: Pick<CockpitUrlState, 'map' | 'set'>): { view: HostMapView | null; choose: (view: HostMapView) => void } {
  // Instantane serveur `null` : meme premier rendu qu'a l'hydratation, la valeur du navigateur arrive juste apres.
  const stored = useSyncExternalStore(subscribeNothing, readStored, readNothing)
  // Choix fait dans cette session : garde la vue meme si le stockage refuse l'ecriture.
  const [chosen, setChosen] = useState<HostMapView | null>(null)

  const { set } = url
  const choose = useCallback((view: HostMapView) => {
    setChosen(view)
    try {
      window.localStorage.setItem(HOST_MAP_STORAGE_KEY, view)
    } catch {
      // Stockage indisponible : le choix reste porte par l'URL.
    }
    set({ map: view })
  }, [set])

  return { view: url.map ?? chosen ?? stored, choose }
}
