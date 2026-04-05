import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { runV2vPreflight, installV2vPackages } from "@/lib/migration/v2v-preflight"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return denied

  let body: {
    targetConnectionId?: string
    targetNode?: string
    requiredDiskBytes?: number
    action?: string
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { targetConnectionId, targetNode, requiredDiskBytes, action } = body

  if (!targetConnectionId || !targetNode) {
    return NextResponse.json(
      { error: "Missing required fields: targetConnectionId, targetNode" },
      { status: 400 }
    )
  }

  try {
    if (action === "install") {
      const result = await installV2vPackages(targetConnectionId, targetNode)
      return NextResponse.json(result)
    }

    const result = await runV2vPreflight(
      targetConnectionId,
      targetNode,
      requiredDiskBytes ?? 0
    )
    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    console.error("[migrations/preflight] Error:", message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
