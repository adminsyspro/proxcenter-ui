'use client'

import { useCallback, useId, useRef } from 'react'
import useSWR from 'swr'

import { redirectToLoginOnce } from '@/hooks/useSWRFetch'
import { usePageVisible } from '@/hooks/usePageVisibility'
import { isExporterFailure, type ExporterFailure } from '@/lib/ceph/exporterFailure'
import { ioMaxGap, ioRate, isOsdCountersSample, pushIoPoint, type OsdCountersSample, type OsdIoPoint } from '@/lib/ceph/osdIo'

/** Delai entre deux releves de l'exporteur tant que la fiche est ouverte et l'onglet visible. */
export const OSD_EXPORTER_POLL_MS = 5000
/** Exporteur injoignable, OSD non exporte ou echec de lecture : la panne dure, on ne frappe plus qu'une fois par 30 s. */
export const OSD_EXPORTER_BACKOFF_MS = 30_000

/** pending = pas de releve encore ; unreachable / not_exported = codes de la route ; error = autre echec (reseau, 5xx). */
export type OsdExporterStatus = 'pending' | 'ok' | 'unreachable' | 'not_exported' | 'error'

export interface OsdExporterLive {
  status: OsdExporterStatus
  /** Why the exporter is unreachable (`unreachable` only); absent for an older server or an unknown reason: the generic message. */
  reason?: ExporterFailure
  /** Taux calcules par difference des compteurs, tampon de session de 5 min (le dernier est la valeur courante). */
  points: OsdIoPoint[]
}

interface Snapshot extends OsdExporterLive {
  key: string
}

const PENDING: OsdExporterLive = { status: 'pending', points: [] }

/**
 * Releve par OSD de l'exporteur de son noeud (route E3a) toutes les 5 s, des compteurs cumules dont on tire des taux.
 * `open` faux (fiche fermee), noeud inconnu : aucun appel. Onglet cache : l'intervalle SWR est coupe, la reprise
 * repart d'une nouvelle reference (un ecart de plus de 30 s ne fait pas de point). Un compteur qui baisse (OSD
 * redemarre) ne fait pas de point. Le tampon vit dans une ref du hook : il est vide a chaque ouverture de la fiche
 * et au changement d'OSD.
 */
export function useOsdExporterLive(conn: string | null, node: string | null, osd: number, open: boolean): OsdExporterLive {
  const visible = usePageVisible()
  const mount = useId()
  const state = useRef<{ key: string; prev: OsdCountersSample | null; points: OsdIoPoint[] }>({ key: '', prev: null, points: [] })
  // A stable function: SWR restarts its timer whenever the option changes, and the cockpit renders more often than every 5 s.
  const interval = useCallback(
    (latest?: Snapshot) => (!visible ? 0 : latest?.status === 'unreachable' || latest?.status === 'not_exported' || latest?.status === 'error' ? OSD_EXPORTER_BACKOFF_MS : OSD_EXPORTER_POLL_MS),
    [visible],
  )
  const key = open && conn && node ? (['ceph-cockpit', 'osd-exporter', mount, conn, node, osd] as const) : null

  const { data } = useSWR<Snapshot, Error, typeof key>(
    key,
    async ([, , , c, n, id]: readonly [string, string, string, string, string, number]) => {
      const k = `${c}/${n}/${id}`

      if (state.current.key !== k) state.current = { key: k, prev: null, points: [] }
      const st = state.current

      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(c)}/nodes/${encodeURIComponent(n)}/ceph/exporter?osd=${id}`, { cache: 'no-store' })

        if (res.status === 401) {
          redirectToLoginOnce()

          return { key: k, status: 'error', points: st.points }
        }

        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { code?: unknown; reason?: unknown } | null

          st.prev = null
          if (res.status === 503 && body?.code === 'exporter_unreachable') {
            return { key: k, status: 'unreachable', points: st.points, ...(isExporterFailure(body.reason) ? { reason: body.reason } : {}) }
          }
          if (res.status === 404 && body?.code === 'osd_not_exported') return { key: k, status: 'not_exported', points: st.points }

          return { key: k, status: 'error', points: st.points }
        }

        const body = (await res.json().catch(() => null)) as { data?: unknown } | null

        if (!isOsdCountersSample(body?.data)) {
          st.prev = null

          return { key: k, status: 'error', points: st.points }
        }

        const sample = body.data as OsdCountersSample
        const point = st.prev ? ioRate(st.prev, sample, ioMaxGap(OSD_EXPORTER_POLL_MS)) : null

        st.prev = sample
        if (point) st.points = pushIoPoint(st.points, point)

        return { key: k, status: 'ok', points: st.points }
      } catch {
        st.prev = null

        return { key: k, status: 'error', points: st.points }
      }
    },
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      refreshInterval: interval,
    },
  )

  if (!key || !data || data.key !== `${key[3]}/${key[4]}/${key[5]}`) return PENDING

  return data
}
