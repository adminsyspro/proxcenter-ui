// src/app/api/v1/connections/[id]/owner/route.ts
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { requireProviderTenant } from '@/lib/tenant'
import { prisma } from '@/lib/db/prisma'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { invalidateConnectionCache } from '@/lib/connections/getConnection'
import { invalidateInventoryCache } from '@/lib/cache/inventoryCache'
import { audit } from '@/lib/audit'
import { assignConnectionToMspTenant, releaseConnectionToProviderPool } from '@/lib/connections/assignment'

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Scope the permission to THIS connection: an unscoped check would let a
  // user holding connection.manage on connection A reassign connection B.
  const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
  if (denied) return denied

  // Provider-only: only the NOC reassigns ownership.
  const notProvider = await requireProviderTenant()
  if (notProvider) return notProvider

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const tenantId = body?.tenantId
  if (!tenantId || typeof tenantId !== 'string') {
    return NextResponse.json({ error: 'tenantId is required' }, { status: 400 })
  }

  const conn = await prisma.connection.findUnique({
    where: { id },
    select: { id: true, name: true, type: true, tenantId: true },
  })
  if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

  try {
    if (tenantId === 'default') {
      await releaseConnectionToProviderPool(id)
    } else {
      const target = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { operatingModel: true, enabled: true },
      })
      if (!target || !target.enabled) {
        return NextResponse.json({ error: 'Target tenant not found or disabled' }, { status: 404 })
      }
      if (target.operatingModel !== 'msp') {
        return NextResponse.json({ error: 'Target tenant must be an MSP tenant' }, { status: 400 })
      }
      await assignConnectionToMspTenant(id, tenantId)
    }
  } catch (e: any) {
    // Conflict cases: a vDC still references a pooled PVE connection (Prisma
    // surfaces the FK RESTRICT as P2003), a raced predicated update found no
    // row (P2025), or one of the helper's own guard errors (already-owned,
    // mid-transaction change, lingering PBS namespace bindings).
    const msg = e?.message || String(e)
    const isConflict = e?.code === 'P2003' || e?.code === 'P2025'
      || /still owned|already owned|state changed|namespace bindings|foreign key|RESTRICT/i.test(msg)
    return NextResponse.json({ error: msg }, { status: isConflict ? 409 : 400 })
  }

  invalidateConnectionCache(id)
  invalidateInventoryCache()
  await audit({
    action: 'update',
    category: 'connections',
    resourceType: 'connection',
    resourceId: id,
    resourceName: conn.name,
    details: { from: conn.tenantId, to: tenantId },
    status: 'success',
  })

  return NextResponse.json({ success: true, connectionId: id, tenantId })
}
