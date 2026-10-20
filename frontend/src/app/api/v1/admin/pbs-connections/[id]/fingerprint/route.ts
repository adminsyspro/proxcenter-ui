import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { isUserSuperAdmin } from '@/lib/rbac'
import { prisma } from '@/lib/db/prisma'
import { captureFingerprint } from '@/lib/proxmox/pbsFingerprint'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'

async function handlePost(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getServerSession(authOptions)
  if (!s?.user?.id || !(await isUserSuperAdmin(s.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id } = await ctx.params
  const conn = await prisma.connection.findUnique({ where: { id }, select: { baseUrl: true, type: true } })
  if (!conn || conn.type !== 'pbs') {
    return NextResponse.json({ error: 'PBS connection not found' }, { status: 404 })
  }
  try {
    const fingerprint = await captureFingerprint(conn.baseUrl)
    await prisma.connection.update({ where: { id }, data: { fingerprint } })
    return NextResponse.json({ data: { fingerprint } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}

export const POST = withAudit({ category: 'connections', resourceType: 'pbs_connection', resourceParam: 'id' }, handlePost)
