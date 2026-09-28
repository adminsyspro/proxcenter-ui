import { forwardLicenseAction } from "@/lib/orchestrator/forwardLicenseAction"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// The orchestrator owns pairing and disconnection state.
export async function POST() {
  return forwardLicenseAction("/api/v1/license/connect", "POST", "connect")
}

export async function DELETE() {
  return forwardLicenseAction("/api/v1/license/connect", "DELETE", "disconnect")
}
