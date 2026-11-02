export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/[...path]/route.ts
//
// Relay of the micro-segmentation API to the leader orchestrator
// (/api/v1/microseg/{connectionId}/...). Method, query string and body go
// through as they came, and the orchestrator's status and body come back
// unchanged (200, 202, 400, 403 FEATURE_REQUIRED, 404, 409, 502, 503): the
// UI reads the error code. The orchestrator audits its own writes, from the
// actor headers, so nothing is audited here.
//
// Next resolves the static folders of this directory (analyze, generate-base,
// vm, vms: the previous endpoints, removed in a later task) before this
// catch-all, and none of their names is a route of MICROSEG_ROUTES, so the
// two sets cannot shadow each other.
import { NextRequest, NextResponse } from 'next/server'

import { OrchestratorPathError, orchestratorRelay, orchestratorSegment } from '@/lib/orchestrator/client'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { matchMicrosegRoute } from '@/lib/microseg/proxyRoutes'

type Params = { connectionId: string; path: string[] }

const NO_BODY_STATUSES = new Set([101, 204, 205, 304])

function refusal(status: number, code: string, error: string) {
  return NextResponse.json({ code, error }, { status })
}

// Micro-segmentation acts on the cluster firewall: not available to a vDC tenant.
async function refusedForVdcTenant(): Promise<NextResponse | null> {
  const tenantId = await getCurrentTenantId()
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })

  return infra.kind === 'iaas'
    ? refusal(403, 'FORBIDDEN', 'Micro-segmentation is not available to a vDC tenant')
    : null
}

async function relay(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { connectionId, path } = await params
  const route = matchMicrosegRoute(request.method, path ?? [])

  if (!route) return refusal(404, 'NOT_FOUND', 'Unknown micro-segmentation route')

  let target: string

  try {
    target = `/microseg/${orchestratorSegment(connectionId, 'connection id')}/${path.join('/')}${new URL(request.url).search}`
  } catch (error) {
    if (!(error instanceof OrchestratorPathError)) throw error

    return refusal(error.status, 'INVALID', error.message)
  }

  try {
    const ownershipDenied = await verifyConnectionOwnership(connectionId)

    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(route.write ? PERMISSIONS.NODE_MANAGE : PERMISSIONS.NODE_VIEW, 'connection', connectionId)

    if (denied) return denied

    const tenantRefusal = await refusedForVdcTenant()

    if (tenantRefusal) return tenantRefusal

    const body = request.method === 'GET' ? '' : await request.text()
    const upstream = await orchestratorRelay(target, { method: route.method, body: body || undefined })
    const text = NO_BODY_STATUSES.has(upstream.status) ? null : await upstream.text()

    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
    })
  } catch (error: any) {
    if (error?.name === 'TenantAccessError') return refusal(403, 'FORBIDDEN', 'Tenant not available for this session')
    if (error?.code === 'ORCHESTRATOR_UNAVAILABLE') return refusal(503, 'MICROSEG_UNAVAILABLE', 'Orchestrator unavailable')
    if (error?.message === 'Orchestrator request timeout') return refusal(504, 'ORCHESTRATOR_TIMEOUT', 'Orchestrator request timeout')

    console.error('Error relaying a micro-segmentation call:', error)

    return refusal(502, 'ORCHESTRATOR_ERROR', 'Failed to reach the orchestrator')
  }
}

export const GET = relay
export const POST = relay
export const PUT = relay
export const DELETE = relay
