export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getClusterWithCredential } from '@/lib/k8s/repository'
import { parseWorkloadAction, type WorkloadActionRequest } from '@/lib/k8s/workloadActions'
import { restartWorkload, scaleWorkload, rollbackDeployment, deletePod } from '@/lib/k8s/orchestrator'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

type Ctx = { params: Promise<{ id: string }> }

const STATUS_BY_ERROR: Record<string, number> = { not_found: 404, conflict: 409, forbidden: 403, auth_failed: 502, unreachable: 502, config: 502 }

const AUDIT_ACTION = { restart: 'restart', scale: 'scale', rollback: 'rollback', delete: 'delete' } as const

function run(base: { clusterId: string; credentialVersion: number; cred: any }, req: WorkloadActionRequest) {
  switch (req.action) {
    case 'restart':
      return restartWorkload({ ...base, kind: req.kind, namespace: req.namespace, name: req.name })
    case 'scale':
      return scaleWorkload({ ...base, kind: req.kind, namespace: req.namespace, name: req.name, replicas: req.replicas })
    case 'rollback':
      return rollbackDeployment({ ...base, namespace: req.namespace, name: req.name, revision: req.revision })
    case 'delete':
      return deletePod({ ...base, namespace: req.namespace, name: req.name })
  }
}

function auditDetails(req: WorkloadActionRequest): Record<string, unknown> {
  const details: Record<string, unknown> = { kind: req.kind, namespace: req.namespace }
  if (req.action === 'scale') details.replicas = req.replicas
  if (req.action === 'rollback') details.revision = req.revision
  return details
}

async function handlePost(req: Request, ctx: Ctx) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_MANAGE)
  if (denied) return denied
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id } = await ctx.params

  const parsed = parseWorkloadAction(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const action = parsed.value

  const found = await getClusterWithCredential(tenant.tenantId, id)
  if (!found) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

  const r = await run({ clusterId: id, credentialVersion: found.row.credentialVersion, cred: found.credential }, action)
  const auditBase = {
    action: AUDIT_ACTION[action.action],
    category: 'k8s' as const,
    resourceType: action.kind === 'pod' ? 'kubernetesPod' : 'kubernetesWorkload',
    resourceId: `${id}/${action.namespace}/${action.kind}/${action.name}`,
    resourceName: action.name,
  }
  if (!r.ok) {
    await audit({ ...auditBase, status: 'failure', details: { ...auditDetails(action), error: r.error } })
    return NextResponse.json({ error: r.error }, { status: STATUS_BY_ERROR[r.error ?? ''] ?? 502 })
  }
  await audit({ ...auditBase, status: 'success', details: auditDetails(action) })
  return NextResponse.json(r.value, { status: 200 })
}

export const POST = withAudit({ category: 'k8s', resourceType: 'kubernetesWorkload', resourceNameBodyField: 'name' }, handlePost)
