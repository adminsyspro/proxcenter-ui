import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"

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
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
  if (infra.kind !== 'iaas') return null
  const scope = maskingScope(infra)
  const nodes = scope?.nodesByConnection.get(connectionId)
  const pools = scope?.poolsByConnection.get(connectionId)
  if (!scope?.connectionIds.has(connectionId) || !nodes || (node !== null && !nodes.has(node)) || !pools?.size) {
    return NextResponse.json({ error: 'Guest outside your vDC scope' }, { status: 403 })
  }

  let resources: unknown
  try {
    resources = await pveFetch<unknown>(conn, '/cluster/resources?type=vm')
  } catch {
    return NextResponse.json({ error: 'Unable to verify guest vDC scope' }, { status: 503 })
  }
  if (!Array.isArray(resources)) {
    return NextResponse.json({ error: 'Unable to verify guest vDC scope' }, { status: 503 })
  }
  const guest = resources.find(row => (type === null || row?.type === type) && String(row?.vmid) === vmid)
  if (!guest || !nodes.has(guest.node) || !guest.pool || !pools.has(guest.pool) ||
    (!allowMovedNode && node !== null && guest.node !== node)) {
    return NextResponse.json({ error: 'Guest outside your vDC scope' }, { status: 403 })
  }
  return null
}
