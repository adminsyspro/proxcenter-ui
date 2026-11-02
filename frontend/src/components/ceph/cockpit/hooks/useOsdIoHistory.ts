'use client'

import useSWR from 'swr'

import { usePageVisible } from '@/hooks/usePageVisibility'
import type { OsdIoPoint } from '@/lib/ceph/osdIo'
import { trendStateOf, type TrendState } from '@/lib/ceph/overview'
import { isCephHistory } from '@/lib/ceph/shape'
import type { CephRange } from '@/lib/ceph/types'

import { COCKPIT_SWR_RETRY, fetchCockpitShaped, isNotFound } from './cockpitFetch'

/** Les tranches de 5 min de l'orchestrateur : inutile de relire plus d'une fois par minute. */
export const OSD_IO_HISTORY_REFRESH_MS = 60_000

const NONE: OsdIoPoint[] = []

export interface OsdIoHistory {
  points: OsdIoPoint[]
  /** Etat de la zone de courbe (voir trendStateOf) : `live` en Live et en Community, sans appel. */
  state: TrendState
}

/**
 * Historique d'activite d'un OSD (Enterprise, ceph-exporter cote orchestrateur) pour la periode du cockpit,
 * la derniere heure en Live. `enabled` faux (fiche fermee, Community, licence pas resolue) : aucun appel.
 * Un 404 (pas d'historique, release plus ancienne) vaut aucune donnee, sans erreur.
 */
export function useOsdIoHistory(conn: string | null, osd: number, range: CephRange, enterprise: boolean, enabled: boolean): OsdIoHistory {
  const visible = usePageVisible()
  const effRange = range === 'live' ? '1h' : range
  const key = conn && enterprise && enabled ? (['ceph-cockpit', 'osd-io-history', conn, effRange, osd] as const) : null

  const { data, error, isLoading } = useSWR<{ conn: string; osd: number; points: OsdIoPoint[] } | null, Error, typeof key>(
    key,
    async ([, , id, r, o]: readonly [string, string, string, string, number]) => {
      try {
        const history = await fetchCockpitShaped(`/api/v1/orchestrator/ceph/${encodeURIComponent(id)}/history?range=${r}&top=1&osds=${o}&osd_io=1`, isCephHistory)
        const raw = history.osd_io_series?.[String(o)]
        const points = (Array.isArray(raw) ? raw : [])
          .filter(p => p && [p.time, p.read_ops, p.write_ops, p.read_bytes, p.write_bytes].every(Number.isFinite))
          .map(p => ({ time: p.time * 1000, readOps: p.read_ops, writeOps: p.write_ops, readBytes: p.read_bytes, writeBytes: p.write_bytes }))

        return { conn: id, osd: o, points }
      } catch (e) {
        if (isNotFound(e)) return null

        throw e
      }
    },
    {
      revalidateOnFocus: false,
      refreshInterval: visible ? OSD_IO_HISTORY_REFRESH_MS : 0,
      ...COCKPIT_SWR_RETRY,
    },
  )

  if (!key) return { points: NONE, state: 'live' }

  // A 404 (null) reads as "unavailable"; a value that belongs to another cluster or OSD is never shown.
  const own = data && data.conn === conn && data.osd === osd ? data : null

  return { points: own?.points ?? NONE, state: trendStateOf(range, own, isLoading, error) }
}
