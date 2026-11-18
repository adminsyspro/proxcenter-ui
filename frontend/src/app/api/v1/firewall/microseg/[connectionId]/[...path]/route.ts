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
// orchestrator audits the lifecycle actions and the cluster links itself, from
// the actor headers; the relay audits here the draft writes, success and
// failure alike, and the orchestrator-audited calls that Next refuses before
// the orchestrator sees them. It
// calls the audit() recorder of the withAudit() wrapper directly, since the
// wrapper cannot tell the two kinds of route apart on one catch-all.
//
// Rights: the caller needs node.view (a read) or node.manage (a write) on the
// URL's connection, and, for a route of the `policy` scope, on every connection
// linked to it by a shared policy (read from the orchestrator's /clusters with
// the server credentials), plus the connection an association brings in (its
// body is the one exception to the relay as is: rebuilt by the relay). Those
// connections are checked in parallel; the first refusal in the order of the
// list is the answer. A refusal is the generic answer of the ownership or RBAC
// helper, which names no connection; a clusters read that fails, or that does
// not list the URL's connection, refuses the call (fail closed). GET clusters
// is answered from that same read.
//
// A cluster may be linked between that read and the call: every call made
// after a clusters read carries the set checked (X-Microseg-Clusters), and the
// orchestrator refuses it with 409 CLUSTERS_CHANGED, before any effect, when
// the links of the policy are no longer that set. The relay then reads the
// clusters again, checks the caller on them and sends the call once more; a
// second refusal is answered as a conflict that names no cluster.
//
// A run (GET runs/{id}) is a `cluster` route, polled every 2 s per cluster: the
// orchestrator serves any run of the policy through any of its clusters, so the
// relay hands back only the run asked for (its top-level `id`) of the URL's
// cluster, or of older data that names none (empty or missing). Any other run,
// an answer that is not that run, and every not found of the orchestrator get
// one and the same not found: the caller cannot tell an unknown run from a run
// of another cluster, or of a cluster that left the policy.
//
// This is the only route of the directory: the previous per-endpoint routes (analysis, guests, isolation)
// are gone, and the public API allowlist no longer lists any micro-segmentation entry.
import { NextRequest, NextResponse } from 'next/server'

import { OrchestratorPathError, orchestratorFetch, orchestratorRelay, orchestratorSegment, parseOrchestratorError } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'
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
  // Micro-segmentation acts on the cluster firewall: a vDC (iaas) tenant gets
  // the 404 of every provider infrastructure route (lib/tenant/iaasGuard),
  // before the route lookup, any ownership or permission check and the audit.
  const iaasDenied = await denyIaasTenant()

  if (iaasDenied) return iaasDenied

  const { connectionId, path } = await params
  const route = matchMicrosegRoute(request.method, path ?? [])

  if (!route) return refusal(404, 'NOT_FOUND', 'Unknown micro-segmentation route')

  const trace: RelayTrace = { reached: false }
  const res = await forward(request, connectionId, path, route, trace)

  await recordAudit(route, connectionId, path, res, trace)

  return res
}

/** The refusal of a caller who may not make this call on one connection (ownership, RBAC), or null. */
async function connectionRefusal(connectionId: string, write: boolean): Promise<Response | null> {
  const ownershipDenied = await verifyConnectionOwnership(connectionId)

  if (ownershipDenied) return ownershipDenied

  return checkPermission(write ? PERMISSIONS.NODE_MANAGE : PERMISSIONS.NODE_VIEW, 'connection', connectionId)
}

// The orchestrator's own gate (licence, leadership, engine): the UI reads these
// codes, and they name no cluster, so a clusters read refused with one of them
// hands it on as the call itself would have.
const GATE_CODES = new Set(['FEATURE_REQUIRED', 'NOT_LEADER', 'MICROSEG_UNAVAILABLE'])

/** The clusters read: the connections linked by the policy (the URL's one included) and the answer as it came. */
type LinkedClusters = { ids: string[]; answer: unknown }

/** The set of clusters the relay checked, sent with the call that follows the check. */
const CHECKED_CLUSTERS_HEADER = 'X-Microseg-Clusters'

/** A connection ID as the orchestrator paths take it: no comma, space or line break can reach the header. */
function isConnectionId(id: unknown): id is string {
  try {
    orchestratorSegment(id, 'connection id')

    return true
  } catch {
    return false
  }
}

/**
 * The connections linked to this one by its policy (itself included), or the
 * refusal of the call when they cannot be read or the answer does not list the
 * URL's connection. A call that got no answer throws, for failureAnswer.
 */
async function linkedConnections(connectionId: string, signal: AbortSignal): Promise<LinkedClusters | Response> {
  let answer: unknown

  try {
    answer = await orchestratorFetch<unknown>(`/microseg/${orchestratorSegment(connectionId, 'connection id')}/clusters`, { signal })
  } catch (error) {
    const upstream = parseOrchestratorError(error)

    if (!upstream) throw error

    const code = upstream.details?.code

    if (upstream.status !== 401 && typeof code === 'string' && GATE_CODES.has(code)) return refusal(upstream.status, code, upstream.message)
    console.error(`The orchestrator answered HTTP ${upstream.status} to the micro-segmentation clusters read`)

    return refusal(502, 'ORCHESTRATOR_ERROR', 'Unexpected answer from the orchestrator')
  }

  const rows = answer && typeof answer === 'object' ? (answer as { clusters?: unknown }).clusters : undefined
  const ids = Array.isArray(rows) ? rows.map(row => (row && typeof row === 'object' ? (row as { connection_id?: unknown }).connection_id : undefined)) : []

  if (!Array.isArray(rows) || !ids.every(isConnectionId) || !ids.includes(connectionId)) {
    console.error('Unexpected answer from the orchestrator to the micro-segmentation clusters read')

    return refusal(502, 'ORCHESTRATOR_ERROR', 'Unexpected answer from the orchestrator')
  }

  return { ids: [...new Set(ids as string[])], answer }
}

/**
 * The connection an association brings in, or null unless the body is exactly
 * {"connection_id": "<non-empty string>"}. Any other key is refused, a case
 * variant above all: the orchestrator's decoder matches keys without regard to
 * case (the last one wins), so it could read another connection than the one
 * checked here. The relay forwards its own rebuilt body, never the caller's.
 */
function associatedConnection(body: string): string | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const keys = Object.keys(parsed)
  const id = (parsed as { connection_id?: unknown }).connection_id

  return keys.length === 1 && keys[0] === 'connection_id' && typeof id === 'string' && id ? id : null
}

/**
 * The refusal of a caller who may not make a policy route on every connection
 * linked to the URL's one (already checked) and on the one an association
 * brings in, each checked once and all at the same time; the first refusal in
 * the order of the list is returned as the helper wrote it. Otherwise the
 * clusters read, or null for a cluster route (nothing read).
 */
async function policyCheck(connectionId: string, route: MicrosegRoute, target: string | null, signal: AbortSignal): Promise<Response | LinkedClusters | null> {
  if (route.scope === 'cluster') return null

  const linked = await linkedConnections(connectionId, signal)

  if (linked instanceof Response) return linked

  const others = new Set(linked.ids)

  if (target) others.add(target)
  others.delete(connectionId)

  const refusals = await Promise.all([...others].map(id => connectionRefusal(id, route.write)))

  return refusals.find(denied => denied !== null) ?? linked
}

const runNotFound = () => refusal(404, 'NOT_FOUND', 'run not found')

/**
 * The refusal of a run answer that is not the run asked for, of the URL's
 * cluster, or null to hand it back: a run that names another connection gets
 * the generic not found (the run is never returned), and so does an answer that
 * is not a JSON object, whose top-level `id` is not the run asked for (a wrapped
 * body included), or whose `connection_id` is not a string (fail closed). An
 * empty `connection_id` is a run of older data, on the policy's first cluster;
 * a missing one comes from an orchestrator older than the shared policies (one
 * cluster per policy, the case of every run read during an upgrade): both are
 * handed back.
 */
function foreignRunRefusal(text: string | null, connectionId: string, runId: string): Response | null {
  let parsed: unknown = null

  try {
    if (text) parsed = JSON.parse(text)
  } catch {
    parsed = null
  }

  const isObject = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  const field = isObject ? (parsed as { connection_id?: unknown }).connection_id : undefined
  // Only an absent field reads as empty: a null or a number is not a connection (fail closed).
  const owner = isObject && field === undefined ? '' : field
  const id = isObject ? (parsed as { id?: unknown }).id : undefined

  if (typeof owner !== 'string' || id !== runId) {
    console.error('Unexpected answer from the orchestrator to a micro-segmentation run read')

    return runNotFound()
  }

  return owner && owner !== connectionId ? runNotFound() : null
}

/** The orchestrator's answer as the UI gets it. `runId` is the run a run read asked for. */
async function upstreamAnswer(upstream: Response, trace: RelayTrace, route: MicrosegRoute, connectionId: string, runId: string): Promise<Response> {
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

  if (route.urlClusterRun) {
    // Whatever the orchestrator's wording, an unknown run reads as a run the caller may not see.
    if (upstream.status === 404) return runNotFound()

    const refused = upstream.status >= 200 && upstream.status < 300 ? foreignRunRefusal(text, connectionId, runId) : null

    if (refused) return refused
  }

  return new NextResponse(text, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
  })
}

/** True for the orchestrator's refusal of a call whose checked clusters are no longer the links of the policy. */
async function clustersChanged(upstream: Response): Promise<boolean> {
  if (upstream.status !== 409) return false
  try {
    const payload = (await upstream.clone().json()) as { code?: unknown } | null

    return payload?.code === 'CLUSTERS_CHANGED'
  } catch {
    return false
  }
}

/** The answer to a call that threw on the way. */
function failureAnswer(error: any, trace: RelayTrace): Response {
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

async function forward(request: NextRequest, connectionId: string, path: string[], route: MicrosegRoute, trace: RelayTrace): Promise<Response> {
  let target: string

  try {
    target = `/microseg/${orchestratorSegment(connectionId, 'connection id')}/${path.join('/')}${new URL(request.url).search}`
  } catch (error) {
    if (!(error instanceof OrchestratorPathError)) throw error

    return refusal(error.status, 'INVALID', error.message)
  }

  try {
    // The URL's connection first: a caller refused there gets its 401, 403 or
    // 404 before the body is read or any other connection is looked at.
    const urlDenied = await connectionRefusal(connectionId, route.write)

    if (urlDenied) return urlDenied

    const read = request.method === 'GET' ? '' : await readBoundedBody(request)

    if (read === null) return refusal(413, 'INVALID', 'Request body too large')
    trace.body = read

    const associated = route.associate ? associatedConnection(read) : null

    if (route.associate && !associated) return refusal(400, 'INVALID', 'The body must be exactly {"connection_id": "<id>"}')

    const checked = await policyCheck(connectionId, route, associated, request.signal)

    if (checked instanceof Response) return checked
    // The clusters were just read for the rights: that answer is the call's own.
    if (route.clustersRead && checked) return NextResponse.json(checked.answer)

    const body = associated ? JSON.stringify({ connection_id: associated }) : read
    // After a clusters read, the call carries the set checked: the orchestrator refuses it if the links moved since.
    const send = (linked: LinkedClusters | null) => orchestratorRelay(target, {
      method: route.method,
      body: body || undefined,
      signal: request.signal,
      ...(linked ? { headers: { [CHECKED_CLUSTERS_HEADER]: linked.ids.join(',') } } : {}),
    })

    trace.reached = true

    let upstream = await send(checked)

    if (checked && (await clustersChanged(upstream))) {
      // Refused before any effect: the clusters are read and checked again, then the call is sent once more.
      trace.reached = false

      const again = await policyCheck(connectionId, route, associated, request.signal)

      if (again instanceof Response) return again
      trace.reached = true
      upstream = await send(again)
      if (await clustersChanged(upstream)) return refusal(409, 'VERSION_CONFLICT', 'The clusters of the policy changed: read them again')
    }

    return await upstreamAnswer(upstream, trace, route, connectionId, path[1] ?? '')
  } catch (error) {
    return failureAnswer(error, trace)
  }
}

export const GET = relay
export const POST = relay
export const PUT = relay
export const DELETE = relay
