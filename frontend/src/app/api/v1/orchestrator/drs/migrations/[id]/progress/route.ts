// src/app/api/v1/orchestrator/drs/migrations/[id]/progress/route.ts

import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

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

// GET /api/v1/orchestrator/drs/migrations/[id]/progress
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // RBAC: Vérifier la permission de voir le DRS
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { id } = await params

    const client = getOrchestratorClient()
    const response = await client.get<MigrationProgress>(`/drs/migrations/${id}/progress`)
    
    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error fetching migration progress:", e)
    
return NextResponse.json(
      { error: e.message || 'Failed to fetch migration progress' },
      { status: 500 }
    )
  }
}