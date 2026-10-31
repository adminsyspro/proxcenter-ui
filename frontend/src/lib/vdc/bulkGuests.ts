// src/lib/vdc/bulkGuests.ts
//
// The bulk guest lookups (POST /vms/ips, POST /vms/networks) take their guest
// list from the request body. Three rules apply to every entry before PVE is
// called: its identifiers must be well formed, since they are written into the
// PVE URL, the caller must hold vm.view on that guest, and a vDC session only
// gets the guests of its own pools, as on the routes that address one guest
// (guardSessionGuest).

import type { PveConn } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { filterVmsByPermission, getRBACContext, PERMISSIONS } from "@/lib/rbac"

import { isGuestType, isNodeName, isVmid, sessionGuestVisibility, type GuestType } from "./guestGuard"

export type BulkGuestRef = {
  type: GuestType
  node: string
  vmid: string
  status?: string
}

/**
 * Groups the requested guests by connection id. A malformed entry (unknown
 * type, invalid node name, non-numeric vmid) is dropped like an unknown guest.
 */
export function groupGuestsByConnection(raw: unknown): Map<string, BulkGuestRef[]> {
  const byConnection = new Map<string, BulkGuestRef[]>()
  if (!Array.isArray(raw)) return byConnection

  for (const vm of raw) {
    const connId = vm?.connId
    const vmid = vm?.vmid === undefined || vm?.vmid === null ? "" : String(vm.vmid)
    if (typeof connId !== "string" || !connId || !isGuestType(vm.type) || !isNodeName(vm.node) || !isVmid(vmid)) {
      continue
    }

    const ref: BulkGuestRef = { type: vm.type, node: vm.node, vmid }
    if (typeof vm.status === "string") ref.status = vm.status

    const list = byConnection.get(connId)
    if (list) list.push(ref)
    else byConnection.set(connId, [ref])
  }

  return byConnection
}

/**
 * The requested guests of one connection the session may see. A non-admin
 * caller keeps the guests its vm.view grants cover, matched on the pool and
 * tags PVE reports for each guest, never on the body (the same per-guest RBAC
 * as the inventory list). A vDC session then keeps the ones in its pools. One
 * guest list read per connection, whatever the number of guests. Null when
 * the visibility cannot be established: the caller then answers nothing for
 * that connection rather than an unfiltered list.
 */
export async function visibleRequestedGuests(
  connectionId: string,
  conn: PveConn,
  guests: BulkGuestRef[],
): Promise<BulkGuestRef[] | null> {
  let allowed = guests
  let resources: any[] | undefined
  const rbacCtx = await getRBACContext()
  if (rbacCtx && !rbacCtx.isAdmin) {
    try {
      resources = await pveFetch<any[]>(conn, "/cluster/resources?type=vm")
    } catch {
      return null
    }
    const meta = new Map((Array.isArray(resources) ? resources : []).map(r => [`${r.type}:${r.vmid}`, r]))
    const withMeta = guests.map(g => ({ ...g, connId: connectionId, pool: meta.get(`${g.type}:${g.vmid}`)?.pool, tags: meta.get(`${g.type}:${g.vmid}`)?.tags }))
    const kept = new Set(
      (await filterVmsByPermission(rbacCtx.principal ?? (rbacCtx.userId as string), withMeta, PERMISSIONS.VM_VIEW, rbacCtx.tenantId))
        .map(g => `${g.type}:${g.node}:${g.vmid}`),
    )
    allowed = guests.filter(g => kept.has(`${g.type}:${g.node}:${g.vmid}`))
  }
  const scoped = await sessionGuestVisibility({ connectionId, conn, resources })
  if (!scoped.ok || !scoped.visibility) return null
  const visibility = scoped.visibility
  return visibility.all ? allowed : allowed.filter(g => visibility.has(g.type, g.vmid))
}
