export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sProvision } from '@/lib/k8s/requireK8sProvision'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getProvisionRun } from '@/lib/k8s/provisionOrchestrator'
import { orchestratorFailure, failureBody } from '@/lib/k8s/provision/orchestratorStatus'

type Ctx = { params: Promise<{ runId: string }> }

// Pure proxy of the orchestrator run status: no side effects (registration
// happens exclusively via the dedicated POST .../register route).
export async function GET(_req: Request, ctx: Ctx) {
  const denied = await requireK8sProvision()
  if (denied) return denied
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return tenant.response

  const { runId } = await ctx.params
  const r = await getProvisionRun(runId)
  if (!r.ok) {
    const failure = orchestratorFailure(r.error)
    return NextResponse.json(failureBody(failure), { status: failure.status })
  }
  // A completed run's outputs carry the cluster kubeconfig/talosconfig; keep
  // this secret-bearing response out of any browser or intermediary cache.
  return NextResponse.json(r.value, { status: 200, headers: { 'Cache-Control': 'no-store' } })
}
