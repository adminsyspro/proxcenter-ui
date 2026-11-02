'use client'

import { useState } from 'react'

import { osdLatencyMs } from '@/lib/ceph/overview'
import type { CephInventory } from '@/lib/ceph/types'

import type { OsdLatencySeries } from './useCephOsdLatencySeries'

export const OSD_LATENCY_MAX_POINTS = 60

const NO_SERIES: OsdLatencySeries = {}

interface BufferState {
  /** Derniere valeur de `enabled` prise en compte : une reactivation repart de zero. */
  enabled: boolean
  /** Entrees de la derniere lecture prise en compte. */
  conn: string | null
  inventory: CephInventory | null
  at: number | null
  points: OsdLatencySeries
}

/** Prend en compte une nouvelle entree : un point par OSD (sauf lecture deja vue), tampon vide si cluster change ou reactivation. */
function accumulate(prev: BufferState, enabled: boolean, conn: string | null, inventory: CephInventory | null, at: number | null): BufferState {
  if (!enabled) return { ...prev, enabled: false }

  const base = prev.enabled && prev.conn === conn ? prev.points : NO_SERIES

  if (!inventory || at === null) return { enabled: true, conn, inventory, at, points: base }

  let next = base

  for (const osd of inventory.osds.list) {
    const ms = osd.up ? osdLatencyMs(osd) : null
    const own = next[osd.id] ?? []

    if (ms === null || own.at(-1)?.time === at) continue
    if (next === base) next = { ...base }
    next[osd.id] = [...own, { time: at, avg: ms, max: ms }].slice(-OSD_LATENCY_MAX_POINTS)
  }

  return { enabled: true, conn, inventory, at, points: next }
}

/**
 * Tampon de session des latences d'OSD (Community) : un point par OSD a chaque nouvelle lecture d'inventaire
 * (`at` = instant de la lecture), le plus grand de commit et apply ; un OSD down ou sans latence ne fait pas de point.
 * `enabled` : faux (Enterprise, ou licence pas encore resolue) = aucun setState, aucun rendu du cockpit, rien d'accumule.
 * Une reactivation repart de zero (le premier point est la lecture courante). Borne a 60 points par OSD, vide au changement de cluster. Monte dans le cockpit : il se remplit quel que soit l'onglet.
 */
export function useOsdLatencySessionBuffer(conn: string | null, inventory: CephInventory | null, at: number | null, enabled: boolean): OsdLatencySeries {
  const [state, setState] = useState<BufferState>({ enabled: false, conn, inventory: null, at: null, points: NO_SERIES })

  // Etat derive pendant le rendu (react.dev, "storing information from previous renders") : rien n'est ecrit tant que c'est desactive.
  if (state.enabled !== enabled || (enabled && (state.conn !== conn || state.inventory !== inventory || state.at !== at))) {
    setState(accumulate(state, enabled, conn, inventory, at))
  }

  return enabled && state.enabled && state.conn === conn ? state.points : NO_SERIES
}
