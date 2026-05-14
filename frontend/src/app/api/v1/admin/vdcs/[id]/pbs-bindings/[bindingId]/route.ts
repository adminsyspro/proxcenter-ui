import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { isUserSuperAdmin } from '@/lib/rbac'
import { authOptions } from '@/lib/auth/config'
import { unbindFromVdc } from '@/lib/vdc/pbsOrchestrator'

export const runtime = 'nodejs'

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; bindingId: string }> }) {
  const s = await getServerSession(authOptions)

  if (!s?.user?.id || !(await isUserSuperAdmin(s.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { bindingId } = await ctx.params

  try {
    await unbindFromVdc(bindingId)

return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
