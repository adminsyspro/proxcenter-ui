import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { isUserSuperAdmin } from '@/lib/rbac'
import { authOptions } from '@/lib/auth/config'
import { listBindingsForVdc } from '@/lib/db/vdcPbsBindings'
import { bindPbsToVdc, bindPbsToVdcManual } from '@/lib/vdc/pbsOrchestrator'

export const runtime = 'nodejs'

async function requireSuperAdmin(): Promise<Response | null> {
  const s = await getServerSession(authOptions)

  if (!s?.user?.id || !(await isUserSuperAdmin(s.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }


return null
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSuperAdmin()

  if (denied) return denied
  const { id } = await ctx.params
  const rows = (await listBindingsForVdc(id)).map(({ pbsTokenSecret, ...r }) => r)


return NextResponse.json({ data: rows })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSuperAdmin()

  if (denied) return denied
  const { id } = await ctx.params

  const body = await req.json().catch(() => ({})) as {
    mode?: 'auto' | 'manual'
    pbsConnectionId?: string
    datastore?: string
    namespace?: string
    pveStorageName?: string
    pveConnectionId?: string
  }

  const mode = body.mode ?? 'auto'

  if (!body.pbsConnectionId || !body.datastore) {
    return NextResponse.json({ error: 'Missing pbsConnectionId or datastore' }, { status: 400 })
  }

  try {
    let result: { binding: any; steps: any }

    if (mode === 'manual') {
      if (!body.namespace) {
        return NextResponse.json({ error: 'Missing namespace (required in manual mode)' }, { status: 400 })
      }

      result = await bindPbsToVdcManual({
        vdcId: id,
        pbsConnectionId: body.pbsConnectionId,
        datastore: body.datastore,
        namespace: body.namespace,
        pveStorageName: body.pveStorageName,
        pveConnectionId: body.pveConnectionId,
      })
    } else {
      result = await bindPbsToVdc({
        vdcId: id,
        pbsConnectionId: body.pbsConnectionId,
        datastore: body.datastore,
        namespace: body.namespace,
      })
    }

    const { pbsTokenSecret: _secret, ...safe } = result.binding


return NextResponse.json({ data: safe, steps: result.steps })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
