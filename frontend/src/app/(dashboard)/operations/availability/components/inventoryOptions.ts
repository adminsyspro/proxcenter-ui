export interface GuestOption {
  key: string
  connectionId: string
  connectionName: string
  vmid: number
  name: string | null
  type: 'qemu' | 'lxc'
  node: string
  /** running, stopped..., as the inventory reports it. */
  status?: string
}

export interface ConnectionOption {
  id: string
  name: string
  nodes: string[]
}

export interface InventoryOptions {
  connections: ConnectionOption[]
  guests: GuestOption[]
  tags: string[]
  pools: string[]
}

export const guestKey = (connectionId: string, vmid: number) => `${connectionId}:${vmid}`

/** Selectable guests, tags and pools of the inventory the tenant already sees (GET /api/v1/inventory). */
export function inventoryOptions(data: any): InventoryOptions {
  const connections: ConnectionOption[] = []
  const guests: GuestOption[] = []
  const tags = new Set<string>()
  const pools = new Set<string>()

  for (const cluster of data?.data?.clusters ?? []) {
    connections.push({ id: cluster.id, name: cluster.name, nodes: (cluster.nodes ?? []).map((n: any) => n.node) })

    for (const pool of cluster.pools ?? []) if (pool?.poolid) pools.add(pool.poolid)

    for (const node of cluster.nodes ?? []) {
      for (const g of node.guests ?? []) {
        if (g.template === 1 || g.template === true) continue
        if (g.type !== 'qemu' && g.type !== 'lxc') continue

        const vmid = Number(g.vmid)

        guests.push({
          key: guestKey(cluster.id, vmid),
          connectionId: cluster.id,
          connectionName: cluster.name,
          vmid,
          name: g.name || null,
          type: g.type,
          node: node.node,
          status: typeof g.status === 'string' ? g.status : undefined,
        })

        if (g.pool) pools.add(g.pool)

        for (const tag of String(g.tags ?? '').split(';')) if (tag.trim()) tags.add(tag.trim())
      }
    }
  }

  const byName = (a: string, b: string) => a.localeCompare(b)

  return { connections, guests, tags: [...tags].sort(byName), pools: [...pools].sort(byName) }
}
