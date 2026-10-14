// src/lib/proxmox/nodeIpPersistence.ts
//
// The one rule for writing a discovered node address to ManagedHost, shared
// by the lightweight discovery (discoverNodeIps) and the nodes route. Both
// used to write whatever the last discovery answered, so a degraded answer
// took a working management address away from the failover candidate list
// (roadmap#51): a token that cannot see the node's bridges gets an interface
// list where a storage or VXLAN-transport VLAN is the only addressed entry,
// and a node that stops answering is replaced by its corosync link address
// from /cluster/status. Neither is routed from ProxCenter on many sites.

/** One node as a discovery saw it; `verified` as resolveManagementAddress defines it. */
export type DiscoveredNodeIp = { node: string; ip: string | null; verified: boolean }

/** The address a ManagedHost row holds. */
export type StoredNodeIp = { ip: string | null; ipVerified: boolean }

export type EffectiveNodeIp = { node: string; ip: string | null; ipVerified: boolean }

export type NodeIpDecision = { ip: string | null; ipVerified: boolean; changed: boolean }

/**
 * What a discovery may write over what is on file for one node.
 * - A verified address always lands: it was read off the management interface.
 * - A guess never replaces a verified address. It fills a blank and refreshes
 *   an older guess, so a node whose address was never read still gets a
 *   candidate, tried last.
 * - No address at all leaves the row alone: a transient failure must not null
 *   a known address (#695).
 */
export function decideNodeIp(stored: StoredNodeIp | undefined, found: DiscoveredNodeIp): NodeIpDecision {
  const current: StoredNodeIp = { ip: stored?.ip ?? null, ipVerified: stored?.ipVerified ?? true }

  if (!found.ip) return { ...current, changed: false }

  if (found.verified) {
    return { ip: found.ip, ipVerified: true, changed: current.ip !== found.ip || !current.ipVerified }
  }

  if (current.ip && current.ipVerified) return { ...current, changed: false }

  return { ip: found.ip, ipVerified: false, changed: current.ip !== found.ip || current.ipVerified }
}

/** Verified addresses first: failover tries a guess only once every management address failed. */
export function orderedIps(entries: Iterable<EffectiveNodeIp>): string[] {
  const verified: string[] = []
  const guessed: string[] = []
  for (const entry of entries) {
    if (!entry.ip) continue
    ;(entry.ipVerified ? verified : guessed).push(entry.ip)
  }
  return [...verified, ...guessed]
}

/** The subset of a Prisma client (global or tenant-scoped) the persistence needs. */
export type ManagedHostDb = {
  managedHost: {
    findMany: (args: any) => Promise<Array<{ node: string; ip: string | null; ipVerified: boolean }>>
    upsert: (args: any) => Promise<unknown>
    deleteMany: (args: any) => Promise<unknown>
  }
}

/**
 * Writes a discovery's node addresses for failover and returns what is now on
 * file, verified addresses first, for the in-memory candidate list. Rows of
 * nodes that left the cluster are dropped. `tenantId` is set on created rows
 * when the caller writes through the global client for another tenant's
 * connection (see lib/connections/assignment.ts).
 */
export async function persistNodeIps(
  db: ManagedHostDb,
  args: { connectionId: string; tenantId?: string; nodes: DiscoveredNodeIp[] },
): Promise<{ ips: string[]; byNode: Map<string, EffectiveNodeIp> }> {
  const { connectionId, tenantId, nodes } = args

  const stored = new Map<string, StoredNodeIp>()
  const rows = await db.managedHost.findMany({
    where: { connectionId },
    select: { node: true, ip: true, ipVerified: true },
  })
  for (const row of rows) stored.set(row.node, { ip: row.ip, ipVerified: row.ipVerified })

  const byNode = new Map<string, EffectiveNodeIp>()
  await Promise.all(
    nodes.map(async found => {
      const decision = decideNodeIp(stored.get(found.node), found)
      byNode.set(found.node, { node: found.node, ip: decision.ip, ipVerified: decision.ipVerified })
      await db.managedHost.upsert({
        where: { connectionId_node: { connectionId, node: found.node } },
        update: decision.changed ? { ip: decision.ip, ipVerified: decision.ipVerified } : {},
        create: {
          connectionId,
          node: found.node,
          ip: decision.ip,
          ipVerified: decision.ipVerified,
          ...(tenantId ? { tenantId } : {}),
        },
      })
    }),
  )

  if (nodes.length > 0) {
    await db.managedHost.deleteMany({
      where: { connectionId, node: { notIn: nodes.map(n => n.node) } },
    })
  }

  return { ips: orderedIps(byNode.values()), byNode }
}
