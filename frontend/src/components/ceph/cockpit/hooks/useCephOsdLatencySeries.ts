'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

import { usePageVisible } from '@/hooks/usePageVisibility'
import { isCephHistory } from '@/lib/ceph/shape'
import type { CephRange } from '@/lib/ceph/types'

import { COCKPIT_SWR_RETRY, fetchCockpitShaped, isNotFound } from './cockpitFetch'

/** Un point de la courbe de latence d'un OSD : `time` en ms epoch, moyenne et max du pas (identiques pour un point de session). */
export interface OsdLatencyPoint {
  time: number
  avg: number
  max: number
}

export type OsdLatencySeries = Record<number, OsdLatencyPoint[]>

/** Au plus 100 OSD par requete (contrat de l'orchestrateur), au plus 60 points par OSD. */
export const OSD_LATENCY_MAX_IDS = 100
/** Delai avant qu'un changement d'ensemble d'ids (recherche, filtres, repli, page) parte en requete. */
export const OSD_LATENCY_IDS_DEBOUNCE_MS = 300
/** Les points ne bougent pas plus vite que le pas de 1 h (2 min) : un rafraichissement toutes les 5 min au plus. */
export const OSD_LATENCY_REFRESH_MS = 300_000

const NO_SERIES: OsdLatencySeries = {}

/**
 * Courbes de latence des OSD de la page affichee du tableau. Enterprise : historique de l'orchestrateur
 * (la periode du cockpit, la derniere heure en Live), 0 appel PVE ; un 404 vaut aucune donnee, sans erreur.
 * Community : aucun appel, le tampon de session du cockpit (useOsdLatencySessionBuffer) est rendu tel quel.
 * Les changements d'ids sont retenus 300 ms (une frappe de recherche ne fait pas une requete).
 */
export function useCephOsdLatencySeries(conn: string | null, range: CephRange, enterprise: boolean, osdIds: readonly number[], sessionBuffer: OsdLatencySeries): { series: OsdLatencySeries; source: 'history' | 'session' } {
  const visible = usePageVisible()
  const effRange = range === 'live' ? '1h' : range
  const wantedIds = useMemo(() => [...new Set(osdIds)].sort((a, b) => a - b).slice(0, OSD_LATENCY_MAX_IDS).join(','), [osdIds])
  const [held, setHeld] = useState({ conn, ids: wantedIds })

  useEffect(() => {
    if (held.conn === conn && held.ids === wantedIds) return

    const timer = setTimeout(() => setHeld({ conn, ids: wantedIds }), OSD_LATENCY_IDS_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [conn, wantedIds, held])

  // Another cluster, or nothing held yet: the wanted ids are used at once.
  const idsKey = held.conn === conn && held.ids !== '' ? held.ids : wantedIds
  const key = conn && enterprise && idsKey !== '' ? (['ceph-cockpit', 'osd-latency', conn, effRange, idsKey] as const) : null

  const { data } = useSWR<{ conn: string; series: OsdLatencySeries } | null, Error, typeof key>(
    key,
    async ([, , id, r, ids]: readonly [string, string, string, string, string]) => {
      const url = `/api/v1/orchestrator/ceph/${encodeURIComponent(id)}/history?range=${r}&top=1&osds=${ids}`

      try {
        const history = await fetchCockpitShaped(url, isCephHistory)
        const out: OsdLatencySeries = {}

        for (const [osd, points] of Object.entries(history.osd_series ?? {})) {
          const clean = (Array.isArray(points) ? points : [])
            .filter(p => p && Number.isFinite(p.time) && Number.isFinite(p.avg_ms) && Number.isFinite(p.max_ms))
            .map(p => ({ time: p.time * 1000, avg: p.avg_ms, max: p.max_ms }))

          if (clean.length > 0) out[Number(osd)] = clean
        }

        return { conn: id, series: out }
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },
    {
      revalidateOnFocus: false,
      keepPreviousData: true,
      refreshInterval: visible ? OSD_LATENCY_REFRESH_MS : 0,
      ...COCKPIT_SWR_RETRY,
    },
  )

  // A value kept from the previous key (page change) is shown, but never one that belongs to another cluster.
  if (enterprise) return { series: data && data.conn === conn ? data.series : NO_SERIES, source: 'history' }

  return { series: sessionBuffer, source: 'session' }
}
