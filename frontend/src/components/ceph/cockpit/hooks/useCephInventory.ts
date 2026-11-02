'use client'

import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import useSWR from 'swr'

import { usePageVisible } from '@/hooks/usePageVisibility'
import { isCephInventory, normalizeCephInventory } from '@/lib/ceph/shape'
import type { CephInventory } from '@/lib/ceph/types'

import { COCKPIT_SWR_RETRY, fetchCockpitShaped, isNotFound } from './cockpitFetch'

export const INVENTORY_INTERVAL_MS = 120_000
/** Au plus un rechargement d'inventaire d'origine "empreinte" par fenetre ; un changement dans la fenetre en declenche UN, differe. */
export const INVENTORY_FINGERPRINT_MIN_GAP_MS = 20_000

/**
 * Inventaire Ceph a 120 s, en pause si l'onglet est cache. Recharge quand l'empreinte du Live change
 * (sauf a sa premiere apparition), borne a 1 par 20 s. `absent` : le cluster n'a pas de Ceph (404).
 */
export function useCephInventory(conn: string | null, fingerprint: string | null) {
  const visible = usePageVisible()
  // Cle propre au cockpit : l'URL brute est cachee par d'autres ecrans (site-recovery) sous la forme `{data}`, et ce cache SWR est global.
  const key = conn ? (['ceph-cockpit', 'inventory', conn] as const) : null
  const [ok, setOk] = useState<{ key: string | null; at: number } | null>(null)

  // Les ids d'OSD sont convertis en nombres ici, une seule fois (R20).
  const { data, error, mutate } = useSWR<CephInventory, Error, typeof key>(key, async ([, , id]: readonly [string, string, string]) => normalizeCephInventory(await fetchCockpitShaped(`/api/v1/connections/${encodeURIComponent(id)}/ceph`, isCephInventory)), {
    refreshInterval: visible ? INVENTORY_INTERVAL_MS : 0,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    ...COCKPIT_SWR_RETRY,
    onSuccess: () => setOk({ key: conn, at: Date.now() }),
  })

  const reload = useCallback(() => { void mutate() }, [mutate])
  // Evenements d'effet : lisent toujours la derniere visibilite et le dernier rechargement, sans relancer l'effet de l'empreinte.
  const reloadLatest = useEffectEvent(() => { reload() })
  const isVisibleNow = useEffectEvent(() => visible)

  const prevFp = useRef<{ conn: string | null; fp: string | null }>({ conn, fp: fingerprint })
  const lastFpReload = useRef(Number.NEGATIVE_INFINITY)
  const deferred = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const prev = prevFp.current

    prevFp.current = { conn, fp: fingerprint }

    if (prev.conn !== conn) {
      if (deferred.current) clearTimeout(deferred.current)
      deferred.current = null
      lastFpReload.current = Number.NEGATIVE_INFINITY

      return
    }

    if (prev.fp === null || fingerprint === null || prev.fp === fingerprint) return

    const wait = lastFpReload.current + INVENTORY_FINGERPRINT_MIN_GAP_MS - Date.now()

    // Onglet cache : 0 appel, la reprise fait l'unique rechargement.
    if (!isVisibleNow()) return

    if (wait <= 0) {
      lastFpReload.current = Date.now()
      reloadLatest()
    } else if (!deferred.current) {
      deferred.current = setTimeout(() => {
        deferred.current = null
        if (!isVisibleNow()) return
        lastFpReload.current = Date.now()
        reloadLatest()
      }, wait)
    }
  }, [conn, fingerprint])

  useEffect(() => () => { if (deferred.current) clearTimeout(deferred.current) }, [])

  const wasVisible = useRef(visible)

  useEffect(() => {
    if (visible && !wasVisible.current) {
      // Le rechargement de reprise remplace un differe encore arme et ouvre une nouvelle fenetre de 20 s.
      if (deferred.current) clearTimeout(deferred.current)
      deferred.current = null
      lastFpReload.current = Date.now()
      reload()
    }
    wasVisible.current = visible
  }, [visible, reload])

  const absent = isNotFound(error)
  const realError = absent ? null : ((error as Error | undefined) ?? null)

  return {
    inventory: data ?? null,
    absent,
    error: realError,
    lastOkAt: ok?.key === conn ? ok.at : null,
    stale: realError !== null && data !== undefined,
    reload,
  }
}
