import type { MapCluster, MapMember, PveNodeInfo } from './zoneGraph'
import { guestId, guestKey, memberId, type PolicyGuest, type ZoneMember } from './zoneModel'

/**
 * The key of a guest on the map: type and VMID on a policy of one cluster (the node IDs it always had), its `guestId`
 * on a shared policy, where two clusters can hold the same type and VMID.
 */
export const mapKey = (g: { connectionId: string; type: string; vmid: number }, shared: boolean) => (shared ? guestId(g) : guestKey(g))

/** How the map names the cluster of a guest on a shared policy; null on a policy of one cluster. */
export type ClusterOf = ((connectionId: string) => MapCluster) | null

/** A member of a zone as the map draws it, with its cluster on a shared policy. */
export function memberToMap(m: ZoneMember, clusterOf: ClusterOf): MapMember {
  return {
    key: clusterOf ? memberId(m) : guestKey(m.ref),
    name: m.guest?.name ?? `${m.ref.type}/${m.ref.vmid}`,
    vmid: m.ref.vmid,
    node: m.ref.node,
    type: m.ref.type,
    status: m.guest?.status ?? 'unknown',
    ips: m.guest?.ips ?? [],
    pending: m.pending,
    ...(clusterOf ? { cluster: clusterOf(m.connectionId) } : {}),
  }
}

/** A guest of the inventory as the map draws it (a running guest in no zone), with its cluster on a shared policy. */
export function guestToMap(g: PolicyGuest, clusterOf: ClusterOf): MapMember {
  return {
    key: mapKey(g, !!clusterOf), name: g.name, vmid: g.vmid, node: g.node, type: g.type, status: g.status, ips: g.ips ?? [], pending: false,
    ...(clusterOf ? { cluster: clusterOf(g.connectionId) } : {}),
  }
}

/**
 * The guests the map draws: the members of each zone, and the running guests that are no member of any zone, of every
 * cluster read (a guest is matched on its cluster, type and VMID, so the same VMID on another cluster is another guest).
 */
export function mapGuests(
  membersByZone: ReadonlyMap<string, ZoneMember[]>, guests: readonly PolicyGuest[], clusterOf: ClusterOf,
): { members: Map<string, MapMember[]>; unzoned: MapMember[] } {
  const members = new Map([...membersByZone].map(([id, list]) => [id, list.map(m => memberToMap(m, clusterOf))]))
  const zoned = new Set([...membersByZone.values()].flatMap(list => list.map(memberId)))
  const unzoned = guests.filter(g => g.status === 'running' && !zoned.has(guestId(g))).map(g => guestToMap(g, clusterOf))
  return { members, unzoned }
}

/**
 * The Proxmox nodes of one cluster as the page read them (absent: not read, the nodes of its guests are drawn) and the
 * status of each node it knows.
 */
export type ClusterNodeList = { id: string; nodes?: readonly string[]; status?: Readonly<Record<string, string>> }

/**
 * The Proxmox nodes of the node view and the guests each holds (running or not, in a zone or not): per cluster, the
 * nodes the page knows (empty ones too), then those of its guests. On a shared policy each node says its cluster, and
 * a cluster's guests count on its own nodes only; on one cluster every guest counts, as the map always did.
 */
export function mapPveNodes(guests: readonly PolicyGuest[], lists: readonly ClusterNodeList[], shared: boolean): PveNodeInfo[] {
  return lists.flatMap(list => {
    const count = new Map<string, number>((list.nodes ?? []).map(node => [node, 0]))
    for (const g of guests) if (g.node && (!shared || g.connectionId === list.id)) count.set(g.node, (count.get(g.node) ?? 0) + 1)
    return [...count].map(([node, n]) => ({ node, guests: n, status: list.status?.[node], ...(shared ? { cluster: list.id } : {}) }))
  })
}
