export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getClusterWithCredential } from '@/lib/k8s/repository'
import { cordonNode } from '@/lib/k8s/orchestrator'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

type Ctx = { params: Promise<{ id: string; node: string }> }
const DNS1123 = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/

async function handlePost(req: Request, ctx: Ctx) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_MANAGE)
  if (denied) return denied
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id, node } = await ctx.params
  const nodeName = decodeURIComponent(node)
  if (!DNS1123.test(nodeName) || nodeName.length > 253) return NextResponse.json({ error: 'Invalid node name' }, { status: 400 })

  const body = await req.json().catch(() => null)
  if (typeof body?.unschedulable !== 'boolean') return NextResponse.json({ error: 'unschedulable must be a boolean' }, { status: 400 })

  const found = await getClusterWithCredential(tenant.tenantId, id)
  if (!found) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

  const r = await cordonNode({ clusterId: id, credentialVersion: found.row.credentialVersion, cred: found.credential, nodeName, unschedulable: body.unschedulable })
  if (!r.ok) {
    await audit({ action: 'cordon', category: 'k8s', resourceType: 'kubernetesNode', resourceId: `${id}/${nodeName}`, resourceName: nodeName, status: 'failure', details: { error: r.error, unschedulable: body.unschedulable } })
    return NextResponse.json({ error: r.error }, { status: 502 })
  }
  await audit({ action: 'cordon', category: 'k8s', resourceType: 'kubernetesNode', resourceId: `${id}/${nodeName}`, resourceName: nodeName, status: 'success', details: { unschedulable: body.unschedulable } })
  return NextResponse.json(r.value, { status: 200 })
}

export const POST = withAudit({ category: 'k8s', action: 'cordon', resourceType: 'kubernetesNode', resourceParam: 'node' }, handlePost)
