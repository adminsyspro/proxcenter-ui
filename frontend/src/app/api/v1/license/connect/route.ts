import { forwardLicenseAction } from "@/lib/orchestrator/forwardLicenseAction"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The orchestrator owns pairing and disconnection state.
async function handlePost() {
  return forwardLicenseAction("/api/v1/license/connect", "POST", "connect", { providerOnly: true })
}

async function handleDelete() {
  return forwardLicenseAction("/api/v1/license/connect", "DELETE", "disconnect", { providerOnly: true })
}

export const POST = withAudit({ category: "system", resourceType: "connect" }, handlePost)
export const DELETE = withAudit({ category: "system", resourceType: "connect" }, handleDelete)
