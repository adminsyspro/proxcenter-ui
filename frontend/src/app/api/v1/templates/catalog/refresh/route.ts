// src/app/api/v1/templates/catalog/refresh/route.ts
//
// Manual "Check for updates" for the built-in cloud image catalog. The same
// refresh runs daily from instrumentation-node.ts; this route exists for the
// provider admin who just merged a catalog change and for air-gapped sites
// that disabled the background task and point TEMPLATE_CATALOG_URL at a
// mirror.
import { NextResponse } from "next/server"

import { requireAdmin } from "@/lib/rbac"
import { getCurrentTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { getEffectiveCatalog, refreshRemoteCatalog } from "@/lib/templates/catalogStore"

export const runtime = "nodejs"

export async function POST() {
  try {
    const denied = await requireAdmin()
    if (denied) return denied

    // The catalog is global: only the provider tenant may refresh it.
    const tenantId = await getCurrentTenantId()
    if (tenantId !== DEFAULT_TENANT_ID) {
      return NextResponse.json({ error: "Only the provider can refresh the image catalog" }, { status: 403 })
    }

    const outcome = await refreshRemoteCatalog()

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "update",
      category: "templates",
      resourceType: "image_catalog",
      resourceName: "cloud-images",
      details: {
        result: outcome.result,
        added: outcome.added.length,
        updated: outcome.updated.length,
        removed: outcome.removed.length,
      },
      status: outcome.result === "error" ? "failure" : "success",
      errorMessage: outcome.error ?? undefined,
    })

    const { meta } = await getEffectiveCatalog()
    // HTTP 200 even on result 'error': the refresh ran and the UI shows the
    // message. Only unexpected exceptions become a 500.
    return NextResponse.json({ data: { ...outcome, meta } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
