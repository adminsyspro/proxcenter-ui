export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { requireK8sViewCluster } from '@/lib/k8s/requireK8sViewCluster'
import { readHistory } from '@/lib/k8s/orchestrator'
import { actionEntry, mergeTimeline } from '@/lib/k8s/server/timeline'
import { isValidNamespace } from '@/lib/k8s/workloadActions'

type Ctx = { params: Promise<{ id: string }> }

/** Actions that change the cluster; reads (logs, health, kubeconfig export) stay out of the history. */
export const HISTORY_ACTIONS = ['create', 'update', 'delete', 'cordon', 'drain', 'restart', 'scale', 'rollback']
const AUDIT_ROWS = 200

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const gate = await requireK8sViewCluster(id)
  if (!gate.ok) return gate.response

  const raw = new URL(req.url).searchParams.get('namespace')
  if (raw && !isValidNamespace(raw)) return NextResponse.json({ error: 'invalid namespace' }, { status: 400 })
  const namespace = raw || undefined

  const [cluster, rows, canReadAudit] = await Promise.all([
    readHistory({ clusterId: id, credentialVersion: gate.cluster.credentialVersion, cred: gate.credential, namespace }),
    prisma.auditLog.findMany({
      where: {
        tenantId: gate.tenantId,
        category: 'k8s',
        action: { in: HISTORY_ACTIONS },
        OR: [{ resourceId: id }, { resourceId: { startsWith: `${id}/` } }],
      },
      orderBy: { timestamp: 'desc' },
      take: AUDIT_ROWS,
      select: { timestamp: true, action: true, status: true, resourceType: true, resourceId: true, resourceName: true, userEmail: true, details: true },
    }),
    checkPermission(PERMISSIONS.ADMIN_AUDIT).then(denied => denied === null),
  ])
  if (!cluster.ok) {
    const status = cluster.error === 'forbidden' ? 403 : 502
    return NextResponse.json({ error: cluster.error }, { status })
  }
  // Who did what is audit data: shown only to callers who may read the audit log.
  const actions = rows.map(r => actionEntry({ ...r, userEmail: canReadAudit ? r.userEmail : null }))
  return NextResponse.json({
    entries: mergeTimeline([...cluster.value!.entries, ...actions], namespace),
    partial: cluster.value!.partial,
  }, { status: 200 })
}
