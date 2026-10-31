/**
 * Runs an approved action card through the route the UI button already calls
 * (roadmap#188), in process and inside the user's own request.
 *
 * No new privilege: the handler is the exported route itself, already wrapped
 * by withAudit() and withPublicApiGuard(), and Next's request context
 * (`headers()`, `cookies()`) is still the one of the execute call, so the
 * session, RBAC, the vDC guard and the audit row are exactly those of the
 * normal button. Only the URL, method, params and JSON body are built here,
 * from the signed card; nothing of the browser's request is forwarded.
 *
 * Precedent for importing a route handler: the internal console, shell and
 * spice consume routes (`app/api/internal/console/consume/route.ts`...).
 *
 * Server only.
 */

import { POST as guestPowerRoute } from '@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/[action]/route'
import { POST as migrateRoute } from '@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/migrate/route'
import { POST as backupJobGuestsRoute } from '@/app/api/v1/connections/[id]/backup-jobs/[jobId]/guests/route'
import { DELETE as maintenanceExitRoute, POST as maintenanceEnterRoute } from '@/app/api/v1/connections/[id]/nodes/[node]/maintenance/route'
import { POST as snapshotRoute } from '@/app/api/v1/guests/[vmid]/snapshots/route'
import { POST as drsActionRoute } from '@/app/api/v1/orchestrator/drs/recommendations/[id]/[action]/route'
import { invalidateInventoryCache } from '@/lib/cache/inventoryCache'

import type { ActionCard } from './types'

export type DispatchResult = {
  httpStatus: number
  /** The route's JSON answer, null when it sent none. */
  body: any
  /** The Proxmox task the route started, when it answered one (R5). */
  upid?: string
}

type RouteHandler = (req: Request, ctx: { params: Promise<any> }) => Response | Promise<Response>

type RouteCall = {
  handler: RouteHandler
  method: 'POST' | 'DELETE'
  path: string
  params: Record<string, string>
  body?: Record<string, unknown>
}

const seg = (v: string | number) => encodeURIComponent(String(v))

function guestOf(card: ActionCard): { connId: string; type: 'qemu' | 'lxc'; node: string; vmid: string } {
  const t = card.target

  if (t.vmid === undefined || !t.guestKind) throw new Error(`A ${card.kind} card needs a guest target`)

  return { connId: t.connId, type: t.guestKind, node: t.node, vmid: String(t.vmid) }
}

/** The existing route each kind goes through, with the exact params and body the UI sends. */
export function routeFor(card: ActionCard): RouteCall {
  switch (card.kind) {
    case 'start':
    case 'shutdown':
    case 'reboot': {
      const g = guestOf(card)

      return {
        handler: guestPowerRoute,
        method: 'POST',
        path: `/api/v1/connections/${seg(g.connId)}/guests/${g.type}/${seg(g.node)}/${seg(g.vmid)}/${card.kind}`,
        params: { id: g.connId, type: g.type, node: g.node, vmid: g.vmid, action: card.kind },
      }
    }
    case 'snapshot': {
      const g = guestOf(card)
      const key = `${g.connId}:${g.type}:${g.node}:${g.vmid}`

      return {
        handler: snapshotRoute,
        method: 'POST',
        path: `/api/v1/guests/${seg(key)}/snapshots`,
        params: { vmid: key },
        body: { name: String(card.params.name ?? '') },
      }
    }
    case 'migrate': {
      const g = guestOf(card)

      return {
        handler: migrateRoute,
        method: 'POST',
        path: `/api/v1/connections/${seg(g.connId)}/guests/${g.type}/${seg(g.node)}/${seg(g.vmid)}/migrate`,
        params: { id: g.connId, type: g.type, node: g.node, vmid: g.vmid },
        body: { target: String(card.params.target ?? ''), online: true },
      }
    }
    case 'drs_apply': {
      const id = String(card.params.recommendationId ?? '')

      return {
        handler: drsActionRoute,
        method: 'POST',
        path: `/api/v1/orchestrator/drs/recommendations/${seg(id)}/execute`,
        params: { id, action: 'execute' },
      }
    }
    case 'backup_add': {
      const g = guestOf(card)
      const jobId = String(card.params.jobId ?? '')

      return {
        handler: backupJobGuestsRoute,
        method: 'POST',
        path: `/api/v1/connections/${seg(g.connId)}/backup-jobs/${seg(jobId)}/guests`,
        params: { id: g.connId, jobId },
        body: { vmid: Number(g.vmid) },
      }
    }
    case 'maintenance': {
      const exit = card.params.mode === 'exit'

      if (!exit && card.params.mode !== 'enter') throw new Error(`Unknown maintenance mode "${String(card.params.mode)}"`)

      return {
        handler: exit ? maintenanceExitRoute : maintenanceEnterRoute,
        method: exit ? 'DELETE' : 'POST',
        path: `/api/v1/connections/${seg(card.target.connId)}/nodes/${seg(card.target.node)}/maintenance`,
        params: { id: card.target.connId, node: card.target.node },
      }
    }
    default:
      throw new Error(`Unknown action "${String((card as { kind: unknown }).kind)}"`)
  }
}

const isUpid = (v: unknown): v is string => typeof v === 'string' && v.startsWith('UPID:')

/** The task id of a 2xx answer: `data` itself (power, migrate) or `data.upid` (snapshot). */
export function upidOf(body: any): string | undefined {
  return [body?.data, body?.data?.upid, body?.upid].find(isUpid)
}

async function readBody(res: Response): Promise<any> {
  const text = await res.text().catch(() => '')

  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return { error: text.slice(0, 500) }
  }
}

/**
 * Calls the card's route and hands back its status and answer untouched: a
 * 403 of the route stays a 403. A handler that throws (withAudit rethrows
 * after writing its failure row), or a card no route maps, is reported as
 * the 500 Next would answer.
 */
export async function dispatchAction(card: ActionCard, baseUrl = 'http://localhost'): Promise<DispatchResult> {
  let res: Response

  try {
    const call = routeFor(card)
    const payload = call.body === undefined ? undefined : JSON.stringify(call.body)
    const headers: Record<string, string> = {}

    // withAudit() records a JSON body only when its length is declared.
    if (payload !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(payload))
    }

    const req = new Request(new URL(call.path, baseUrl), { method: call.method, headers, body: payload })

    res = await call.handler(req, { params: Promise.resolve(call.params) })
  } catch (e: unknown) {
    return { httpStatus: 500, body: { error: e instanceof Error ? e.message : String(e) } }
  }

  // The maintenance route runs over SSH and leaves the inventory cache as it
  // was, unlike the guest routes: without this, the exit step of a plan
  // replayed right after the enter step would read a host not yet in
  // maintenance and be refused.
  if (res.ok && card.kind === 'maintenance') invalidateInventoryCache()

  const body = await readBody(res)
  const upid = res.ok ? upidOf(body) : undefined

  return { httpStatus: res.status, body, ...(upid ? { upid } : {}) }
}
