// src/lib/connections/assignment.ts
import { prisma } from '@/lib/db/prisma'

/**
 * Atomically move a connection from the provider pool (tenant_id='default')
 * to an MSP tenant. PVE connections are pooled, so their provider_connections
 * row is removed first (the FK ON DELETE RESTRICT aborts if any vDC still
 * references it). Non-PVE (PBS) connections are not pooled. The UPDATE is
 * predicated on tenant_id='default' so a concurrent assignment cannot win.
 */
export async function assignConnectionToMspTenant(connectionId: string, targetTenantId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // SELECT ... FOR UPDATE via Prisma ORM (the adapter handles schema routing)
    const conn = await (tx as any).connection.findUnique({
      where: { id: connectionId },
      select: { id: true, tenantId: true, type: true },
    })
    if (!conn) throw new Error(`Connection ${connectionId} not found`)
    if (conn.tenantId !== 'default') {
      throw new Error(`Connection ${connectionId} is already owned by tenant ${conn.tenantId}`)
    }
    if (conn.type !== 'pve') {
      const bindingCount = await (tx as any).vdcPbsNamespace.count({ where: { pbsConnectionId: connectionId } })
      if (bindingCount > 0) {
        throw new Error(`Connection ${connectionId} has vDC PBS namespace bindings; remove them before assigning it to a tenant`)
      }
    }
    if (conn.type === 'pve') {
      await (tx as any).providerConnection.delete({ where: { connectionId } })
    }
    await (tx as any).connection.update({
      where: { id: connectionId, tenantId: 'default' },
      data: { tenantId: targetTenantId },
    })
    await (tx as any).managedHost.updateMany({ where: { connectionId }, data: { tenantId: targetTenantId } })
  })
}

/** Reverse: move an MSP-owned connection back to the provider pool. */
export async function releaseConnectionToProviderPool(connectionId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const conn = await (tx as any).connection.findUnique({
      where: { id: connectionId },
      select: { id: true, tenantId: true, type: true },
    })
    if (!conn) throw new Error(`Connection ${connectionId} not found`)
    if (conn.tenantId === 'default') return
    await (tx as any).connection.update({
      where: { id: connectionId },
      data: { tenantId: 'default' },
    })
    await (tx as any).managedHost.updateMany({ where: { connectionId }, data: { tenantId: 'default' } })
    if (conn.type === 'pve') {
      await (tx as any).providerConnection.create({ data: { connectionId } })
    }
  })
}
