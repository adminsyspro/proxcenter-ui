// src/app/api/v1/orchestrator/drs/migrations/[id]/progress/route.ts

import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantConnectionIds } from "@/lib/tenant"

export const runtime = "nodejs"

export interface MigrationProgress {
  migration_id: string
  vmid: number
  vm_name: string
  guest_type?: string
  source_node: string
  target_node: string
  status: string
  progress: number
  message: string
  started_at: string
}

// GET /api/v1/orchestrator/drs/migrations/[id]/progress — tenant-scoped
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")
    if (denied) return denied

    const { id } = await params

    // Verify migration belongs to tenant
    const tenantConnectionIds = await getTenantConnectionIds()
    const client = getOrchestratorClient()

    // Check ownership via the migration itself
    const migsRes = await client.getMigrations().catch(() => ({ data: [] }))
    const migs = Array.isArray(migsRes.data) ? migsRes.data : []
    const mig = migs.find((m: any) => m.id === id || m.migration_id === id)
    if (mig?.connection_id && !tenantConnectionIds.has(mig.connection_id)) {
      return NextResponse.json({ error: 'Migration not found' }, { status: 404 })
    }

    const response = await client.get<MigrationProgress>(`/drs/migrations/${id}/progress`)

    return NextResponse.json(response.data)
  } catch (e: any) {
    if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error fetching migration progress:", e)
    }
    
return NextResponse.json(
      { error: e.message || 'Failed to fetch migration progress' },
      { status: 500 }
    )
  }
}