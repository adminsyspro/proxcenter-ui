import { isMicrosegSubTab, type MicrosegSubTab } from './components/microseg/microsegTabTypes'

/** The tabs of /automation/network as a link names them (`?tab=`), in the order of the page. */
export const NETWORK_TABS = ['dashboard', 'microseg', 'firewalling', 'logging', 'groups', 'ipsets', 'aliases'] as const
/** The index of each tab by its link name: the page compares `activeTab` to these, never to a number. */
export const TAB = Object.fromEntries(NETWORK_TABS.map((name, i) => [name, i])) as Record<(typeof NETWORK_TABS)[number], number>
export const MICROSEG_TAB_INDEX = TAB.microseg

/** What a link to the page asks: `?tab=`, `?connection=`, `?sub=` (Micro-segmentation) and `?vm=`. */
export type NetworkLink = {
  /** Index of the tab, null when the link names none (or an unknown one). */
  tab: number | null
  /** The Micro-segmentation sub-tab to open on. */
  sub: MicrosegSubTab | null
  connection: string | null
  /** A VMID: the Micro-segmentation Overview targeted on that guest. */
  vm: number | null
}

const text = (params: Pick<URLSearchParams, 'get'> | null, name: string) => params?.get(name)?.trim() || null

/**
 * Reads the link once, on load. `?vm=` opens Micro-segmentation > Overview whatever `tab` and `sub` say; `sub` only
 * counts on the Micro-segmentation tab.
 */
export function parseNetworkLink(params: Pick<URLSearchParams, 'get'> | null): NetworkLink {
  const rawVm = text(params, 'vm')
  const vm = rawVm && /^\d+$/.test(rawVm) ? Number(rawVm) : null
  const connection = text(params, 'connection')
  if (vm !== null) return { tab: MICROSEG_TAB_INDEX, sub: 'overview', connection, vm }

  const index = NETWORK_TABS.indexOf(text(params, 'tab') as (typeof NETWORK_TABS)[number])
  const tab = index >= 0 ? index : null
  const sub = text(params, 'sub')
  return { tab, sub: tab === MICROSEG_TAB_INDEX && isMicrosegSubTab(sub) ? sub : null, connection, vm: null }
}

const CONNECTION_KEY = 'network.connection'

/** The connection last selected on the page, kept in the browser; null when none, or storage is blocked. */
export function readStoredConnection(): string | null {
  try {
    return window.localStorage.getItem(CONNECTION_KEY) || null
  } catch {
    return null
  }
}

export function storeConnection(id: string) {
  try {
    window.localStorage.setItem(CONNECTION_KEY, id)
  } catch {
    // Private window or blocked storage: the choice just is not remembered.
  }
}

/** The first candidate that is one of the connections, else the first connection ('' while there is none). */
export function pickConnection(connections: ReadonlyArray<{ id: string }>, candidates: ReadonlyArray<string | null | undefined>): string {
  const ids = new Set(connections.map(c => c.id))
  return candidates.find((id): id is string => !!id && ids.has(id)) ?? connections[0]?.id ?? ''
}

type InventoryTree = { data?: { clusters?: { id?: string; nodes?: { guests?: { vmid?: string | number }[] }[] }[] } }

/** The connection whose inventory holds this VMID; null when none does. */
export function connectionOfVm(inventory: InventoryTree | undefined, vmid: number): string | null {
  const cluster = inventory?.data?.clusters?.find(c => c.nodes?.some(n => n.guests?.some(g => Number(g.vmid) === vmid)))
  return cluster?.id ?? null
}
