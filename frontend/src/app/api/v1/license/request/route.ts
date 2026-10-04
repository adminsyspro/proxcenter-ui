import { forwardLicenseAction } from "@/lib/orchestrator/forwardLicenseAction"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Downloads the signed license request built by the orchestrator. The file
// is opaque here: it is streamed as-is so the portal verifies the exact bytes.
export async function GET() {
  return forwardLicenseAction("/api/v1/license/request", "GET", "request generation", {
    providerOnly: true,
    downloadDisposition: 'attachment; filename="proxcenter-license-request.json"',
    fallbackError: "Failed to generate the license request",
  })
}
