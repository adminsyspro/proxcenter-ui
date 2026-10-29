import { fetchRrdBatch } from '@/app/(dashboard)/infrastructure/inventory/helpers'

/** Proxmox keeps the hour timeframe at one point per minute: polling faster returns the same rows. */
export const RRD_REFRESH_MS = 60_000

export interface RrdGuest {
  vmid: number
  name: string
  type: 'qemu' | 'lxc'
  node: string
  template?: boolean
  connId: string
}

export interface VmSeries { key: string; name: string; raw: any[] }

export const guestKey = (g: RrdGuest) => `${g.connId}:${g.type}:${g.vmid}`

const guestRrdPath = (g: RrdGuest) => `/nodes/${g.node}/${g.type}/${g.vmid}`

/**
 * The last hour of RRD for every guest of the vDC but templates (no metrics),
 * in one batch request per connection. A guest that is stopped now still gets
 * the points it has from earlier in the hour. A connection whose request fails
 * leaves its guests without points. Sorted by name, so each guest keeps its
 * color from one refresh to the next.
 */
export async function fetchGuestSeries(guests: RrdGuest[], signal?: AbortSignal): Promise<VmSeries[]> {
  const targets = guests.filter(g => !g.template)
  const byConn = new Map<string, RrdGuest[]>()

  for (const g of targets) {
    const list = byConn.get(g.connId)

    if (list) list.push(g)
    else byConn.set(g.connId, [g])
  }

  const rows = new Map<string, any[]>()

  await Promise.all([...byConn].map(async ([connId, list]) => {
    try {
      const data = await fetchRrdBatch(connId, list.map(guestRrdPath), 'hour', signal)

      for (const g of list) rows.set(guestKey(g), data.get(guestRrdPath(g)) ?? [])
    } catch {
      // Guests of this connection stay without points until the next refresh.
    }
  }))

  return targets
    .map(g => ({ key: guestKey(g), name: g.name, raw: rows.get(guestKey(g)) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
