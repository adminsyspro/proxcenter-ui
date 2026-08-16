import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, getRequestGuestScopePerimeter, PERMISSIONS } from "@/lib/rbac"

export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const connId = (params as any)?.id

    if (!connId) return NextResponse.json({ error: 'Missing params.id' }, { status: 400 })

    // A flat-scoped caller (vm/tag/pool) can never satisfy a connection-scoped
    // check, so they used to 403 here and the Create VM wizard showed an empty
    // Resource Pool dropdown (issue #262). Fall back to the guest-derived
    // perimeter: through only if they hold connection.view somewhere AND own a
    // guest on this cluster, and then only their own pools are returned.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", connId)
    const perimeter = denied ? await getRequestGuestScopePerimeter(connId) : null

    if (denied && !(perimeter?.holdsPermission && perimeter.hasVisibleGuests)) return denied

    const conn = await getConnectionById(connId)

    if (!conn) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // Récupérer la liste des pools - pveFetch retourne directement data
    const pools = await pveFetch<any[]>(conn, '/pools')

    const visiblePools = perimeter?.restricted
      ? (pools || []).filter((p: any) => p?.poolid && perimeter.pools.has(p.poolid))
      : pools || []

    return NextResponse.json({
      data: visiblePools.map((p: any) => ({
        poolid: p.poolid,
        comment: p.comment || null
      })),
      // Tells the provisioning wizards that this list IS the caller's scope,
      // so they surface the pool choice (and drop the "no pool" option) even
      // for a non-admin: their guest has to land in one of these.
      restricted: !!perimeter?.restricted,
    })
  } catch (error: any) {
    console.error('Error fetching pools:', error)

return NextResponse.json(
      { error: error.message || 'Failed to fetch pools' },
      { status: 500 }
    )
  }
}
