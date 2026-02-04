// src/app/api/v1/orchestrator/drs/check-migration/[vmid]/route.ts

import { NextRequest, NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// Types pour la réponse
export interface LocalDiskInfo {
  device: string
  storage: string
  volume: string
  size: number
  size_str: string
  is_shared: boolean
  storage_type: string
}

export interface TargetStorageInfo {
  storage: string
  node: string
  total_size: number
  used_size: number
  avail_size: number
  usage_percent: number
  used_after: number
  avail_after: number
  usage_after_pct: number
  will_exceed: boolean
  warning_level: 'ok' | 'warning' | 'critical' | 'full'
}

export interface MigrationCheckResult {
  can_migrate: boolean
  migration_safe: boolean
  warning?: string
  local_disks: LocalDiskInfo[]
  shared_disks?: LocalDiskInfo[]
  total_local_size: number
  total_shared_size: number
  estimated_time?: string
  target_storage?: TargetStorageInfo
}

// GET /api/v1/orchestrator/drs/check-migration/[vmid]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ vmid: string }> }
) {
  try {
    // RBAC: Vérifier la permission de voir le DRS
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { vmid } = await params
    const searchParams = request.nextUrl.searchParams
    const connectionId = searchParams.get('connection_id')
    const node = searchParams.get('node')
    const targetNode = searchParams.get('target_node')
    const type = searchParams.get('type') || 'qemu'

    if (!connectionId || !node) {
      return NextResponse.json(
        { error: 'connection_id and node are required' },
        { status: 400 }
      )
    }

    const client = getOrchestratorClient()
    
    // Construire le path avec les query params (inclure target_node si fourni)
    let path = `/drs/check-migration/${vmid}?connection_id=${encodeURIComponent(connectionId)}&node=${encodeURIComponent(node)}&type=${encodeURIComponent(type)}`
    
    if (targetNode) {
      path += `&target_node=${encodeURIComponent(targetNode)}`
    }
    
    const response = await client.get<MigrationCheckResult>(path)
    
    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("Error checking migration:", e)
    
    // Retourner une réponse par défaut en cas d'erreur (migration possible mais non vérifiée)
    return NextResponse.json({
      can_migrate: true,
      migration_safe: true,
      local_disks: [],
      shared_disks: [],
      total_local_size: 0,
      total_shared_size: 0,
      warning: undefined,
      estimated_time: undefined,
      target_storage: undefined
    } as MigrationCheckResult)
  }
}