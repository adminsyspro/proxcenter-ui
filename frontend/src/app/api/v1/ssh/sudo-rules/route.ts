import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { loadSudoRules } from "@/lib/ssh/loadSudoRules"

export const runtime = "nodejs"

// GET /api/v1/ssh/sudo-rules
// The rules of the restricted sudoers template: the orchestrator's (rolling
// updates, host drain, Site Recovery) and the frontend's own (node actions,
// Network Flows, compliance). Same audience as the allowlist: the command
// schema only, no credential and no host name.
export async function GET() {
  const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
  if (denied) return denied

  return NextResponse.json(await loadSudoRules())
}
