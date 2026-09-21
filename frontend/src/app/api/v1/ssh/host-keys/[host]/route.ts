import { NextResponse } from "next/server"

import { safeLog } from "@/lib/log/sanitize"
import { orchestratorFetch, parseOrchestratorError } from "@/lib/orchestrator"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { forgetHostKey } from "@/lib/ssh/host-key-store"

export const runtime = "nodejs"

// DELETE /api/v1/ssh/host-keys/[host]
//
// Re-trust a node: drop the pinned SSH host key in BOTH TOFU stores so the
// next connection pins whatever key the node presents now. A reinstalled node
// comes back with a fresh key and is otherwise refused everywhere, with no way
// out but psql plus a container restart (#979).
//
// `host` is a bare host, never "host:port": the frontend store is cleared for
// every port it pinned that host on, matching the orchestrator's port-less key.
//
// Both stores are cleared even when the first one reports nothing pinned — the
// whole point is to leave no stale pin behind. 404 is reserved for the case
// where the orchestrator ANSWERED that it held nothing and the frontend store
// removed nothing either. When the orchestrator could not be reached we never
// 404: its pin may well still be in place, and `orchestratorUnavailable` tells
// the UI to warn about it instead of claiming the node was re-trusted.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ host: string }> | { host: string } }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE)
    if (denied) return denied

    const params = await Promise.resolve(ctx.params)
    const raw = (params as any)?.host

    const host = typeof raw === "string" ? raw.trim().toLowerCase() : ""
    // A path segment carrying a colon, a slash or whitespace is not a bare
    // host: reject rather than guess which half of "host:port" was meant.
    if (!host || /[:/\s]/.test(host)) {
      return NextResponse.json(
        { error: "Invalid host: expected a bare host name or address, without a port" },
        { status: 400 }
      )
    }

    let orchestratorCleared = false
    let orchestratorAnswered = false
    let orchestratorUnavailable = false

    try {
      await orchestratorFetch(`/ssh/host-keys/${encodeURIComponent(host)}`, { method: "DELETE" })
      orchestratorCleared = true
      orchestratorAnswered = true
    } catch (error: any) {
      const parsed = parseOrchestratorError(error)
      if (parsed?.status === 404) {
        // The orchestrator answered: it simply held no pin for this host.
        orchestratorAnswered = true
      } else {
        // Unreachable, timed out, no host-key store configured (503), or any
        // other failure: we cannot claim its pin is gone.
        orchestratorUnavailable = true
        if (error?.code !== "ORCHESTRATOR_UNAVAILABLE") {
          console.error(
            "Failed to clear orchestrator SSH host key:",
            String(error?.message || "").replace(/[\r\n]/g, "")
          )
        }
      }
    }

    const frontendRows = await forgetHostKey(host)

    if (orchestratorAnswered && !orchestratorCleared && frontendRows === 0) {
      return NextResponse.json(
        { error: `no pinned host key for ${host}` },
        { status: 404 }
      )
    }

    console.log(
      `[ssh] re-trust: forgot host key for ${safeLog(host)} (orchestrator=${orchestratorCleared}, frontendRows=${frontendRows}, orchestratorUnavailable=${orchestratorUnavailable})`
    )

    return NextResponse.json({
      status: "forgotten",
      host,
      cleared: { orchestrator: orchestratorCleared, frontendRows },
      orchestratorUnavailable,
    })
  } catch (error: any) {
    console.error(
      "Failed to forget SSH host key:",
      String(error?.message || "").replace(/[\r\n]/g, "")
    )
    return NextResponse.json(
      { error: error?.message || "Failed to forget SSH host key" },
      { status: 500 }
    )
  }
}
