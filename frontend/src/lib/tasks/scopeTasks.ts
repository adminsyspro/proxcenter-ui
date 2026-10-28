import { isFlatRecordVisible, type RbacInfraScope } from '@/lib/rbac/infraScope'

import { extractTaskVmid } from './scope'

/**
 * Keep the PVE tasks of one connection the caller may see, the same three
 * gates for the live Events feed and the task archive:
 * - vDC nodes: drop tasks that ran on a node outside the tenant's set;
 * - vDC pools: on a shared-node cluster the node gate is a no-op, so a task
 *   must target a tenant vmid (cluster or node level tasks such as ceph or
 *   package updates are provider-only);
 * - RBAC infra scope: only tasks on a granted node or a granted guest.
 */
export function scopeConnectionTasks<T extends { node?: string; id?: string }>(
  tasks: T[],
  ctx: {
    connId: string
    allowedNodes?: Set<string>
    allowedVmids?: Set<string>
    rbacScope: RbacInfraScope | null
  },
): T[] {
  let scoped = tasks

  if (ctx.allowedNodes) {
    const nodes = ctx.allowedNodes

    scoped = scoped.filter(t => !t.node || nodes.has(t.node))
  }

  if (ctx.allowedVmids) {
    const vmids = ctx.allowedVmids

    scoped = scoped.filter(t => {
      const vmid = extractTaskVmid(t.id)

      return vmid !== null && vmids.has(vmid)
    })
  }

  if (ctx.rbacScope) {
    const rbac = ctx.rbacScope

    scoped = scoped.filter(t => isFlatRecordVisible(rbac, { connId: ctx.connId, node: t.node, vmid: extractTaskVmid(t.id) }))
  }

  return scoped
}
