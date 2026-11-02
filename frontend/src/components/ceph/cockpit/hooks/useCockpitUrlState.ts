'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import type { CephRange, CockpitItem, CockpitTab, OsdFilter } from '@/lib/ceph/types'

import { useCockpitLicense } from './useCockpitLicense'

const TABS: CockpitTab[] = ['overview', 'osd', 'pools', 'crush', 'services', 'perf']
const FILTERS: OsdFilter[] = ['all', 'problem', 'down', 'out']
export type HostsView = 'all' | 'problem'
const HOSTS_VIEWS: HostsView[] = ['all', 'problem']
export type HostMapView = 'compact' | 'dense'
const MAP_VIEWS: HostMapView[] = ['compact', 'dense']
const RANGES: CephRange[] = ['live', '1h', '24h', '7d', '30d']

export function parseItem(raw: string | null): CockpitItem | null {
  if (!raw) return null

  const osd = /^osd\.(\d+)$/.exec(raw)

  if (osd) return { kind: 'osd', id: Number(osd[1]) }
  if (raw.startsWith('pool:') && raw.length > 5) return { kind: 'pool', name: raw.slice(5) }
  if (raw.startsWith('svc:') && raw.length > 4) return { kind: 'service', name: raw.slice(4) }

  return null
}

export function formatItem(item: CockpitItem): string {
  if (item.kind === 'osd') return `osd.${item.id}`

  return item.kind === 'pool' ? `pool:${item.name}` : `svc:${item.name}`
}

export interface CockpitUrlPatch {
  conn?: string | null
  tab?: CockpitTab
  item?: CockpitItem | null
  filter?: OsdFilter
  range?: CephRange
  hosts?: HostsView
  /** `null` efface le choix : la carte revient au mode automatique. */
  map?: HostMapView | null
}

export interface CockpitUrlState {
  conn: string | null
  tab: CockpitTab
  item: CockpitItem | null
  filter: OsdFilter
  range: CephRange
  /** `problem`: the host map shows the hosts with a problem only (`hosts=problem`). */
  hosts: HostsView
  /** Choix explicite de la carte des hotes (`map=compact|dense`), `null` : mode automatique. */
  map: HostMapView | null
  set: (patch: CockpitUrlPatch) => void
}

function pick<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback
}

/** Etat du cockpit porte par l'URL. Onglet et cluster passent par `push` (retour arriere), le reste par `replace`. */
export function useCockpitUrlState(): CockpitUrlState {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { enterprise, resolved } = useCockpitLicense()
  const query = searchParams?.toString() ?? ''
  const queryRef = useRef(query)

  // Realignee sur l'URL reelle a CHAQUE commit (sans dependances) : `set` la fait avancer aussitot pour chainer deux appels,
  // mais une navigation abandonnee ne doit pas laisser une URL fantome. Layout effect : avant les effets passifs (dont l'effet de repli ci-dessous).
  useLayoutEffect(() => { queryRef.current = query })

  const conn = searchParams?.get('conn') || null
  const tab = pick(searchParams?.get('tab') ?? null, TABS, 'overview')
  const filter = pick(searchParams?.get('filter') ?? null, FILTERS, 'all')
  const hosts = pick(searchParams?.get('hosts') ?? null, HOSTS_VIEWS, 'all')
  const mapRaw = searchParams?.get('map') ?? null
  const map = MAP_VIEWS.includes(mapRaw as HostMapView) ? (mapRaw as HostMapView) : null
  const range = pick(searchParams?.get('range') ?? null, RANGES, 'live')
  const itemRaw = searchParams?.get('item') ?? null
  const item = useMemo(() => parseItem(itemRaw), [itemRaw])

  const set = useCallback((patch: CockpitUrlPatch) => {
    const params = new URLSearchParams(queryRef.current)
    const write = (key: string, value: string | null) => {
      if (value === null || value === '') params.delete(key)
      else params.set(key, value)
    }

    if ('conn' in patch) {
      // Changer de cluster efface l'element, le filtre et la vue de l'ancien.
      if ((patch.conn ?? null) !== (params.get('conn') || null)) {
        params.delete('item')
        params.delete('filter')
        params.delete('hosts')
        params.delete('map')
      }
      write('conn', patch.conn ?? null)
    }
    if ('tab' in patch) write('tab', patch.tab ?? null)
    if ('item' in patch) write('item', patch.item ? formatItem(patch.item) : null)
    if ('filter' in patch) write('filter', patch.filter ?? null)
    if ('range' in patch) write('range', patch.range ?? null)
    if ('hosts' in patch) write('hosts', patch.hosts === 'problem' ? 'problem' : null)

    if ('map' in patch) write('map', patch.map && MAP_VIEWS.includes(patch.map) ? patch.map : null)

    const next = params.toString()
    const url = next ? `${pathname}?${next}` : pathname

    queryRef.current = next
    if ('tab' in patch || 'conn' in patch) router.push(url)
    else router.replace(url)
  }, [pathname, router])

  // Une periode longue gardee dans l'URL est ramenee a `live` hors Enterprise, une fois la licence connue.
  useEffect(() => {
    if (resolved && !enterprise && range !== 'live') set({ range: 'live' })
  }, [resolved, enterprise, range, set])

  return { conn, tab, item, filter, range, hosts, map, set }
}
