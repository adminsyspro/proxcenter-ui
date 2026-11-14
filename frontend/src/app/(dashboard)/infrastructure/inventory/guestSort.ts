import { createContext } from 'react'

import type { TreeCluster } from './InventoryTree'

type TreeGuest = TreeCluster['nodes'][number]['vms'][number]

/** Order of the guests under each node of the inventory tree (#1373). */
export type GuestSortMode = 'vmid' | 'name'

export const GUEST_SORT_STORAGE_KEY = 'pxc-inventory-guest-sort'

/**
 * The page owns the choice and the tree reads it. A context rather than a prop
 * keeps the tree's signature untouched, like InventoryLoadedContext. Without a
 * provider the tree keeps the VMID order and shows no toggle.
 */
export const GuestSortContext = createContext<{ mode: GuestSortMode; toggle?: () => void }>({ mode: 'vmid' })

export function parseGuestSortMode(stored: string | null): GuestSortMode {
  return stored === 'name' ? 'name' : 'vmid'
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Natural, case-insensitive name order ("web2" before "web10"), VMID as tie-break. */
export function compareGuestNames(a: TreeGuest, b: TreeGuest): number {
  return collator.compare(a.name ?? '', b.name ?? '') || Number(a.vmid) - Number(b.vmid)
}

/**
 * The inventory already arrives sorted by VMID (stream route + live events),
 * so 'vmid' hands the clusters back as is and only 'name' re-sorts a copy.
 */
export function sortClusterGuests(clusters: TreeCluster[], mode: GuestSortMode): TreeCluster[] {
  if (mode === 'vmid') return clusters

  return clusters.map(clu => ({
    ...clu,
    nodes: clu.nodes.map(n => ({ ...n, vms: [...n.vms].sort(compareGuestNames) })),
  }))
}
