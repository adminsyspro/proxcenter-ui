// src/app/api/v1/orchestrator/drs/recommendations/[id]/[action]/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string; action: string }> }

// POST /api/v1/orchestrator/drs/recommendations/{id}/{action}
// Actions: approve, reject, execute
export async function POST(req: Request, ctx: Params) {
  try {
    const { id, action } = await ctx.params

    // Vérifier la permission
    const permission = action === 'execute' 
      ? PERMISSIONS.VM_MIGRATE 
      : PERMISSIONS.AUTOMATION_MANAGE
    
    const denied = await checkPermission(permission, "global", "*")

    if (denied) return denied

    const client = getOrchestratorClient()
    let response

    switch (action) {
      case 'approve':
        response = await client.approveRecommendation(id)
        break
      case 'reject':
        response = await client.rejectRecommendation(id)
        break
      case 'execute':
        response = await client.executeRecommendation(id)
        break
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error executing recommendation action:", e)
    
return NextResponse.json(
      { error: e?.message || "Action failed" },
      { status: 500 }
    )
  }
}
