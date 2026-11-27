export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getClusterWithCredential } from '@/lib/k8s/repository'
import { drainNode } from '@/lib/k8s/orchestrator'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { markAuditExplicit } from '@/lib/audit/scope'

type Ctx = { params: Promise<{ id: string; node: string }> }
const DNS1123 = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/

async function handlePost(req: Request, ctx: Ctx) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_MANAGE)
  if (denied) return denied
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id, node } = await ctx.params
  const nodeName = decodeURIComponent(node)
  if (!DNS1123.test(nodeName) || nodeName.length > 253) return NextResponse.json({ error: 'Invalid node name' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const force = body?.force ?? false
  const dryRun = body?.dryRun ?? false
  if (typeof force !== 'boolean' || typeof dryRun !== 'boolean') return NextResponse.json({ error: 'force and dryRun must be booleans' }, { status: 400 })
  // A dry-run is a read-only preview: keep the route wrapper from logging it as a drain.
  if (dryRun) markAuditExplicit()

  const found = await getClusterWithCredential(tenant.tenantId, id)
  if (!found) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

  const r = await drainNode({ clusterId: id, credentialVersion: found.row.credentialVersion, cred: found.credential, nodeName, force, dryRun })
  if (!r.ok) {
    if (!dryRun) await audit({ action: 'drain', category: 'k8s', resourceType: 'kubernetesNode', resourceId: `${id}/${nodeName}`, resourceName: nodeName, status: 'failure', details: { error: r.error, force } })
    return NextResponse.json({ error: r.error }, { status: 502 })
  }
  // A dry-run is a read-only preview: do not audit it. Real drains audit with the summary.
  if (!dryRun) await audit({ action: 'drain', category: 'k8s', resourceType: 'kubernetesNode', resourceId: `${id}/${nodeName}`, resourceName: nodeName, status: 'success', details: { force, evicted: r.value!.evicted, remaining: r.value!.remaining.length, done: r.value!.done } })
  return NextResponse.json(r.value, { status: 200 })
}

export const POST = withAudit({ category: 'k8s', action: 'drain', resourceType: 'kubernetesNode', resourceParam: 'node' }, handlePost)
