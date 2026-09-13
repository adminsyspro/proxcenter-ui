import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { prisma } from '@/lib/db/prisma'
import { isUserSuperAdmin } from '@/lib/rbac'
import { authOptions } from '@/lib/auth/config'
import { insertPveStorage, listPveStoragesForBinding } from '@/lib/db/vdcPbsBindings'
import { createPbsStorage, sanitizeStorageName } from '@/lib/proxmox/pvePbsStorage'
import { getConnectionById } from '@/lib/connections/getConnection'
import { resolvePbsMeta } from '@/lib/proxmox/pbsConnMeta'
import { readVdcAndTenant, readVdcNodeNames, appendVdcStorage } from '@/lib/vdc/pbsOrchestrator'
import { clearVdcScopeCache } from '@/lib/vdc/scope'

export const runtime = 'nodejs'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string; bindingId: string }> }) {
  const s = await getServerSession(authOptions)
  if (!s?.user?.id || !(await isUserSuperAdmin(s.user.id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { id: vdcId, bindingId } = await ctx.params

  try {
    const binding = await prisma.vdcPbsNamespace.findUnique({ where: { id: bindingId } })
    if (!binding || binding.vdcId !== vdcId) {
      return NextResponse.json({ error: 'Binding not found' }, { status: 404 })
    }
    if (!binding.pbsTokenId || !binding.pbsTokenSecret) {
      return NextResponse.json({ error: 'Binding has no token — delete and recreate it' }, { status: 400 })
    }

    const existing = await listPveStoragesForBinding(bindingId)
    if (existing.length > 0) {
      return NextResponse.json({ data: { status: 'already_exists', storageName: existing[0].pveStorageName } })
    }

    const { vdc, tenant } = await readVdcAndTenant(vdcId)
    const pveConn = await getConnectionById(vdc.connectionId, tenant.id)
    const storageName = sanitizeStorageName(tenant.slug, vdc.slug)
    const nodes = await readVdcNodeNames(vdcId)
    const pbs = await resolvePbsMeta(binding.pbsConnectionId)

    await createPbsStorage(pveConn, {
      storage: storageName,
      server: pbs.host,
      datastore: binding.datastore,
      namespace: binding.namespace,
      username: binding.pbsTokenId,
      password: binding.pbsTokenSecret,
      fingerprint: pbs.fingerprint,
      nodes,
    })
    try {
      await insertPveStorage({ bindingId, pveConnectionId: vdc.connectionId, pveStorageName: storageName, managed: true })
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e
    }
    await appendVdcStorage(vdcId, storageName)
    clearVdcScopeCache(tenant.id)

    return NextResponse.json({ data: { status: 'created', storageName } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
