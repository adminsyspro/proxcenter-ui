import { NextResponse } from "next/server"

import { orchestratorHeaders } from "@/lib/orchestrator/headers"
import { isOfflineMode } from "@/lib/offline"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// Default community license status when orchestrator is unavailable
const DEFAULT_COMMUNITY_STATUS = {
  licensed: false,
  expired: false,
  edition: 'community',
  features: ['dashboard', 'inventory', 'backups', 'storage'],
  options: [],
}

// Whoever holds the pairing code can approve the pairing on the portal and
// own the instance, so the code, its link and the identity of the pairing
// only go to the people allowed to connect (the same gates as the connect
// route). Everyone else still reads the rest of the status.
const PAIRING_SECRETS = ["user_code", "verification_url", "pairing_expires_at", "customer_name", "instance_id"]

async function canSeePairingSecrets(): Promise<boolean> {
  try {
    if (await requireProviderTenant()) return false

    return !(await checkPermission(PERMISSIONS.ADMIN_SETTINGS))
  } catch {
    return false
  }
}

async function withVisibleConnection(data: any): Promise<any> {
  const connection = data?.connection
  if (!connection || typeof connection !== "object") return data
  if (await canSeePairingSecrets()) return data
  const visible = { ...connection }
  for (const key of PAIRING_SECRETS) delete visible[key]

  return { ...data, connection: visible }
}

export async function GET() {
  const offline = isOfflineMode()

  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/license/status`, {
      headers: orchestratorHeaders(),
      cache: "no-store",
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error || `HTTP ${res.status}`, offline },
        { status: res.status }
      )
    }

    return NextResponse.json({ ...(await withVisibleConnection(data)), offline })
  } catch (e: any) {
    // Return default community license when orchestrator is unavailable (silent)
    if (e?.message?.includes('ECONNREFUSED') ||
        e?.message?.includes('fetch failed') ||
        e?.message?.includes('timeout')) {
      return NextResponse.json({ ...DEFAULT_COMMUNITY_STATUS, offline })
    }

    // Log only unexpected errors
    console.error("License status fetch failed:", e?.message)

    return NextResponse.json(
      { error: e?.message || "Failed to fetch license status", offline },
      { status: 500 }
    )
  }
}
