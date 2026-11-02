'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'

import { redirectToLoginOnce } from '@/hooks/useSWRFetch'
import { usePageVisible } from '@/hooks/usePageVisibility'
import { isExporterFailure, type ExporterFailure } from '@/lib/ceph/exporterFailure'
import { ioMaxGap, ioRate, isOsdCountersSample, mergeIoSeries, pushIoPoint, type OsdCountersSample, type OsdIoPoint } from '@/lib/ceph/osdIo'
import { isCephHistory } from '@/lib/ceph/shape'
import type { CephRange } from '@/lib/ceph/types'

import { COCKPIT_SWR_RETRY, fetchCockpitShaped, isNotFound } from './cockpitFetch'
import { useCephExporterPort } from './useCephExporterPort'

/** Releve de l'exporteur pour les colonnes des tableaux : un appel groupe toutes les 30 s. */
export const OSD_IO_COLUMNS_POLL_MS = 30_000
/**
 * A rate needs two readings: the second one comes this soon after the first, so values show within seconds.
 * ceph-exporter refreshes its stats every 5 s: two readings closer than that can return the same counters (a null rate),
 * so the step is at least twice that period.
 */
export const OSD_IO_COLUMNS_WARMUP_MS = 10_000
/** At most this many consecutive warm-up readings; then the normal period, whatever the reason no rate came. */
export const OSD_IO_COLUMNS_WARMUP_MAX = 3
/** Two readings further apart than twice the period are not one step (see ioMaxGap). */
export const OSD_IO_COLUMNS_MAX_GAP_MS = ioMaxGap(OSD_IO_COLUMNS_POLL_MS)
/** A rate older than three periods is stale (OSD stopped, node gone, tab left): never shown. */
export const OSD_IO_COLUMNS_STALE_MS = 3 * OSD_IO_COLUMNS_POLL_MS
/** La route groupee refuse plus de 20 noeuds : au-dela on decoupe. */
export const OSD_IO_NODES_PER_CALL = 20
/** Au plus 100 OSD par requete d'historique (contrat de l'orchestrateur). */
export const OSD_IO_MAX_IDS = 100
export const OSD_IO_IDS_DEBOUNCE_MS = 300
export const OSD_IO_HISTORY_REFRESH_MS = 60_000

/** ok = l'exporteur du noeud repond ; down = ok:false (aucun exporteur) ; error = l'appel a echoue (reseau, 5xx). */
export type OsdIoNodeState = 'ok' | 'down' | 'error'

/** Un OSD du tableau affiche et le noeud PVE dont l'exporteur le porte (null : noeud introuvable). */
export interface OsdIoRef {
  id: number
  node: string | null
}

/**
 * Etat de session des taux : derniers compteurs, points des 5 dernieres minutes, etat des noeuds. Un objet mutable
 * dont la vie est celle de son proprietaire (le cockpit pour le tableau de l'onglet OSD : il survit au changement
 * d'onglet, un retour dans l'onglet garde les courbes).
 */
export interface OsdIoStore {
  conn: string | null
  prev: Map<number, OsdCountersSample>
  points: Map<number, OsdIoPoint[]>
  /** Client clock instant of the latest point of each OSD: staleness is judged on it, never on the server's `at`. */
  receivedAt: Map<number, number>
  nodes: Map<string, OsdIoNodeState>
  /** Why the exporter of a node that is `down` is not read; no entry = unknown reason (older server). */
  reasons: Map<string, ExporterFailure>
  /** Consecutive readings taken while warming up: reset when the warm-up ends and when the connection changes. */
  warmups: number
}

function emptyStore(conn: string | null): OsdIoStore {
  return { conn, prev: new Map(), points: new Map(), receivedAt: new Map(), nodes: new Map(), reasons: new Map(), warmups: 0 }
}

export function useOsdIoStore(): OsdIoStore {
  const [store] = useState(() => emptyStore(null))

  return store
}

function resetStore(store: OsdIoStore, conn: string | null) {
  store.conn = conn
  store.prev.clear()
  store.points.clear()
  store.receivedAt.clear()
  store.nodes.clear()
  store.reasons.clear()
  store.warmups = 0
}

/** An OSD of a node that answers has a first reading but no rate yet (a node down or an OSD absent from the reading never does). */
function isWarming(store: OsdIoStore, conn: string | null, refs: readonly OsdIoRef[]): boolean {
  return store.conn === conn && refs.some(r => r.node && store.nodes.get(r.node) === 'ok' && store.prev.has(r.id) && !store.points.has(r.id))
}

function countWarmup(store: OsdIoStore, warming: boolean) {
  if (warming) store.warmups += 1
}

function endWarmupWhenDone(store: OsdIoStore, warming: boolean) {
  if (!warming) store.warmups = 0
}

interface GroupedReply {
  nodes: Record<string, { ok?: unknown; reason?: unknown }>
  osds: Record<string, unknown>
}

function isGroupedReply(v: unknown): v is GroupedReply & { at: number } {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>

  return Number.isFinite(o.at) && !!o.nodes && typeof o.nodes === 'object' && !!o.osds && typeof o.osds === 'object'
}

/** Applies one grouped reply to the store: rates by difference, a node that is down loses its references. */
function applyReply(store: OsdIoStore, reply: GroupedReply & { at: number }, refs: readonly OsdIoRef[]) {
  const seen = new Set<number>()

  for (const [id, raw] of Object.entries(reply.osds)) {
    const osd = Number(id)
    const sample = { ...(raw as object), at: reply.at }

    if (!Number.isInteger(osd) || !isOsdCountersSample(sample)) continue
    seen.add(osd)

    const prev = store.prev.get(osd)
    const point = prev ? ioRate(prev, sample, OSD_IO_COLUMNS_MAX_GAP_MS) : null

    store.prev.set(osd, sample)
    if (point) {
      store.points.set(osd, pushIoPoint(store.points.get(osd) ?? [], point))
      store.receivedAt.set(osd, Date.now())
    }
  }

  for (const [node, info] of Object.entries(reply.nodes)) {
    store.nodes.set(node, info?.ok === true ? 'ok' : 'down')
    if (info?.ok !== true && isExporterFailure(info?.reason)) store.reasons.set(node, info.reason)
    else store.reasons.delete(node)
  }

  // An OSD the reply no longer reports (stopped, not exported, node down): its reference AND its points are dropped,
  // so a return starts clean and nothing stale is drawn.
  for (const r of refs) {
    if (r.node && hasNode(reply, r.node) && !seen.has(r.id)) {
      store.prev.delete(r.id)
      store.points.delete(r.id)
      store.receivedAt.delete(r.id)
    }
  }
}

function hasNode(reply: GroupedReply, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(reply.nodes, name)
}

async function readChunk(conn: string, names: string[]): Promise<(GroupedReply & { at: number }) | null> {
  const res = await fetch(`/api/v1/connections/${encodeURIComponent(conn)}/ceph/exporter?nodes=${names.map(encodeURIComponent).join(',')}`, { cache: 'no-store' })

  if (res.status === 401) redirectToLoginOnce()
  if (!res.ok) return null

  const body = (await res.json().catch(() => null)) as { data?: unknown } | null

  return isGroupedReply(body?.data) ? body.data : null
}

export interface OsdIoColumns {
  /** Courbes par OSD : historique + session selon la source et la periode, vides tant qu'il n'y a pas deux points. */
  seriesOf: (osd: number) => OsdIoPoint[]
  /** Dernier taux mesure en session (la valeur courante), indefini tant qu'il n'y a pas deux releves. */
  currentOf: (osd: number) => OsdIoPoint | undefined
  /** Etat de l'exporteur du noeud de l'OSD, `pending` tant que rien n'a ete lu. */
  stateOf: (node: string | null) => OsdIoNodeState | 'pending'
  /** Pourquoi l'exporteur d'un noeud `down` n'est pas lu ; null : noeud lu, raison inconnue (ancien serveur) ou aucun releve. */
  reasonOf: (node: string | null) => ExporterFailure | null
  /** Port du ceph-exporter de la connexion, pour l'infobulle d'aide (lu seulement quand un noeud est sans exporteur). */
  port: number
  /** Enterprise : l'historique stocke fournit les courbes ; sinon le tampon de session. */
  source: 'history' | 'session'
}

/**
 * Colonnes IOPS / debit des tableaux d'OSD. `refs` : les OSD affiches (page ou groupes ouverts). `enabled` faux (tableau
 * non affiche, licence pas resolue) : aucun appel. Valeurs courantes : route groupee de l'exporteur, toutes les 30 s,
 * onglet visible seulement, par tranches de 20 noeuds. Courbes : Enterprise = historique de l'orchestrateur
 * (`osd_io=1&osds=`, la periode du cockpit, la derniere heure en Live) suivi des points de session en Live ; Community
 * = le tampon de session. Un compteur qui baisse ou un premier releve ne font pas de point.
 */
export function useOsdIoColumns(conn: string | null, range: CephRange, enterprise: boolean, refs: readonly OsdIoRef[], enabled: boolean, store: OsdIoStore): OsdIoColumns {
  const visible = usePageVisible()
  const effRange = range === 'live' ? '1h' : range
  const nodesKey = useMemo(() => [...new Set(refs.map(r => r.node).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b)).join(','), [refs])
  const idsKey = useMemo(() => [...new Set(refs.map(r => r.id))].sort((a, b) => a - b).slice(0, OSD_IO_MAX_IDS).join(','), [refs])

  // A stable function: SWR restarts its timer whenever the option changes.
  // Warm-up: an OSD that has a first reading but no rate yet gets its second reading after 10 s, not 30 s, for at most
  // three consecutive readings (the counter lives in the store). SWR arms its timer with the interval of the moment, so
  // the flag is part of the callback identity: the timer is re-armed when the warm-up starts and when it ends.
  const warming = isWarming(store, conn, refs) && store.warmups < OSD_IO_COLUMNS_WARMUP_MAX
  const interval = useCallback(() => (visible ? (warming ? OSD_IO_COLUMNS_WARMUP_MS : OSD_IO_COLUMNS_POLL_MS) : 0), [visible, warming])
  const liveKey = enabled && conn && nodesKey !== '' ? (['ceph-cockpit', 'osd-io-columns', conn, nodesKey] as const) : null

  const { data: tick } = useSWR<number, Error, typeof liveKey>(
    liveKey,
    async ([, , c, joined]: readonly [string, string, string, string]) => {
      if (store.conn !== c) resetStore(store, c)
      // A reading taken while warming up counts against the cap.
      countWarmup(store, isWarming(store, c, refs))

      const names = joined.split(',')
      const chunks: string[][] = []

      for (let i = 0; i < names.length; i += OSD_IO_NODES_PER_CALL) chunks.push(names.slice(i, i + OSD_IO_NODES_PER_CALL))

      const replies = await Promise.all(chunks.map(async chunk => {
        try {
          return { chunk, reply: await readChunk(c, chunk) }
        } catch {
          return { chunk, reply: null }
        }
      }))

      for (const { chunk, reply } of replies) {
        if (reply) {
          applyReply(store, reply, refs)
          continue
        }

        for (const n of chunk) {
          store.nodes.set(n, 'error')
          store.reasons.delete(n)
        }
        for (const r of refs) {
          if (r.node && chunk.includes(r.node)) {
            store.prev.delete(r.id)
            store.points.delete(r.id)
            store.receivedAt.delete(r.id)
          }
        }
      }

      endWarmupWhenDone(store, isWarming(store, c, refs))

      return Date.now()
    },
    { revalidateOnFocus: false, shouldRetryOnError: false, refreshInterval: interval, keepPreviousData: true },
  )

  // The ids of a page change on every search keystroke: held 300 ms before they become a history request.
  const [held, setHeld] = useState({ conn, ids: idsKey })

  useEffect(() => {
    if (held.conn === conn && held.ids === idsKey) return

    const timer = setTimeout(() => setHeld({ conn, ids: idsKey }), OSD_IO_IDS_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [conn, idsKey, held])

  const histIds = held.conn === conn && held.ids !== '' ? held.ids : idsKey
  const histKey = enabled && conn && enterprise && histIds !== '' ? (['ceph-cockpit', 'osd-io-columns-history', conn, effRange, histIds] as const) : null

  const { data: history } = useSWR<{ conn: string; series: Record<number, OsdIoPoint[]> } | null, Error, typeof histKey>(
    histKey,
    async ([, , c, r, ids]: readonly [string, string, string, string, string]) => {
      try {
        const h = await fetchCockpitShaped(`/api/v1/orchestrator/ceph/${encodeURIComponent(c)}/history?range=${r}&top=1&osds=${ids}&osd_io=1`, isCephHistory)
        const series: Record<number, OsdIoPoint[]> = {}

        for (const [osd, raw] of Object.entries(h.osd_io_series ?? {})) {
          const points = (Array.isArray(raw) ? raw : [])
            .filter(p => p && [p.time, p.read_ops, p.write_ops, p.read_bytes, p.write_bytes].every(Number.isFinite))
            .map(p => ({ time: p.time * 1000, readOps: p.read_ops, writeOps: p.write_ops, readBytes: p.read_bytes, writeBytes: p.write_bytes }))

          if (points.length > 0) series[Number(osd)] = points
        }

        return { conn: c, series }
      } catch (e) {
        if (isNotFound(e)) return null

        throw e
      }
    },
    { revalidateOnFocus: false, keepPreviousData: true, refreshInterval: visible ? OSD_IO_HISTORY_REFRESH_MS : 0, ...COCKPIT_SWR_RETRY },
  )

  const ownHistory = history && history.conn === conn ? history.series : null
  const mine = store.conn === conn
  const anyDown = refs.some(r => r.node && mine && store.nodes.get(r.node) === 'down')
  const port = useCephExporterPort(conn, enabled && anyDown)

  // Clock of the staleness check, never read during render: the browser time of the latest reading (`tick`),
  // moved forward by a timer so a point ages even when no reading comes (table hidden, tab in the background).
  const [clock, setClock] = useState(() => Date.now())

  // Only while the table is shown: a hidden table has no use for a clock. Back on the table, or back on the tab, the
  // clock is read again at once, so a point that aged in the meantime is hidden before the next reading.
  useEffect(() => {
    if (!enabled) return

    const refresh = () => setClock(Date.now())
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const timer = setInterval(refresh, OSD_IO_COLUMNS_POLL_MS)

    refresh()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled])

  const now = Math.max(clock, tick ?? 0)

  // Session points of an OSD, or none when the latest one is older than three periods (stale).
  const liveOf = (osd: number): OsdIoPoint[] => {
    const points = mine ? (store.points.get(osd) ?? []) : []
    const received = store.receivedAt.get(osd)

    // The server clock (`time`) may differ from the browser's: staleness counts from the moment the point arrived here.
    return points.length > 0 && received !== undefined && now - received <= OSD_IO_COLUMNS_STALE_MS ? points : []
  }
  const seriesOf = (osd: number): OsdIoPoint[] => {
    const live = liveOf(osd)

    if (!enterprise) return live
    if (range === 'live') return mergeIoSeries(ownHistory?.[osd] ?? [], live)

    return ownHistory?.[osd] ?? []
  }
  const currentOf = (osd: number): OsdIoPoint | undefined => liveOf(osd).at(-1)
  const stateOf = (name: string | null): OsdIoNodeState | 'pending' => (name && mine ? (store.nodes.get(name) ?? 'pending') : 'pending')

  const reasonOf = (name: string | null): ExporterFailure | null => (name && mine && store.nodes.get(name) === 'down' ? (store.reasons.get(name) ?? null) : null)

  return { seriesOf, currentOf, stateOf, reasonOf, port, source: enterprise ? 'history' : 'session' }
}
