export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { sanitizeKubeconfig } from '@/lib/k8s/kubeconfig'
import {
  getClusterWithCredential, replaceCredential, updateMeta, persistHealth, deleteCluster, deleteClusterNodes, getNodeMapping,
} from '@/lib/k8s/repository'
import { fetchHealth, invalidateClient } from '@/lib/k8s/orchestrator'
import { destroyClusterNodes } from '@/lib/k8s/server/destroyClusterNodes'
import { requireK8sProvision } from '@/lib/k8s/requireK8sProvision'
import { requireProvisionTarget } from '@/lib/k8s/provisionAccess'
import { destroyProvisionRun } from '@/lib/k8s/provisionOrchestrator'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_VIEW); if (denied) return denied
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id } = await ctx.params

  const found = await getClusterWithCredential(tenant.tenantId, id)
  if (!found) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

  const refresh = new URL(req.url).searchParams.get('refresh') === '1'
  if (!refresh) return NextResponse.json({ cluster: found.row }, { status: 200 })

  const h = await fetchHealth({ clusterId: id, credentialVersion: found.row.credentialVersion, cred: found.credential })
  const health = h.ok ? h.value! : { state: 'unreachable' as const, errorMessage: h.error }
  // persistHealth returns the post-persist public row: respond with it so the
  // client sees the fresh healthState/lastHealthAt, not the pre-probe snapshot.
  const persisted = await persistHealth(tenant.tenantId, id, health)
  if (health.state === 'auth_failed') {
    await audit({ action: 'health', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, status: 'failure' })
  }
  return NextResponse.json({ cluster: persisted ?? found.row, health }, { status: 200 })
}

async function handlePatch(req: Request, ctx: Ctx) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_MANAGE); if (denied) return denied
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id } = await ctx.params

  const existing = await getClusterWithCredential(tenant.tenantId, id)
  if (!existing) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

  const body = await req.json().catch(() => null)

  if (body?.kubeconfig && body?.context) {
    const san = sanitizeKubeconfig(body.kubeconfig, body.context, { allowInsecure: !!body.allowInsecure })
    if (!san.ok) return NextResponse.json({ rejections: san.rejections, error: san.error }, { status: 400 })
    await replaceCredential(tenant.tenantId, id, san.value!)
    await invalidateClient(id)
    await audit({ action: 'update', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName: body.name ?? existing.row.name, status: 'success' })
  }

  if (body?.name !== undefined || body?.proxmoxConnectionId !== undefined) {
    await updateMeta(tenant.tenantId, id, { name: body.name, proxmoxConnectionId: body.proxmoxConnectionId })
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}

async function handleDelete(req: Request, ctx: Ctx) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_MANAGE); if (denied) return denied
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id } = await ctx.params

  const existing = await getClusterWithCredential(tenant.tenantId, id)
  if (!existing) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })

  // ?destroyNodes=true also destroys the Proxmox VMs of a cluster ProxCenter
  // deployed, before removing the registry entry. It asks for the permission
  // that created them; an imported cluster has no such VMs and ignores it.
  const destroyNodes = new URL(req.url).searchParams.get('destroyNodes') === 'true'
  const destroyingVms = destroyNodes && existing.row.source === 'deployed'
  if (destroyingVms) {
    const refused = await requireK8sProvision(); if (refused) return refused
    // vm.delete on every Proxmox connection the cluster's VMs live on.
    const connections = [...new Set((await getNodeMapping(tenant.tenantId, id)).map(n => n.connectionId))]
    const refusal = (await Promise.all(connections.map(c => requireProvisionTarget(tenant.tenantId, c, 'delete')))).find(r => r !== null)
    if (refusal) return refusal
    const outcome = await destroyClusterNodes(tenant.tenantId, id, existing.row.name)
    if (!outcome.allOk) {
      // The cluster row and its node mapping stay, so the destroy can be retried.
      await audit({ action: 'delete', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName: existing.row.name, status: 'failure', details: { error: 'node destruction failed', results: outcome.results } })
      return NextResponse.json({ error: 'node destruction failed', results: outcome.results }, { status: 409 })
    }
  }

  // Always drop the node-mapping rows: kubernetes_cluster_nodes has no FK
  // cascade from the cluster row, so skipping this orphans them.
  await deleteClusterNodes(id)
  await deleteCluster(tenant.tenantId, id)
  await invalidateClient(id)
  // The VMs are gone: let the orchestrator tear down the run that deployed
  // them, which also removes its working files (the VMs' SSH key, the join
  // tokens) and its state. Best effort: the cluster is already deleted.
  let runTornDown: boolean | undefined
  if (destroyingVms && existing.row.provisioningRunId) {
    runTornDown = (await destroyProvisionRun(existing.row.provisioningRunId)).ok
  }
  await audit({ action: 'delete', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName: existing.row.name, status: 'success', details: { destroyedNodes: destroyingVms, runTornDown } })
  return NextResponse.json({ ok: true }, { status: 200 })
}

export const PATCH = withAudit({ category: 'k8s', resourceType: 'kubernetesCluster', resourceParam: 'id' }, handlePatch)

export const DELETE = withAudit({ category: 'k8s', resourceType: 'kubernetesCluster', resourceParam: 'id' }, handleDelete)
