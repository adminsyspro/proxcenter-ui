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

// Maps the run's distro to the registry's literal union (null when unknown).
function registryDistro(runDistro: unknown): 'k3s' | 'talos' | 'rke2' | 'kubeadm' | null {
  switch (runDistro) {
    case 'k3s': return 'k3s'
    case 'talos': return 'talos'
    case 'rke2': return 'rke2'
    case 'kubeadm': return 'kubeadm'
    default: return null
  }
}

/**
 * Idempotent registration of a completed provisioning run as a cluster.
 * Everything comes from the run, read server-side from the orchestrator by
 * runId: the cluster name, the Proxmox connection and the secrets
 * (kubeconfig, nodes). Nothing in the request body is used. The clusterId used for recordNodeMapping is
 * always the one createCluster just returned for this tenant, never a
 * client-supplied id.
 */
async function handlePost(_req: Request, ctx: Ctx) {
  const denied = await requireK8sProvision()
  if (denied) return denied
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return tenant.response

  const { runId } = await ctx.params

  // The run is read from the orchestrator (scoped to the caller's tenant):
  // its cluster name, its connection and its nodes are what the cluster is
  // registered under, never values the browser sends.
  const r = await getProvisionRun(runId)
  if (!r.ok) {
    const failure = orchestratorFailure(r.error)
    return NextResponse.json(failureBody(failure), { status: failure.status })
  }
  const clusterName = r.value!.run.clusterName
  const connectionId = r.value!.run.connectionId
  if (typeof clusterName !== 'string' || !clusterName || typeof connectionId !== 'string' || !connectionId) {
    return NextResponse.json({ error: 'run without a cluster name or connection' }, { status: 502 })
  }

  // Idempotency: the cluster already registered for this run. Another
  // cluster under the same name (an imported one, say) is not this one.
  const clusters = await listClusters(tenant.tenantId)
  const existing = clusters.find((c: any) => c.provisioningRunId === runId)
  if (existing) {
    return NextResponse.json({ clusterId: existing.id, alreadyRegistered: true }, { status: 200 })
  }
  if (clusters.some((c: any) => c.name === clusterName)) {
    return NextResponse.json({ error: 'cluster_name_taken' }, { status: 409 })
  }
  if (r.value!.run.status !== 'completed' || !r.value!.outputs) {
    return NextResponse.json({ error: 'run not completed' }, { status: 409 })
  }

  // Map the run's REAL distro (from the orchestrator status DTO) into the
  // registry; never assume talos. Explicit value mapping instead of a type
  // narrow: the repo tsconfig has strict:false where narrowing is
  // unreliable, and createCluster wants the literal union.
  const runDistro = r.value!.run.distro
  const distro = registryDistro(runDistro)
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
    provisioningRunId: runId,
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

export const POST = withAudit({ category: 'k8s', resourceType: 'kubernetesCluster' }, handlePost)
