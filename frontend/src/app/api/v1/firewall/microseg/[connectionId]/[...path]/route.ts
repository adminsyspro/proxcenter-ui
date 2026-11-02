export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/[...path]/route.ts
//
// Relay of the micro-segmentation API to the leader orchestrator
// (/api/v1/microseg/{connectionId}/...). Method, query string and body go
// through as they came, and the orchestrator's status and body come back
// unchanged (200, 202, 400, 403 FEATURE_REQUIRED, 404, 409, 502, 503): the
// UI reads the error code.
//
// Audit: each route says who writes its row (lib/microseg/proxyRoutes.ts). The
// orchestrator audits the lifecycle actions itself, from the actor headers;
// the relay audits here the draft writes, success and failure alike, and the
// lifecycle calls that Next refuses before the orchestrator sees them. It
// calls the audit() recorder of the withAudit() wrapper directly, since the
// wrapper cannot tell the two kinds of route apart on one catch-all.
//
// This is the only route of the directory: the previous per-endpoint routes (analysis, guests, isolation)
// are gone, and the public API allowlist no longer lists any micro-segmentation entry.
import { NextRequest, NextResponse } from 'next/server'

import { OrchestratorPathError, orchestratorRelay, orchestratorSegment } from '@/lib/orchestrator/client'
import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { matchMicrosegRoute, type MicrosegRoute } from '@/lib/microseg/proxyRoutes'
import { audit } from '@/lib/audit'

type Params = { connectionId: string; path: string[] }

/** What the relay learnt on the way, for the audit row. */
type RelayTrace = {
  /** The request body as read, once it has been read. */
  body?: string
  /**
   * False while the call certainly never reached the orchestrator's handlers:
   * refused here, unreachable orchestrator, or its 401 on the server key. A
   * timeout or a broken answer leaves it true, since the orchestrator may have
   * acted (and audited) all the same.
   */
  reached: boolean
}

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

/** The draft version a write body carries, when it carries one. */
function bodyVersion(body: string | undefined): number | undefined {
  if (!body) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    const version = parsed && typeof parsed === 'object' ? (parsed as { version?: unknown }).version : undefined

    return typeof version === 'number' && Number.isFinite(version) ? version : undefined
  } catch {
    return undefined
  }
}

/** The `error` string of a JSON refusal, read from a clone. */
async function responseError(res: Response): Promise<string | undefined> {
  try {
    const payload = (await res.clone().json()) as { error?: unknown } | null

    return typeof payload?.error === 'string' ? payload.error.slice(0, 500) : undefined
  } catch {
    return undefined
  }
}

/**
 * Writes the audit row of the call when the relay owns it: always on a draft
 * write, and on a lifecycle write only when the orchestrator never saw it (it
 * audits the ones it handles). No row behind a 401: there is no actor.
 */
async function recordAudit(route: MicrosegRoute, connectionId: string, path: string[], res: Response, trace: RelayTrace) {
  if (route.audit === 'none' || res.status === 401) return
  if (route.audit === 'orchestrator' && (trace.reached || res.status < 400)) return

  const failed = res.status >= 400

  try {
    await audit({
      category: 'firewall',
      action: route.auditAction,
      resourceType: 'microseg_policy',
      resourceId: connectionId,
      status: failed ? 'failure' : 'success',
      errorMessage: failed ? await responseError(res) : undefined,
      details: { path: path.join('/'), method: route.method, status: res.status, version: bodyVersion(trace.body) },
    })
  } catch (error) {
    // The answer is already decided; a lost row is logged, never surfaced.
    console.error('[audit] could not write the micro-segmentation audit row:', error instanceof Error ? error.message : error)
  }
}

async function relay(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { connectionId, path } = await params
  const route = matchMicrosegRoute(request.method, path ?? [])

  if (!route) return refusal(404, 'NOT_FOUND', 'Unknown micro-segmentation route')

  const trace: RelayTrace = { reached: false }
  const res = await forward(request, connectionId, path, route, trace)

  await recordAudit(route, connectionId, path, res, trace)

  return res
}

async function forward(request: NextRequest, connectionId: string, path: string[], route: MicrosegRoute, trace: RelayTrace): Promise<Response> {
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
    trace.body = body
    trace.reached = true

    const upstream = await orchestratorRelay(target, { method: route.method, body: body || undefined, signal: request.signal })

    // 401 is the orchestrator refusing this server's own API key, not the
    // user's session: relayed as is, the UI would send the user to the login
    // page in a loop.
    if (upstream.status === 401) {
      trace.reached = false
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
    if (error?.code === 'ORCHESTRATOR_UNAVAILABLE') {
      trace.reached = false

      return refusal(503, 'MICROSEG_UNAVAILABLE', 'Orchestrator unavailable')
    }
    if (error?.message === 'Orchestrator request timeout') return refusal(504, 'ORCHESTRATOR_TIMEOUT', 'Orchestrator request timeout')

    console.error('Error relaying a micro-segmentation call:', error)

    return refusal(502, 'ORCHESTRATOR_ERROR', 'Failed to reach the orchestrator')
  }
}

export const GET = relay
export const POST = relay
export const PUT = relay
export const DELETE = relay
