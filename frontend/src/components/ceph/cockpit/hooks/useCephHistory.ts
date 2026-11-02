'use client'

import { useCallback, useEffect, useRef } from 'react'
import useSWR, { useSWRConfig } from 'swr'

import { usePageVisible } from '@/hooks/usePageVisibility'

import type { CephHistory } from '@/lib/orchestrator/client'
import { isCephHistory } from '@/lib/ceph/shape'
import type { CephRange } from '@/lib/ceph/types'

import { useRevalidateErrorOnResume } from './useRevalidateErrorOnResume'
import { COCKPIT_SWR_RETRY, fetchCockpitShaped, isNotFound } from './cockpitFetch'

/** Pas de rafraichissement par periode (s) : un point de l'historique ne change pas plus vite que son pas. */
export const HISTORY_REFRESH_S: Record<Exclude<CephRange, 'live'>, number> = { '1h': 60, '24h': 300, '7d': 1800, '30d': 7200 }

const HISTORY_KEY = 'history'

/** Revalide tous les historiques ouverts (dont les courbes de latence des OSD) (bouton rafraichir du cockpit). */
export function useRefreshCephHistory(): () => void {
  const { mutate } = useSWRConfig()

  return useCallback(() => {
    void mutate((key: unknown) => Array.isArray(key) && key[0] === 'ceph-cockpit' && (key[1] === HISTORY_KEY || key[1] === 'osd-latency'))
  }, [mutate])
}

type StoredRange = Exclude<CephRange, 'live'>

/**
 * Lecture de l'historique d'une periode stockee, `null` = aucun appel. Une seule cle SWR par (connexion, periode) :
 * les consommateurs d'une meme periode partagent l'appel. Rafraichi au pas de la periode, onglet visible seulement.
 */
function useStoredHistory(conn: string | null, range: StoredRange | null) {
  const visible = usePageVisible()
  // Cle propre au cockpit : la valeur cachee est deballee (ou null sur 404), pas la reponse brute.
  const key = conn && range ? (['ceph-cockpit', HISTORY_KEY, conn, range] as const) : null

  const { data, error, isLoading, mutate } = useSWR<CephHistory | null, Error, typeof key>(
    key,
    async ([, , id, r]: readonly [string, string, string, string]) => {
      const url = `/api/v1/orchestrator/ceph/${encodeURIComponent(id)}/history?range=${r}`

      try {
        return await fetchCockpitShaped(url, isCephHistory)
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },
    {
      revalidateOnFocus: false,
      refreshInterval: visible && range ? HISTORY_REFRESH_S[range] * 1000 : 0,
      ...COCKPIT_SWR_RETRY,
    }
  )

  useRevalidateErrorOnResume(error, mutate)

  return { history: data ?? null, loading: isLoading, error: (error as Error | undefined) ?? null, mutate, visible }
}

/** Historique Enterprise. Aucun appel en `live` ni hors Enterprise ; un 404 (Community, orchestrateur) vaut `null` sans erreur. */
export function useCephHistory(conn: string | null, range: CephRange, enterprise: boolean) {
  const { history, loading, error } = useStoredHistory(conn, enterprise && range !== 'live' ? range : null)

  return { history, loading, error }
}

/**
 * Derniere heure d'historique pour completer le Live (Enterprise) : meme appel et meme cle que la periode `1h`
 * (un autre consommateur de `1h` ne double pas l'appel), rafraichi a la minute onglet visible seulement ; au retour
 * de visibilite l'historique est relu une fois (sauf en erreur : deja relu par la reprise), pour combler tout de suite le trou laisse par la pause du Live.
 * Aucun appel hors Enterprise ou si `enabled` est faux.
 */
export function useCephLastHour(conn: string | null, enabled: boolean) {
  const { history, loading, error, mutate, visible } = useStoredHistory(conn, enabled ? '1h' : null)
  const wasVisible = useRef(visible)

  useEffect(() => {
    const resumed = visible && !wasVisible.current

    wasVisible.current = visible
    // In error, useRevalidateErrorOnResume already rereads once on resume: not twice.
    if (resumed && enabled && !error) void mutate()
  }, [visible, enabled, error, mutate])

  return { history, loading, error }
}
