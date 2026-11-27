export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { requireK8sProvision } from '@/lib/k8s/requireK8sProvision'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getProvisionLogs } from '@/lib/k8s/provisionOrchestrator'
import { orchestratorFailure, failureBody } from '@/lib/k8s/provision/orchestratorStatus'

type Ctx = { params: Promise<{ runId: string }> }

// Pure proxy of the orchestrator run logs: no side effects.
export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireK8sProvision()
  if (denied) return denied
  const tenant = await resolveStrictTenant()
  if (!tenant.ok) return tenant.response

  const { runId } = await ctx.params
  const limitParam = new URL(req.url).searchParams.get('limit')
  const limit = Number(limitParam) || 0

  const r = await getProvisionLogs(runId, limit)
  if (!r.ok) {
    const failure = orchestratorFailure(r.error)
    return NextResponse.json(failureBody(failure), { status: failure.status })
  }
  return NextResponse.json(r.value, { status: 200 })
}
