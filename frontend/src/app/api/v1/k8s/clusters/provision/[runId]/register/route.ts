export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { requireK8sProvision } from '@/lib/k8s/requireK8sProvision'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getProvisionRun } from '@/lib/k8s/provisionOrchestrator'
import { orchestratorFailure, failureBody } from '@/lib/k8s/provision/orchestratorStatus'
import { listKubeconfigContexts, sanitizeKubeconfig } from '@/lib/k8s/kubeconfig'
import { listClusters, createCluster, recordNodeMapping } from '@/lib/k8s/repository'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

type Ctx = { params: Promise<{ runId: string }> }

/**
 * Idempotent registration of a completed provisioning run as a cluster.
 * The client supplies clusterName + connectionId (it owns them, it just
 * submitted them in the ProvisionRequest); the secrets (kubeconfig, nodes)
 * are always fetched server-side from the orchestrator by runId, never
 * trusted from the client. The clusterId used for recordNodeMapping is
 * always the one createCluster just returned for this tenant, never a
 * client-supplied id.
 */
async function handlePost(req: Request, ctx: Ctx) {
  const denied = await requireK8sProvision()
  if (denied) return denied
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return tenant.response

  const { runId } = await ctx.params
  const body = await req.json().catch(() => null)
  const clusterName: string = body?.clusterName
  const connectionId: string = body?.connectionId
  if (typeof clusterName !== 'string' || !clusterName || typeof connectionId !== 'string' || !connectionId) {
    return NextResponse.json({ error: 'clusterName, connectionId required' }, { status: 400 })
  }

  // Idempotency: skip if a cluster with that name already exists for the tenant.
  const existing = (await listClusters(tenant.tenantId)).find((c: any) => c.name === clusterName)
  if (existing) {
    return NextResponse.json({ clusterId: existing.id, alreadyRegistered: true }, { status: 200 })
  }

  const r = await getProvisionRun(runId)
  if (!r.ok) {
    const failure = orchestratorFailure(r.error)
    return NextResponse.json(failureBody(failure), { status: failure.status })
  }
  if (r.value!.run.status !== 'completed' || !r.value!.outputs) {
    return NextResponse.json({ error: 'run not completed' }, { status: 409 })
  }

  // Map the run's REAL distro (from the orchestrator status DTO) into the
  // registry; never assume talos. Explicit value mapping instead of a type
  // narrow: the repo tsconfig has strict:false where narrowing is
  // unreliable, and createCluster wants the literal union.
  const runDistro = r.value!.run.distro
  const distro =
    runDistro === 'k3s' ? ('k3s' as const)
    : runDistro === 'talos' ? ('talos' as const)
    : runDistro === 'rke2' ? ('rke2' as const)
    : runDistro === 'kubeadm' ? ('kubeadm' as const)
    : null
  if (!distro) {
    await audit({ action: 'create', category: 'k8s', resourceType: 'kubernetesCluster', resourceName: clusterName, status: 'failure' })
    return NextResponse.json({ error: 'unsupported or missing distro on the provisioning run' }, { status: 422 })
  }

  const { kubeconfig, nodes } = r.value!.outputs

  const ctxs = listKubeconfigContexts(kubeconfig)
  if (!ctxs.ok || !ctxs.value?.length) {
    await audit({ action: 'create', category: 'k8s', resourceType: 'kubernetesCluster', resourceName: clusterName, status: 'failure' })
    return NextResponse.json({ error: ctxs.error ?? 'no contexts' }, { status: 400 })
  }

  // Provisioned kubeconfigs (Talos and k3s) carry a single context.
  const san = sanitizeKubeconfig(kubeconfig, ctxs.value[0])
  if (!san.ok) {
    await audit({ action: 'create', category: 'k8s', resourceType: 'kubernetesCluster', resourceName: clusterName, status: 'failure' })
    return NextResponse.json({ error: san.error, rejections: san.rejections }, { status: 400 })
  }

  const session: any = await getServerSession(authOptions)
  const createdBy: string | null = session?.user?.id ?? null

  const clusterId = await createCluster(tenant.tenantId, {
    name: clusterName,
    distro,
    source: 'deployed',
    cred: san.value!,
    proxmoxConnectionId: connectionId,
    createdBy,
  })

  await recordNodeMapping(clusterId, nodes.map(n => ({ name: n.name, vmid: n.vmid, connectionId })))

  await audit({
    action: 'create',
    category: 'k8s',
    resourceType: 'kubernetesCluster',
    resourceId: clusterId,
    resourceName: clusterName,
    status: 'success',
  })

  return NextResponse.json({ clusterId }, { status: 201 })
}

export const POST = withAudit({ category: 'k8s', resourceType: 'kubernetesCluster', resourceNameBodyField: 'clusterName' }, handlePost)
