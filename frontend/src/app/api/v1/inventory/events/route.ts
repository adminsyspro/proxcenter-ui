import { NextRequest } from "next/server"

import { subscribe, type InventoryEvent } from "@/lib/cache/inventoryPoller"
import { getCurrentTenantId, getTenantConnectionIds } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { checkPermission, PERMISSIONS, getRBACContext, getRbacInfraScope, isConnectionVisible, type RbacInfraScope } from "@/lib/rbac"
import { demoResponse } from "@/lib/demo/demo-api"

export const runtime = "nodejs"

/**
 * GET /api/v1/inventory/events
 *
 * Persistent SSE connection that pushes real-time inventory changes.
 * The backend polls PVE /cluster/resources every ~10s and pushes only
 * the deltas (VM status changes, node changes, VM additions/removals).
 *
 * Events are filtered to only include connections belonging to the
 * current user's tenant.
 *
 * Events:
 *   - event: vm:update    → { connId, vmid, node, type, status, cpu?, mem?, ... }
 *   - event: node:update  → { connId, node, status, cpu?, mem?, maxmem? }
 *   - event: vm:added     → { connId, vmid, node, type, status, name?, ... }
 *   - event: vm:removed   → { connId, vmid, node, type }
 *   - event: heartbeat    → {}  (keep-alive every 30s)
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

  const encoder = new TextEncoder()

  let unsubscribe: (() => void) | null = null
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: any) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // Client disconnected
          closed = true
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
      unsubscribe = subscribe((events: InventoryEvent[]) => {
        if (closed) return
        for (const ev of events) {
          if (!tenantConnIds.has(ev.connId)) continue

          // RBAC infra scope: drop events for connections the user cannot see.
          if (rbacScope && !isConnectionVisible(rbacScope, ev.connId)) continue

          // Generic node-level gate: applies to ALL event types that carry a node.
          // When the user holds a node-scoped grant on this connection (i.e. the
          // connection is NOT in fullConnections), every event whose node is not in
          // the granted set must be dropped. Connection-level events without a node
          // field already passed the connection gate above and are kept as-is.
          // This subsumes the old node:update-only check and also covers vm:* events.
          if (rbacScope && !rbacScope.fullConnections.has(ev.connId)) {
            const evNode = (ev as { node?: string }).node
            if (evNode !== undefined) {
              const allowedNodes = rbacScope.nodesByConnection.get(ev.connId)
              if (!allowedNodes || !allowedNodes.has(evNode)) continue
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

          send(ev.event, ev)
        }
      })
    },

    cancel() {
      closed = true
      if (unsubscribe) unsubscribe()
      if (heartbeatInterval) clearInterval(heartbeatInterval)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
