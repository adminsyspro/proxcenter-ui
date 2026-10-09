// src/app/api/v1/pbs/[id]/pve-storages/route.ts
//
// PVE storages of type `pbs` that point at this PBS server, datastore and
// namespace, across the PVE connections the caller may read backups on. The
// backups explorer uses them to browse a VM image (`.img.fidx`) through the
// PVE file-restore API, which PBS itself cannot do.

import { NextResponse } from 'next/server'

import { getConnectionByIdOrNull, getPbsConnectionById, getPbsConnectionByIdUnscoped } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { matchingPbsStorages, pbsHostOf, type PbsPveStorage } from '@/lib/guestFileRestore/pbsPveStorages'
import { pveFetch } from '@/lib/proxmox/client'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { assertVdcPbsAccess } from '@/lib/vdc/scope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const { id } = await Promise.resolve(ctx.params)
    if (!id) return NextResponse.json({ error: 'Missing params.id' }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, 'pbs', id)
    if (denied) return denied

    const access = await assertVdcPbsAccess(id)
    if (access instanceof Response) return access

    const url = new URL(request.url)
    const datastore = url.searchParams.get('datastore')?.trim()
    const namespace = url.searchParams.get('ns')?.trim() ?? ''
    if (!datastore) return NextResponse.json({ error: 'Missing required parameter: datastore' }, { status: 400 })

    if (access.kind === 'tenant' && !access.allowed.some(a => a.datastore === datastore && a.namespace === namespace)) {
      return NextResponse.json({ error: 'Backup not accessible for this tenant' }, { status: 403 })
    }

    const pbs = access.kind === 'admin' ? await getPbsConnectionById(id) : await getPbsConnectionByIdUnscoped(id)
    const host = pbsHostOf(pbs.baseUrl)

    // PVE connections the tenant may reach, then the storages its vDCs expose.
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
    let connFilter: Set<string> | null = null
    let storageFilter: Map<string, Set<string>> | null = null
    if (infra.kind === 'msp') connFilter = infra.connectionIds
    if (infra.kind === 'iaas') {
      connFilter = infra.vdcScope.connectionIds
      storageFilter = infra.vdcScope.storagesByConnection
    }
    const candidates = await prisma.connection.findMany({
      where: {
        type: 'pve',
        ...(connFilter ? { id: { in: [...connFilter] } } : {}),
        ...(tenantId === DEFAULT_TENANT_ID || connFilter ? {} : { tenantId }),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const results = await Promise.all(
      candidates.map(async (c): Promise<PbsPveStorage[]> => {
        if (await checkPermission(PERMISSIONS.BACKUP_VIEW, 'connection', c.id)) return []
        try {
          const conn = await getConnectionByIdOrNull(c.id)
          if (!conn) return []
          const storages = await pveFetch<unknown>(conn, '/storage', {}, { timeoutMs: 10_000 })
          return matchingPbsStorages(storages, { host, datastore, namespace })
            .filter(s => !storageFilter || storageFilter.get(c.id)?.has(s.storage))
            .map(s => ({ connId: c.id, connName: c.name, storage: s.storage, nodes: s.nodes }))
        } catch {
          // An unreachable cluster simply offers no storage.
          return []
        }
      }),
    )

    return NextResponse.json({ data: results.flat() })
  } catch (error: any) {
    console.error('Erreur GET pbs/[id]/pve-storages:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
