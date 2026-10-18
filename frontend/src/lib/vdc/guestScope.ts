import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"

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
 * list confines nothing, so a vDC tenant is refused it.
 */
export async function checkTenantGuestsScope(
  tenantId: string,
  conn: Parameters<typeof pveFetch>[0],
  connectionId: string,
  type: string | null,
  node: string | null,
  vmids: readonly string[],
  allowMovedNode = false,
): Promise<NextResponse | null> {
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
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
