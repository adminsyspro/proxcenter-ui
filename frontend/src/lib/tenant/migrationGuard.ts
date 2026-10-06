import { NextResponse } from "next/server"

import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, canMigrateConnections } from "@/lib/tenant/infraScope"

/**
 * VM placement is a whole-cluster operation: the provider may migrate any
 * cluster it manages; an MSP tenant may migrate within a cluster it OWNS;
 * vDC/iaas tenants get an abstracted slice and cannot migrate. Shared by the
 * migrate route and its preflight checks, so they answer the same callers.
 */
export async function migrationTenantDenied(connectionId: string): Promise<Response | null> {
  const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
  if (canMigrateConnections(infra, connectionId)) return null

  return NextResponse.json(
    { error: 'Migration is restricted to the provider or the MSP tenant that owns this connection' },
    { status: 403 },
  )
}
