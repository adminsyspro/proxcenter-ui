export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getClusterWithCredential } from '@/lib/k8s/repository'
import { buildKubeconfigYaml } from '@/lib/k8s/server/client'
import { audit } from '@/lib/audit'

type Ctx = { params: Promise<{ id: string }> }

// GET returns a self-contained kubeconfig YAML rebuilt from the cluster's stored
// (sanitized) credential, so an operator can retrieve it from the UI at any time
// (the provisioning wizard only offered it once, from the orchestrator's
// in-memory run outputs, which are lost on restart). A kubeconfig carries the
// cluster's admin credential, so it requires the same manage-level permission as
// delete, not plain view, and the export is audited.
export async function GET(_req: Request, ctx: Ctx) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_MANAGE); if (denied) return denied
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id } = await ctx.params

  const found = await getClusterWithCredential(tenant.tenantId, id)
  if (!found) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

  const kubeconfig = buildKubeconfigYaml(found.credential)
  await audit({ action: 'export', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName: found.row.name, status: 'success' })
  // The body carries the cluster admin credential; keep it out of any browser
  // or intermediary HTTP cache.
  return NextResponse.json({ kubeconfig, name: found.row.name }, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
