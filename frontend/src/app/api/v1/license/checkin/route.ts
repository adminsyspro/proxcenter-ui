import { forwardLicenseAction } from "@/lib/orchestrator/forwardLicenseAction"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  return forwardLicenseAction("/api/v1/license/checkin", "POST", "checkin", {
    keepUpstreamStatus: true,
    providerOnly: true,
    fallbackError: "Failed to check in",
  })
}
