import { NextResponse } from "next/server"

import type { PveConn } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { checkPermission, filterVmsByPermission, getRBACContext, PERMISSIONS } from "@/lib/rbac"
import { sessionGuestVisibility } from "@/lib/vdc/guestGuard"

import {
  buildTagPolicy, changedTags, findTagDenial, parseTagAccessConfig, policyNeedsGuestTags, splitTags,
  type TagPolicy,
} from "./tagAccess"

/** Managing the connection is ProxCenter's equivalent of PVE's Sys.Modify on `/`. */
export async function isTagPrivileged(connId: string): Promise<boolean> {
  return (await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", connId)) === null
}

/** The guests the current session can see on this connection, like PVE's VM.Audit filter. */
export async function visibleGuests(connId: string, conn: PveConn): Promise<any[]> {
  const raw = await pveFetch<any[]>(conn, "/cluster/resources?type=vm")
  const resources = Array.isArray(raw) ? raw : []
  const scoped = await sessionGuestVisibility({ connectionId: connId, conn, resources })
  if (!scoped.ok || !scoped.visibility) return []
  const visibility = scoped.visibility
  const guests = resources.filter(r => (r?.type === "qemu" || r?.type === "lxc") && visibility.has(r.type, r.vmid))

  const rbacCtx = await getRBACContext()
  if (!rbacCtx) return []
  if (rbacCtx.isAdmin) return guests
  const withMeta = guests.map(g => ({ ...g, connId, vmid: String(g.vmid) }))
  return filterVmsByPermission(rbacCtx.principal ?? String(rbacCtx.userId), withMeta, PERMISSIONS.VM_VIEW, rbacCtx.tenantId)
}

/**
 * The policy that applies to the current session on this connection.
 * `visibleGuestCount` is null when the guests were not needed and not read.
 */
export async function loadTagPolicy(
  connId: string,
  conn: PveConn,
  opts: { guestTags: "always" | "when-needed"; privileged?: boolean },
): Promise<{ policy: TagPolicy; visibleGuestCount: number | null }> {
  const [privileged, options] = await Promise.all([
    opts.privileged ?? isTagPrivileged(connId),
    pveFetch<Record<string, unknown>>(conn, "/cluster/options"),
  ])
  const config = parseTagAccessConfig(options)
  const guests = opts.guestTags === "always" || policyNeedsGuestTags(config, privileged)
    ? await visibleGuests(connId, conn)
    : null
  return {
    policy: buildTagPolicy(config, privileged, (guests ?? []).flatMap(g => splitTags(g.tags))),
    visibleGuestCount: guests ? guests.length : null,
  }
}

/**
 * Applies the datacenter User Tag Access and Registered Tags to a tag change
 * (#1208). Returns a 403 for the first tag the user may not add or remove.
 */
export async function enforceGuestTagAccess(input: {
  connId: string
  conn: PveConn
  oldTags: unknown
  newTags: unknown
}): Promise<NextResponse | null> {
  if (changedTags(input.oldTags, input.newTags).length === 0) return null
  if (await isTagPrivileged(input.connId)) return null

  const { policy } = await loadTagPolicy(input.connId, input.conn, { guestTags: "when-needed", privileged: false })
  const denial = findTagDenial(policy, input.oldTags, input.newTags)
  if (!denial) return null

  const error = denial.reason === "registered"
    ? `Tag '${denial.tag}' is a registered tag: only users who can manage this connection may add or remove it`
    : `Tag '${denial.tag}' is not allowed by the datacenter User Tag Access setting (${policy.userAllow})`
  return NextResponse.json({ error, code: "TAG_ACCESS_DENIED", tag: denial.tag }, { status: 403 })
}
