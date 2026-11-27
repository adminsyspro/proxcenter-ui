export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sProvision } from '@/lib/k8s/requireK8sProvision'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { requireProvisionTarget } from '@/lib/k8s/provisionAccess'
import { listClusters } from '@/lib/k8s/repository'
import { startProvision, type ProvisionRequest } from '@/lib/k8s/provisionOrchestrator'
import { orchestratorFailure, failureBody } from '@/lib/k8s/provision/orchestratorStatus'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

async function handlePost(req: Request) {
  const denied = await requireK8sProvision()
  if (denied) return denied
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return tenant.response

  const body = await req.json().catch(() => null)
  const clusterName: string = body?.clusterName
  const connectionId: string = body?.connectionId
  const controlPlane = body?.controlPlane
  if (
    typeof clusterName !== 'string' || !clusterName ||
    typeof connectionId !== 'string' || !connectionId ||
    !Array.isArray(controlPlane) || controlPlane.length === 0
  ) {
    return NextResponse.json({ error: 'clusterName, connectionId, controlPlane required' }, { status: 400 })
  }

  const target = await requireProvisionTarget(tenant.tenantId, connectionId, 'create')
  if (target) return target

  // The cluster is registered under this name once deployed: refuse now
  // rather than after the VMs are built.
  if ((await listClusters(tenant.tenantId)).some((c: any) => c.name === clusterName)) {
    return NextResponse.json({ error: 'cluster_name_taken' }, { status: 409 })
  }

  const distro: string = body?.distro
  // Only distros the wizard can provision today (each has a backend module).
  if (distro !== 'talos' && distro !== 'k3s' && distro !== 'rke2' && distro !== 'kubeadm') {
    return NextResponse.json({ error: 'distro must be "talos", "k3s", "rke2", or "kubeadm"' }, { status: 400 })
  }

  // One key per click of Deploy, sent by the wizard: a retry of the same
  // request (double click, reload) finds its run instead of starting another.
  const sent = req.headers.get('X-Idempotency-Key')
  const idempotencyKey = sent && /^[A-Za-z0-9-]{8,64}$/.test(sent) ? sent : crypto.randomUUID()

  const r = await startProvision(body as ProvisionRequest, idempotencyKey)

  await audit({
    action: 'provision',
    category: 'k8s',
    resourceType: 'kubernetesCluster',
    resourceName: clusterName,
    status: r.ok ? 'success' : 'failure',
  })

  if (!r.ok) {
    const failure = orchestratorFailure(r.error)
    return NextResponse.json(failureBody(failure), { status: failure.status })
  }

  return NextResponse.json({ runId: r.value!.runId, status: r.value!.status }, { status: 202 })
}

export const POST = withAudit({ category: 'k8s', action: 'provision', resourceType: 'kubernetesCluster', resourceNameBodyField: 'clusterName' }, handlePost)
