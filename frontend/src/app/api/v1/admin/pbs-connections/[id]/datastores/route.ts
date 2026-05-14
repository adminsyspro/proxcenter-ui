import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { isUserSuperAdmin } from '@/lib/rbac'
import { getPbsConnectionById } from '@/lib/connections/getConnection'
import { pbsFetch } from '@/lib/proxmox/pbs-client'

export const runtime = 'nodejs'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions)

  if (!s?.user?.id || !(await isUserSuperAdmin(s.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params

  try {
    const conn = await getPbsConnectionById(id)

    // Try /admin/datastore first (returns datastores visible to the token);
    // if empty, fall back to /config/datastore (requires Datastore.Audit or higher).
    let rows: Array<{ store?: string; name?: string }> = []

    try {
      rows = await pbsFetch<Array<{ store?: string; name?: string }>>(conn, '/admin/datastore') || []
    } catch (err) {
      console.warn(`[pbs-datastores] /admin/datastore failed for ${id}, falling back to /config/datastore:`, err)
    }

    if (!rows || rows.length === 0) {
      try {
        rows = await pbsFetch<Array<{ store?: string; name?: string }>>(conn, '/config/datastore') || []
      } catch (err) {
        console.warn(`[pbs-datastores] /config/datastore also failed for ${id}:`, err)
      }
    }

    const names = (rows || []).map(d => d.store || d.name).filter((n): n is string => !!n)


return NextResponse.json({ data: names })
  } catch (e: any) {
    console.error(`[pbs-datastores] failed for ${id}:`, e?.message || e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
