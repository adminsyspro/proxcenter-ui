// src/app/api/v1/orchestrator/drs/migrations/route.ts
import { NextResponse } from "next/server"

import { getOrchestratorClient } from "@/lib/orchestrator/client"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/orchestrator/drs/migrations
export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_VIEW, "global", "*")

    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const active = searchParams.get('active')

    const client = getOrchestratorClient()

    const response = active === 'true'
      ? await client.getActiveMigrations()
      : await client.getMigrations()

    // Retourner directement le tableau
    return NextResponse.json(response.data || [])
  } catch (e: any) {
    console.error("Error fetching migrations:", e)

    // Retourner un tableau vide en cas d'erreur pour éviter les erreurs frontend
    return NextResponse.json([])
  }
}
