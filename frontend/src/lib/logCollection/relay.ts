// How the firewall logs of a Proxmox VE cluster reach the micro-segmentation
// engine: read through the Proxmox API (the default) or sent by a forwarder
// installed on each node. A setting of the cluster connection, relayed to the
// leader orchestrator (/api/v1/logfwd/{connectionId}/...), whose status and
// body come back unchanged: the UI reads the code of a refusal and the checks
// of a failed preflight.
//
// Rights, as on the connection itself (PATCH /connections/{id}):
// connection.view to read, connection.manage for the rest, then the
// connection is read through the session's tenant, so one of another tenant
// is not found. It must be a Proxmox VE connection. Each route refuses a vDC
// (iaas) tenant itself, before it calls this.
import { NextResponse } from 'next/server'

import { orchestratorRelay } from '@/lib/orchestrator/client'
// The path grammar has no dependency: it keeps the real checks where the client is mocked.
import { OrchestratorPathError, orchestratorSegment } from '@/lib/orchestrator/path'
import { getSessionPrisma } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

/** The settings are five short values: anything larger is not one. */
const MAX_BODY_BYTES = 16 * 1024

const NO_BODY_STATUSES = new Set([101, 204, 205, 304])

export interface LogCollectionCall {
  method: 'GET' | 'PUT' | 'POST'
  /** What follows /logfwd/{connectionId} on the orchestrator, built from validated segments. */
  path: (segment: typeof orchestratorSegment) => string
  /** The call carries the settings as a JSON object. */
  body?: boolean
  /** Reads need connection.view; everything else connection.manage. */
  write: boolean
}

function refusal(status: number, code: string, error: string) {
  return NextResponse.json({ code, error }, { status })
}

/** The body as text when it is a JSON object within the size limit, else null. */
async function readSettings(request: Request): Promise<string | null> {
  const text = await request.text().catch(() => '')

  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return null
  try {
    const parsed: unknown = JSON.parse(text)

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? text : null
  } catch {
    return null
  }
}

/** Checks the caller on the connection, then relays the call to the leader orchestrator and its answer back. */
export async function relayLogCollection(request: Request, connectionId: string, call: LogCollectionCall): Promise<Response> {
  let path: string

  try {
    path = `/logfwd/${orchestratorSegment(connectionId, 'connection id')}${call.path(orchestratorSegment)}`
  } catch (error) {
    if (error instanceof OrchestratorPathError) return refusal(400, 'INVALID', error.message)
    throw error
  }

  const denied = await checkPermission(call.write ? PERMISSIONS.CONNECTION_MANAGE : PERMISSIONS.CONNECTION_VIEW, 'connection', connectionId)

  if (denied) return denied

  const prisma = await getSessionPrisma()
  const connection = await prisma.connection.findUnique({ where: { id: connectionId }, select: { type: true } })

  if (!connection) return refusal(404, 'NOT_FOUND', 'Connection not found')
  if (connection.type !== 'pve') return refusal(400, 'NOT_PVE', 'The firewall log collection is a setting of a Proxmox VE cluster')

  let body: string | undefined

  if (call.body) {
    const text = await readSettings(request)

    if (text === null) return refusal(400, 'INVALID', 'The body must be a JSON object of the settings')
    body = text
  }

  let upstream: Response

  try {
    upstream = await orchestratorRelay(path, {
      method: call.method,
      body,
      signal: request.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      // A preflight opens an SSH session on every node of the cluster.
      timeout: 60_000,
    })
  } catch {
    return refusal(503, 'ORCHESTRATOR_UNAVAILABLE', 'The orchestrator did not answer')
  }

  if (NO_BODY_STATUSES.has(upstream.status)) return new NextResponse(null, { status: upstream.status })

  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json' },
  })
}
