import { NextRequest } from "next/server"

import { subscribe, type InventoryEvent } from "@/lib/cache/inventoryPoller"
import { getTenantConnectionIds } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
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

      // Subscribe to inventory changes — filter by tenant connections
      unsubscribe = subscribe((events: InventoryEvent[]) => {
        if (closed) return
        for (const ev of events) {
          if (tenantConnIds.has(ev.connId)) {
            send(ev.event, ev)
          }
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
