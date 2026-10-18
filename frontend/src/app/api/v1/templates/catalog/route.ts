// src/app/api/v1/templates/catalog/route.ts
import { NextResponse } from "next/server"

import { getCurrentTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { customImageToCloudImage } from "@/lib/templates/cloudImages"
import { getEffectiveCatalog } from "@/lib/templates/catalogStore"
import { customImageScopeWhere } from "@/lib/templates/customImageScope"
import { granteeVdcIds, loadGrantSummaries } from "@/lib/templates/catalogGrants"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const isProvider = tenantId === DEFAULT_TENANT_ID
    const { searchParams } = new URL(req.url)
    const vendor = searchParams.get("vendor")

    // Built-in images: the remote catalog when a valid one is stored, the
    // embedded document otherwise. Always shared with every tenant.
    const effective = await getEffectiveCatalog()
    const builtIn = vendor ? effective.images.filter(img => img.vendor === vendor) : effective.images
    const builtInWithFlag = builtIn.map(img => ({ ...img, isCustom: false, isShared: true }))

    // Custom images visible to the caller:
    //  - the provider sees ALL its own custom images (shared and private)
    //  - tenants see THEIR own custom images PLUS shared catalogue entries
    //    flagged isShared=true on the provider tenant, PLUS the provider
    //    entries granted to the tenant or to the vDC in view (#903).
    // The clause lives in lib/templates/customImageScope so the deploy route
    // resolves a slug with exactly this scope: when the two drifted apart, a
    // shared template was listed here and then refused at deploy.
    const customRows = await granteeVdcIds(tenantId)
      .then(vdcIds => prisma.customImage.findMany({
        where: customImageScopeWhere(tenantId, vdcIds),
        orderBy: { createdAt: 'desc' },
      }))
      .catch(() => [])
    // The provider gets the grants of each entry for the visibility column;
    // a tenant learns which cards are its own (editable) and which it only
    // sees through sharing or a grant.
    const grants = isProvider
      ? await loadGrantSummaries('image', customRows.map(r => r.id)).catch(() => new Map())
      : new Map()
    let customImages = customRows.map(row => ({
      ...customImageToCloudImage(row),
      ownedByCaller: row.tenantId === tenantId,
      ...(isProvider ? { grants: grants.get(row.id) ?? { tenantIds: [], vdcIds: [] } } : {}),
    }))
    if (vendor) {
      customImages = customImages.filter(img => img.vendor === vendor)
    }

    // Merge: built-in first, then custom
    const images = [...builtInWithFlag, ...customImages]

    // Build vendor list: built-in vendors + any custom vendors
    const customVendorIds = new Set(customRows.map(r => r.vendor))
    const extraVendors = [...customVendorIds]
      .filter(v => !effective.vendors.some(bv => bv.id === v))
      .map(v => ({ id: v, name: v.charAt(0).toUpperCase() + v.slice(1), icon: 'ri-image-line' }))

    // meta carries the mirror URL, and lastError embeds that URL on an HTTP
    // failure. TEMPLATE_CATALOG_URL can point at an internal mirror with a
    // signed token, so both are provider-only. Tenants keep source, dates and
    // lastResult, which is everything the tab renders for them.
    const meta = isProvider
      ? effective.meta
      : { ...effective.meta, url: null, lastError: null }

    return NextResponse.json({
      data: {
        images,
        vendors: [...effective.vendors, ...extraVendors],
        meta,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
