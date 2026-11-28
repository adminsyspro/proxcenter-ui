export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sProvision } from '@/lib/k8s/requireK8sProvision'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { deployedCluster } from '@/lib/k8s/deployedCluster'
import { getProvisionRun, upgradeCluster } from '@/lib/k8s/provisionOrchestrator'
import { orchestratorFailure, failureBody } from '@/lib/k8s/provision/orchestratorStatus'
import { upgradeRefusal } from '@/lib/k8s/upgrade'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

type Ctx = { params: Promise<{ id: string }> }

/**
 * Raises the Kubernetes version of a cluster ProxCenter deployed
 * ({ version: "v1.37.2+k3s1" }). The orchestrator upgrades the nodes one by
 * one over SSH; GET /workers follows it (status "scaling", phase "upgrade").
 */
async function handlePost(req: Request, ctx: Ctx) {
  const refused = await requireK8sProvision(); if (refused) return refused
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id } = await ctx.params
  const cluster = await deployedCluster(tenant.tenantId, id)
  if (cluster instanceof Response) return cluster

  const body = await req.json().catch(() => null)
  const version = typeof body?.version === 'string' ? body.version.trim() : ''
  if (!version || version.length > 64) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  const r = await getProvisionRun(cluster.runId)
  if (!r.ok) {
    const failure = orchestratorFailure(r.error)
    return NextResponse.json(failureBody(failure), { status: failure.status })
  }
  const { run } = r.value!
  if (run.status !== 'completed' || !run.layout) return NextResponse.json({ error: 'run_not_changeable' }, { status: 409 })
  if (!run.layout.upgradable || !run.layout.version) return NextResponse.json({ error: 'upgrade_unsupported' }, { status: 409 })
  const refusal = upgradeRefusal(run.layout.version, version)
  if (refusal) return NextResponse.json({ error: refusal }, { status: 400 })

  const started = await upgradeCluster(cluster.runId, version)
  const details = { from: run.layout.version, to: version }
  const failure = started.ok ? null : orchestratorFailure(started.error)
  await audit({ action: 'upgrade', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName: cluster.row.name, status: failure ? 'failure' : 'success', details: failure ? { ...details, error: failure.code } : details })
  if (failure) return NextResponse.json(failureBody(failure), { status: failure.status })
  return NextResponse.json({ status: started.value!.status }, { status: 202 })
}

export const POST = withAudit({ category: 'k8s', action: 'upgrade', resourceType: 'kubernetesCluster', resourceParam: 'id' }, handlePost)
