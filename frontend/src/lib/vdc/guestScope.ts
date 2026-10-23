import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getTenantInfrastructureScope, maskingScope, type InfraScope } from "@/lib/tenant/infraScope"

const outside = () => NextResponse.json({ error: 'Guest outside your vDC scope' }, { status: 403 })
const unverifiable = () => NextResponse.json({ error: 'Unable to verify guest vDC scope' }, { status: 503 })

/**
 * VM grants remain inside the tenant's live vDC node/pool boundary.
 * `type` null = any guest type, `node` null = any node of the vDC (callers
 * that only know the vmid, e.g. a vmid carried in a request body).
 */
export async function checkTenantGuestScope(
  tenantId: string,
  conn: Parameters<typeof pveFetch>[0],
  connectionId: string,
  type: string | null,
  node: string | null,
  vmid: string,
  allowMovedNode = false,
): Promise<NextResponse | null> {
  return checkTenantGuestsScope(tenantId, conn, connectionId, type, node, [vmid], allowMovedNode)
}

/**
 * checkTenantGuestScope for a vmid list (a vzdump `vmid` list): the vDC scope
 * and the cluster guests are read once, every guest must be inside. An empty
 * list confines nothing, so a vDC tenant is refused it. A caller that already
 * resolved the tenant's infrastructure scope passes it as `infra`.
 */
export async function checkTenantGuestsScope(
  tenantId: string,
  conn: Parameters<typeof pveFetch>[0],
  connectionId: string,
  type: string | null,
  node: string | null,
  vmids: readonly string[],
  allowMovedNode = false,
  infra?: InfraScope,
): Promise<NextResponse | null> {
  infra ??= await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
  if (infra.kind !== 'iaas') return null
  const scope = maskingScope(infra)
  const nodes = scope?.nodesByConnection.get(connectionId)
  const pools = scope?.poolsByConnection.get(connectionId)
  if (!scope?.connectionIds.has(connectionId) || !nodes || (node !== null && !nodes.has(node)) || !pools?.size ||
    vmids.length === 0) {
    return outside()
  }

  let resources: unknown
  try {
    resources = await pveFetch<unknown>(conn, '/cluster/resources?type=vm')
  } catch {
    return unverifiable()
  }
  if (!Array.isArray(resources)) return unverifiable()
  for (const vmid of vmids) {
    const guest = resources.find(row => (type === null || row?.type === type) && String(row?.vmid) === vmid)
    if (!guest || !nodes.has(guest.node) || !guest.pool || !pools.has(guest.pool) ||
      (!allowMovedNode && node !== null && guest.node !== node)) {
      return outside()
    }
  }
  return null
}

/** Which guests of a cluster a tenant may see; `all` is the unmasked provider/MSP view. */
export type GuestVisibility = {
  all: boolean
  /** `type` null = either guest type (a bare vmid). */
  has: (type: string | null, vmid: string | number) => boolean
}

export const EVERY_GUEST: GuestVisibility = { all: true, has: () => true }
const NO_GUEST: GuestVisibility = { all: false, has: () => false }

/**
 * The guests of `connectionId` a tenant may see: everything for a provider or
 * MSP tenant, the guests of its vDC pools on its vDC nodes for an iaas one.
 * Cluster-wide lists (snapshots, HA, replication, ...) mask their per-guest
 * rows with it. One /cluster/resources read, or the caller's own copy of it
 * (`resources`, any shape of that listing); 503 when the guests cannot be
 * listed, so nothing is shown unverified.
 */
export async function tenantGuestVisibility(
  tenantId: string,
  conn: Parameters<typeof pveFetch>[0],
  connectionId: string,
  opts: { infra?: InfraScope; resources?: unknown } = {},
): Promise<GuestVisibility | NextResponse> {
  const infra = opts.infra ?? await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
  if (infra.kind !== 'iaas') return EVERY_GUEST
  const scope = maskingScope(infra)
  const nodes = scope?.nodesByConnection.get(connectionId)
  const pools = scope?.poolsByConnection.get(connectionId)
  if (!scope?.connectionIds.has(connectionId) || !nodes || !pools?.size) return NO_GUEST

  let resources = opts.resources
  if (resources === undefined) {
    try {
      resources = await pveFetch<unknown>(conn, '/cluster/resources?type=vm')
    } catch {
      return unverifiable()
    }
  }
  if (!Array.isArray(resources)) return unverifiable()
  const keys = new Set<string>()
  for (const row of resources) {
    if ((row?.type === 'qemu' || row?.type === 'lxc') && nodes.has(row.node) && row.pool && pools.has(row.pool)) {
      keys.add(`${row.type}:${row.vmid}`)
    }
  }
  return {
    all: false,
    has: (type, vmid) => type === null
      ? keys.has(`qemu:${vmid}`) || keys.has(`lxc:${vmid}`)
      : keys.has(`${type}:${vmid}`),
  }
}
