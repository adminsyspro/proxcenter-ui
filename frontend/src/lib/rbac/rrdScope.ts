// src/lib/rbac/rrdScope.ts
//
// Maps a Proxmox RRD path to the RBAC permission + resource it should be
// gated on. RRD endpoints used to gate on a connection-SCOPED `connection.view`
// (checkPermission(CONNECTION_VIEW, "connection", id)), which a VM- or
// node-scoped user can never satisfy — scopeMatches() only lines a vm/node
// grant up against a vm/node resource, never against a "connection" resource.
// The result was a 403 ("RRD: Permission denied: connection.view") on the
// Performance tab for VM Admin / VM User / Viewer users assigned at a narrow
// scope, even for VMs they can see in the inventory (issue #378 follow-up).
//
// We instead gate on the resource the path actually addresses — the same model
// the inventory list (vm.view / node.view filtered) already uses, so a user who
// can see a VM/node can see its graphs and one who can't never reaches the tab.
//
// Path shapes (always /nodes/<node>... per the RRD routes):
//   /nodes/<node>                     -> node   -> node.view
//   /nodes/<node>/qemu/<vmid>         -> vm     -> vm.view
//   /nodes/<node>/lxc/<vmid>          -> vm     -> vm.view
//   /nodes/<node>/storage/<store>     -> node   -> node.view

import { PERMISSIONS, buildVmResourceId, buildNodeResourceId } from "@/lib/rbac"

export interface RrdScope {
  permission: string
  resourceType: "vm" | "node"
  resourceId: string
}

/**
 * Resolve the RBAC scope an RRD path must be checked against. Pure, no DB.
 * Returns null when the path is not a valid /nodes/<node>... RRD path.
 *
 * Parsed by splitting on "/" (no regex) to avoid a ReDoS hotspot.
 */
export function resolveRrdScope(connId: string, path: string): RrdScope | null {
  // ["nodes", "<node>", maybe "qemu"|"lxc"|"storage"|..., maybe "<vmid>", ...]
  const parts = path.split("/").filter(Boolean)
  if (parts[0] !== "nodes" || !parts[1]) return null

  const node = parts[1]
  const kind = parts[2]
  const vmid = parts[3]

  if ((kind === "qemu" || kind === "lxc") && vmid) {
    return {
      permission: PERMISSIONS.VM_VIEW,
      resourceType: "vm",
      resourceId: buildVmResourceId(connId, node, kind, vmid),
    }
  }

  // Bare node, storage-on-node, or anything else under /nodes/<node>: a
  // node-level resource. node.view is the inventory gate for node detail too.
  return {
    permission: PERMISSIONS.NODE_VIEW,
    resourceType: "node",
    resourceId: buildNodeResourceId(connId, node),
  }
}
