import { buildNodeResourceId, checkPermission, PERMISSIONS } from "@/lib/rbac"

/**
 * The drains whose node the caller may view (#248). A drain names every guest
 * of its node, so listing it needs the same right as reading it on its own:
 * the list routes and the Task Center apply this on top of the cluster check.
 */
export async function filterViewableDrains<T extends { connection_id?: string; node?: string }>(drains: T[]): Promise<T[]> {
  const verdicts = await Promise.all(drains.map(async d => {
    // A drain with no node to check was already settled by the cluster
    // check (provider only).
    if (!d.connection_id || !d.node) return true
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", buildNodeResourceId(d.connection_id, d.node))

    return !denied
  }))

  return drains.filter((_, i) => verdicts[i])
}

/**
 * A drain as the browser may see it: the orchestrator already strips the SSH
 * access it was given (and never stores it), this drops it again on the way
 * out so a regression there could not expose it (#248).
 */
export function publicDrain<T>(drain: T): T {
  if (!drain || typeof drain !== "object") return drain
  const d = drain as Record<string, any>
  if (!d.config || typeof d.config !== "object") return drain
  const { ssh_credentials: _creds, ssh_overrides: _overrides, ...config } = d.config

  return { ...d, config } as T
}

export class DrainTargetDenied extends Error {}

/**
 * The target nodes a drain may use for the caller (#248). Draining needs the
 * right to manage the drained node, and every node a guest lands on too: a
 * forced target the caller does not manage is refused, and in automatic
 * placement the nodes it does not manage are excluded. Returns the config
 * with those exclusions merged in.
 */
export async function restrictDrainTargets<C extends { target_node?: string; exclude_nodes?: string[]; guest_targets?: Record<string, string> }>(
  prisma: { managedHost: { findMany: (args: any) => Promise<Array<{ node: string }>> } },
  connectionId: string,
  sourceNode: string,
  config: C,
): Promise<C> {
  const hosts = await prisma.managedHost.findMany({ where: { connectionId }, select: { node: true } })
  const nodes = [...new Set(hosts.map(h => h.node))].filter(n => n && n !== sourceNode)
  const managed = await Promise.all(nodes.map(async n =>
    !(await checkPermission(PERMISSIONS.NODE_MANAGE, "node", buildNodeResourceId(connectionId, n)))))
  const denied = nodes.filter((_, i) => !managed[i])

  // Every target the operator imposed, for all guests or one by one.
  const imposed = [...new Set([config.target_node, ...Object.values(config.guest_targets || {})].filter((n): n is string => !!n))]
  for (const target of imposed) {
    const allowed = !(await checkPermission(PERMISSIONS.NODE_MANAGE, "node", buildNodeResourceId(connectionId, target)))
    if (!allowed) throw new DrainTargetDenied(`You cannot manage the target node ${target}`)
  }
  if (denied.length === 0) return config

  return { ...config, exclude_nodes: [...new Set([...(config.exclude_nodes || []), ...denied])] }
}
