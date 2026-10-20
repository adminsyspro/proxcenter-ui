import { forwardLicenseAction } from "@/lib/orchestrator/forwardLicenseAction"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handlePost() {
  return forwardLicenseAction("/api/v1/license/checkin", "POST", "checkin", {
    keepUpstreamStatus: true,
    providerOnly: true,
    fallbackError: "Failed to check in",
  })
}

export const POST = withAudit({ category: "system", resourceType: "checkin" }, handlePost)
