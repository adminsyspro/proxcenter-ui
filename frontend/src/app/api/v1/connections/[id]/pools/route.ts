import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const connId = (params as any)?.id

    if (!connId) return NextResponse.json({ error: 'Missing params.id' }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", connId)

    if (denied) return denied

    const conn = await getConnectionById(connId)

    if (!conn) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // Récupérer la liste des pools - pveFetch retourne directement data
    const pools = await pveFetch<any[]>(conn, '/pools')

    return NextResponse.json({
      data: (pools || []).map((p: any) => ({
        poolid: p.poolid,
        comment: p.comment || null
      }))
    })
  } catch (error: any) {
    console.error('Error fetching pools:', error)

return NextResponse.json(
      { error: error.message || 'Failed to fetch pools' },
      { status: 500 }
    )
  }
}
