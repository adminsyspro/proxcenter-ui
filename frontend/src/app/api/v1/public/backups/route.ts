import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { loadPublicView, loadBackupFreshnessForView } from "@/lib/api-tokens/publicRoutePrologue"
import { PERMISSIONS } from "@/lib/rbac"
import type { Principal } from "@/lib/auth/principal"

export const runtime = "nodejs"

async function handler(_req: Request, ctx: { principal?: Principal }) {
  const principal = ctx?.principal
  const result = await loadPublicView(principal, PERMISSIONS.BACKUP_VIEW)
  if (!result.ok) return result.response

  const freshness = await loadBackupFreshnessForView(result.view)
  return NextResponse.json({ data: freshness })
}

export const GET = withPublicApiGuard("public-backups", handler)
