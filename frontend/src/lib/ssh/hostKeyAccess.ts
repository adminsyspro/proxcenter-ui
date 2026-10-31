// src/lib/ssh/hostKeyAccess.ts
//
// Which pinned SSH host keys a caller may list or forget. Both TOFU stores
// are installation-wide and keyed by bare host, so the permission alone says
// nothing about WHICH host: a grant scoped to one connection, or a customer
// tenant's admin, would otherwise list the provider's node addresses and clear
// their pins, after which the next connection trusts whatever key it is shown.
//
// A host belongs to a connection when it is one of its nodes (stored address
// or SSH override) or its API host. A caller holding the permission across the
// whole provider tenant reaches every pin, the ones of no connection included
// (a removed node); anyone else reaches the hosts of the connections of their
// tenant they hold the permission on, minus any address that ALSO belongs to a
// connection they do not: a tenant sets its own SSH override and its cluster
// reports its own node addresses, so naming a provider node there must not
// hand over that node's pin.

import { prisma } from "@/lib/db/prisma"
import { checkPermission, getRBACContext, holdsBroadPermission } from "@/lib/rbac"
import { getSessionPrisma, requireProviderTenant } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { managedHostSshEndpoint } from "./node-endpoint-core"

/** `all`: every pin, `hosts` then unused; otherwise only the bare hosts listed. */
export type HostKeyScope = { all: boolean; hosts: ReadonlySet<string> }

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/^\[(.*)\]$/, "$1")
}

function apiHost(baseUrl: string | null | undefined): string {
  try {
    return baseUrl ? normalizeHost(new URL(baseUrl).hostname) : ""
  } catch {
    return ""
  }
}

type ConnectionAddresses = {
  baseUrl: string | null
  sshPort: number | null
  hosts: Array<{ ip: string | null; sshAddress: string | null; sshPort: number | null }>
}

function connectionHosts(conn: ConnectionAddresses): string[] {
  const out = [apiHost(conn.baseUrl)]
  for (const h of conn.hosts) {
    out.push(normalizeHost(h.ip), normalizeHost(managedHostSshEndpoint(h, conn.sshPort).host))
  }
  return out
}

export async function hostKeyScope(permission: string): Promise<HostKeyScope> {
  const ctx = await getRBACContext()
  if (ctx?.userId && !(await requireProviderTenant())) {
    if (await holdsBroadPermission(ctx.userId, DEFAULT_TENANT_ID, permission, null)) return { all: true, hosts: new Set() }
  }

  const sessionPrisma = await getSessionPrisma()
  const own = await sessionPrisma.connection.findMany({ where: { type: "pve" }, select: { id: true } })
  const granted = new Set<string>()
  for (const conn of own) {
    if (!(await checkPermission(permission, "connection", conn.id))) granted.add(conn.id)
  }

  // Every connection of the installation (PBS and the other sources included),
  // to tell the caller's addresses from the ones another connection answers on.
  const all = await prisma.connection.findMany({
    select: { id: true, baseUrl: true, sshPort: true, hosts: true },
  })
  const hosts = new Set<string>()
  const foreign = new Set<string>()
  for (const conn of all) {
    const target = granted.has(conn.id) ? hosts : foreign
    for (const host of connectionHosts(conn)) target.add(host)
  }
  for (const host of foreign) hosts.delete(host)
  hosts.delete("")

  return { all: false, hosts }
}

export function hostKeyInScope(scope: HostKeyScope, host: string): boolean {
  return scope.all || scope.hosts.has(normalizeHost(host))
}
