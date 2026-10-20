// src/app/api/v1/orchestrator/drs/recommendations/[id]/[action]/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { relayOrchestratorError } from "@/lib/orchestrator/relayError"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string; action: string }> }

// POST /api/v1/orchestrator/drs/recommendations/{id}/{action}
// Actions: approve, reject, execute
async function handlePost(req: Request, ctx: Params) {
  try {
    const { id, action } = await ctx.params

    const permission = action === 'execute'
      ? PERMISSIONS.VM_MIGRATE
      : PERMISSIONS.AUTOMATION_MANAGE

    const denied = await checkPermission(permission, "global", "*")
    if (denied) return denied

    // Verify recommendation belongs to tenant
    const client = getOrchestratorClient()
    const recsRes = await client.getRecommendations(false)
    const recs = Array.isArray(recsRes.data) ? recsRes.data : []
    const rec = recs.find((r: any) => r.id === id)
    if (rec?.connection_id) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(rec.connection_id)) {
        return NextResponse.json({ error: 'Recommendation not found' }, { status: 404 })
      }
    }

    let response

    switch (action) {
      case 'approve':
        response = await client.approveRecommendation(id)
        break
      case 'reject':
        response = await client.rejectRecommendation(id)
        break
      case 'execute': {
        // Safety guard: check active migrations before executing
        try {
          const activeMigsRes = await client.getActiveMigrations()
          const activeMigs = Array.isArray(activeMigsRes.data) ? activeMigsRes.data : []
          const activeMigCount = activeMigs.filter((m: any) => m.status === 'running' || m.status === 'pending').length

          // Get max_concurrent_migrations from settings (default 2)
          let maxConcurrent = 2
          try {
            const settingsRes = await client.get('/drs/settings')
            maxConcurrent = settingsRes.data?.max_concurrent_migrations || 2
          } catch {}

          if (activeMigCount >= maxConcurrent) {
            return NextResponse.json(
              { error: `Too many active migrations (${activeMigCount}/${maxConcurrent}). Wait for current migrations to complete.` },
              { status: 429 }
            )
          }
        } catch (e) {
          // If we can't check, let the Go orchestrator enforce the limit
          console.warn('[DRS] Could not verify active migration count:', e)
        }

        response = await client.executeRecommendation(id)
        break
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

    return NextResponse.json(response.data)
  } catch (e: any) {
    // A refusal (409: rolling update, drain, placement...) or a missing
    // recommendation (404) keeps its status and its reason, so the page can
    // tell the operator why instead of a bare 500.
    return relayOrchestratorError(e, "Error executing recommendation action:")
  }
}

export const POST = withAudit({ category: "automation", resourceType: "recommendation", resourceParam: "id", action: "execute" }, handlePost)
