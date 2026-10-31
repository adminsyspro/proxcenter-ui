/**
 * Host permissions for the tools that read a host (#459).
 *
 * The snapshot shows a host to anyone who can see one guest on it: a user
 * granted a single VM has that VM's host in their inventory. Seeing a host in
 * the inventory is not the right to read its hardware, network or history, so
 * a tool reading one of those asks the permission its page route asks.
 */

import { buildNodeResourceId, checkPermission, PERMISSIONS } from '@/lib/rbac'

import { ToolScopeError } from './types'

/** Whether the caller holds `permission` on that host, as the node routes check it. */
export async function hasNodePermission(permission: string, connId: string, node: string): Promise<boolean> {
  return !(await checkPermission(permission, 'node', buildNodeResourceId(connId, node)))
}

/** node.view on the host, the right the host status and RRD routes ask. */
export async function requireNodeView(connId: string, node: string): Promise<void> {
  if (!(await hasNodePermission(PERMISSIONS.NODE_VIEW, connId, node))) {
    throw new ToolScopeError(`You do not have the permission to view the details of host ${node}.`)
  }
}
