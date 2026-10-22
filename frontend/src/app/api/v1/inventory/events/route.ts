import { NextRequest } from "next/server"

import { subscribe, type InventoryEvent } from "@/lib/cache/inventoryPoller"
import { getCurrentTenantId, getTenantConnectionIds } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { checkPermission, PERMISSIONS, getRBACContext, getRbacInfraScope, mayHaveVisibleGuests, loadGuestVisibilityCheck, type GuestVisibilityCheck, type RbacInfraScope } from "@/lib/rbac"
import { demoResponse } from "@/lib/demo/demo-api"

export const runtime = "nodejs"

// What a consumer may leave unread from earlier deliveries before the next one
// drops it. Checked before enqueueing, never after: a poll cycle goes out as a
// single message, and on a large estate that one message can exceed this on
// its own. A live browser drains it well within the 15 s poll interval, so it
// is never dropped; a consumer that stopped reading holds at most this plus one
// delivery and goes at the next one.
const MAX_UNREAD_BYTES = 1024 * 1024

/**
 * GET /api/v1/inventory/events
 *
 * Persistent SSE connection that pushes real-time inventory changes.
 * The backend polls PVE /cluster/resources every ~15s and pushes only
 * the deltas (VM status changes, node changes, VM additions/removals).
 *
 * Events are filtered to only include connections belonging to the
 * current user's tenant.
 *
 * Events:
 *   - event: connected    → { ts }
 *   - event: batch        → [ ...deltas ]  one message per poll cycle, holding
 *                           the deltas that passed the filters below, each
 *                           tagged by its `event` field:
 *       vm:update    { event, connId, vmid, node, type, status, cpu?, mem?, ... }
 *       node:update  { event, connId, node, status, cpu?, mem?, maxmem? }
 *       vm:added     { event, connId, vmid, node, type, status, name?, ... }
 *       vm:removed   { event, connId, vmid, node, type }
 *   - event: heartbeat    → { ts }  (keep-alive every 30s)
 */

export async function GET(request: NextRequest) {
  const demo = demoResponse(request)
  if (demo) return demo

  const denied = await checkPermission(PERMISSIONS.VM_VIEW)
  if (denied) return denied

  // Resolve tenant connections upfront to filter events
  let tenantConnIds: Set<string>
  try {
    tenantConnIds = await getTenantConnectionIds()
  } catch {
    tenantConnIds = new Set()
  }

  // Resolve vDC scope (per-pool allowlist). When non-null, vm:* events on a
  // shared connection must additionally match the tenant's allowed pools —
  // otherwise vmid=X from vDC A leaks to vDC B because they share a PVE
  // cluster (same connId). node:* events stay connection-scoped only.
  const tenantId = await getCurrentTenantId()
  const vdcScope = maskingScope(await getTenantInfrastructureScope(tenantId))

  // Resolve RBAC infra scope once per request; null = admin/unrestricted (no pruning).
  // Prunes events for connections (and nodes) the user has no infra grant for.
  const rbacCtx = await getRBACContext()
  const rbacScope: RbacInfraScope | null = rbacCtx && !rbacCtx.isAdmin
    ? await getRbacInfraScope(rbacCtx.userId, rbacCtx.tenantId)
    : null

  // Guest-level predicate, loaded once: needed when the perimeter is derived
  // from tag/pool grants, which no connection or node check can answer.
  const guestCheck: GuestVisibilityCheck | null = rbacScope?.guestDerived
    ? await loadGuestVisibilityCheck(rbacCtx.userId, PERMISSIONS.VM_VIEW, rbacCtx.tenantId)
    : null

  const encoder = new TextEncoder()

  let unsubscribe: (() => void) | null = null
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null
  let closed = false

  // Releases everything this connection holds in the poller. Idempotent: it
  // runs from cancel(), from the request abort, from a failed enqueue and when
  // the consumer is dropped for not reading, whichever comes first.
  const teardown = () => {
    if (closed) return
    closed = true
    if (unsubscribe) unsubscribe()
    unsubscribe = null
    if (heartbeatInterval) clearInterval(heartbeatInterval)
    heartbeatInterval = null
    request.signal.removeEventListener('abort', teardown)
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: any) => {
        if (closed) return

        // Next stops pulling while the socket is backed up, so whatever the
        // consumer leaves unread stays in this queue. A consumer that stopped
        // reading without closing its TCP connection (a sleeping laptop, a
        // stalled proxy, a half-open socket) never fires cancel(): without this
        // bound the queue grew for as long as the process lived. The check
        // comes before the enqueue so it only ever sees what the consumer left
        // from EARLIER deliveries: a single oversized message is still sent,
        // and the consumer is judged on it at the next delivery.
        if ((controller.desiredSize ?? 0) < 0) {
          console.warn(`[inventory-events] Dropping an SSE consumer that left more than ${MAX_UNREAD_BYTES} bytes unread`)
          teardown()
          // Erroring discards the queue and makes Next destroy the response; a
          // live EventSource reconnects and reloads a fresh state.
          controller.error(new Error('SSE consumer stopped reading'))
          return
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // The stream is already closed or errored.
          teardown()
        }
      }

      // Send initial connected event
      send('connected', { ts: Date.now() })

      // Heartbeat to keep connection alive (some proxies close idle connections)
      heartbeatInterval = setInterval(() => {
        send('heartbeat', { ts: Date.now() })
      }, 30_000)

      // Subscribe to inventory changes — filter by tenant connections AND,
      // for VM events on a vDC-scoped tenant, by allowed pools.
      // Also filter by RBAC infra scope when the user is not an admin.
      // The survivors of one poll cycle go out as ONE `batch` message: one
      // enqueue per cycle keeps the backpressure check above meaningful (a
      // burst of per-event messages could never drain between two of them),
      // and the browser applies the whole cycle to its tree in one pass.
      const unsub = subscribe((events: InventoryEvent[]) => {
        if (closed) return
        const batch: InventoryEvent[] = []
        for (const ev of events) {
          if (!tenantConnIds.has(ev.connId)) continue

          // RBAC infra scope: drop events for connections the user cannot see.
          // A guest-derived (tag/pool) scope cannot rule a connection out here,
          // only the per-guest predicate below can (issue #633).
          if (rbacScope && !mayHaveVisibleGuests(rbacScope, ev.connId)) continue

          // Generic node-level gate: applies to ALL event types that carry a node.
          // When the user holds no whole-connection grant here, an event whose node
          // is not in the granted set is dropped, unless it is a vm:* event whose
          // guest matches a tag/pool grant. Connection-level events without a node
          // field already passed the connection gate above and are kept as-is.
          // This subsumes the old node:update-only check and also covers vm:* events.
          if (rbacScope && !rbacScope.fullConnections.has(ev.connId)) {
            const evNode = (ev as { node?: string }).node
            const allowedNodes = rbacScope.nodesByConnection.get(ev.connId)
            const nodeGranted = evNode !== undefined && !!allowedNodes && allowedNodes.has(evNode)

            if (ev.event.startsWith('vm:')) {
              // Granted node, or a guest matching a tag/pool grant.
              if (!nodeGranted && !(guestCheck && guestCheck(ev as any))) continue
            } else if (evNode !== undefined && !nodeGranted) {
              // Node-level events need a real node grant: a tag/pool user gets
              // guest deltas only, never host metrics.
              continue
            }
          }

          // vm:* events: enforce vDC pool boundary when scope active.
          if (vdcScope) {
            const allowedPools = vdcScope.poolsByConnection.get(ev.connId)
            const evPool = (ev as any).pool as string | undefined
            // No pool on the event = ambient/legacy state; safer to drop than
            // leak across vDCs sharing the same connection.
            if (!evPool || !allowedPools || !allowedPools.has(evPool)) continue
          }

          batch.push(ev)
        }
        if (batch.length > 0) send('batch', batch)
      })

      // The handler may already have torn the connection down before subscribe
      // returned its unsubscribe function.
      if (closed) unsub()
      else unsubscribe = unsub

      if (request.signal.aborted) teardown()
      else request.signal.addEventListener('abort', teardown)
    },

    cancel() {
      teardown()
    },
  }, new ByteLengthQueuingStrategy({ highWaterMark: MAX_UNREAD_BYTES }))

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
