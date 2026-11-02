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
// This is the only route of the directory: the previous per-endpoint routes (analysis, guests, isolation)
// are gone, and the public API allowlist no longer lists any micro-segmentation entry.
import { NextRequest, NextResponse } from 'next/server'

import { OrchestratorPathError, orchestratorRelay, orchestratorSegment } from '@/lib/orchestrator/client'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { matchMicrosegRoute } from '@/lib/microseg/proxyRoutes'

type Params = { connectionId: string; path: string[] }

const NO_BODY_STATUSES = new Set([101, 204, 205, 304])

// The orchestrator refuses a larger body itself (1 MiB); Next stops reading at the same size.
const MAX_BODY_BYTES = 1024 * 1024

/** The request body as text, or null when it is larger than MAX_BODY_BYTES. */
async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const declared = Number(request.headers.get('content-length'))

  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null
  if (!request.body) return ''

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0

  for (;;) {
    const { done, value } = await reader.read()

    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined)

      return null
    }
    chunks.push(value)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text)

    return true
  } catch {
    return false
  }
}

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

    const body = request.method === 'GET' ? '' : await readBoundedBody(request)

    if (body === null) return refusal(413, 'INVALID', 'Request body too large')

    const upstream = await orchestratorRelay(target, { method: route.method, body: body || undefined, signal: request.signal })

    // 401 is the orchestrator refusing this server's own API key, not the
    // user's session: relayed as is, the UI would send the user to the login
    // page in a loop.
    if (upstream.status === 401) {
      console.error('The orchestrator refused the server credentials (HTTP 401) on a micro-segmentation call')

      return refusal(502, 'ORCHESTRATOR_ERROR', 'The orchestrator refused the server credentials')
    }

    const text = NO_BODY_STATUSES.has(upstream.status) ? null : await upstream.text()

    if (text !== null && upstream.status >= 400 && !isJson(text)) {
      console.error(`Non-JSON answer from the orchestrator on a micro-segmentation call (HTTP ${upstream.status})`)

      return refusal(502, 'ORCHESTRATOR_ERROR', 'Unexpected answer from the orchestrator')
    }

    return new NextResponse(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
    })
  } catch (error: any) {
    if (error?.message === 'Invalid or expired API token') return refusal(401, 'UNAUTHORIZED', 'Invalid or expired API token')
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
