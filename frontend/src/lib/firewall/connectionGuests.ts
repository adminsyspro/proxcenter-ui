// src/lib/firewall/connectionGuests.ts
//
// The guests of a connection as the bounded per-guest firewall reads take them (the coverage, the security group
// usage): from the inventory the app already keeps, so listing them costs no Proxmox call when it is warm.
import { getInventoryFromCache } from '@/lib/cache/inventoryCache'
import { pveFetch } from '@/lib/proxmox/client'

import type { CoverageGuest } from './guestCoverage'

function toGuest(raw: any, offlineNodes: Set<string>): CoverageGuest | null {
  if (!raw || raw.template === 1 || raw.template === true) return null
  if (raw.type !== 'qemu' && raw.type !== 'lxc') return null
  if (raw.vmid === undefined || raw.vmid === null || !raw.node) return null

  return {
    vmid: String(raw.vmid),
    node: String(raw.node),
    type: raw.type,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    tags: parseTags(raw.tags),
    offline: offlineNodes.has(String(raw.node)),
  }
}

/** Proxmox gives the tags as one `;` separated string (the inventory keeps that form), lowercased. */
function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === 'string')
  if (typeof raw !== 'string') return []

  return raw.split(/[;,]/).map(t => t.trim()).filter(Boolean)
}

/** A node reported down; a node with no status at all is not taken for one. */
const isDown = (status: unknown) => typeof status === 'string' && status !== '' && status !== 'online'

/**
 * The guests of the connection, with the offline flag of their node: from the inventory the app already keeps (no
 * call), or one /cluster/resources read (guests and nodes) when it is cold. Only the union view of the tenant: a
 * vDC-narrowed entry holds a subset of the guests.
 */
export async function listConnectionGuests(tenantId: string, connectionId: string, conn: () => Promise<any>): Promise<CoverageGuest[]> {
  const cached = getInventoryFromCache(tenantId, null)
  const cluster = cached.status === 'miss' ? null : cached.data.clusters.find((c: any) => c?.id === connectionId)

  if (cluster) {
    const nodes: any[] = cluster.nodes ?? []
    const offline = new Set(nodes.filter(n => n?.node && isDown(n.status)).map(n => String(n.node)))
    const raw = nodes.flatMap(n => (n?.guests ?? []).map((g: any) => ({ ...g, node: g?.node ?? n?.node })))

    return raw.map(g => toGuest(g, offline)).filter((g): g is CoverageGuest => g !== null)
  }

  const resources: any[] = (await pveFetch<any[]>(await conn(), '/cluster/resources')) ?? []
  const offline = new Set(resources.filter(r => r?.type === 'node' && isDown(r.status)).map(r => String(r.node)))

  return resources.map(r => toGuest(r, offline)).filter((g): g is CoverageGuest => g !== null)
}
