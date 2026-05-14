// src/app/api/v1/templates/catalog/route.ts
import { NextResponse } from "next/server"

import { getCurrentTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { CLOUD_IMAGES, VENDORS, getImagesByVendor, customImageToCloudImage } from "@/lib/templates/cloudImages"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)

    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const isProvider = tenantId === DEFAULT_TENANT_ID
    const { searchParams } = new URL(req.url)
    const vendor = searchParams.get("vendor")

    // Built-in images: hard-coded, treated as always shared.
    const builtIn = vendor ? getImagesByVendor(vendor) : CLOUD_IMAGES
    const builtInWithFlag = builtIn.map(img => ({ ...img, isCustom: false, isShared: true }))

    // Custom images visible to the caller:
    //  - the provider sees ALL its own custom images (shared and private)
    //  - tenants see THEIR own custom images PLUS shared catalogue entries
    //    flagged isShared=true on the provider tenant.
    // Implemented with a single OR query against the global prisma client
    // (we don't want the tenant-scoped extension here: we deliberately reach
    //  into the provider tenant for isShared rows).
    const where = isProvider
      ? { tenantId }
      : {
        OR: [
          { tenantId },
          { tenantId: DEFAULT_TENANT_ID, isShared: true },
        ],
      }

    const customRows = await prisma.customImage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    }).catch(() => [])

    let customImages = customRows.map(customImageToCloudImage)

    if (vendor) {
      customImages = customImages.filter(img => img.vendor === vendor)
    }

    // Merge: built-in first, then custom
    const images = [...builtInWithFlag, ...customImages]

    // Build vendor list: built-in vendors + any custom vendors
    const customVendorIds = new Set(customRows.map(r => r.vendor))

    const extraVendors = [...customVendorIds]
      .filter(v => !VENDORS.some(bv => bv.id === v))
      .map(v => ({ id: v, name: v.charAt(0).toUpperCase() + v.slice(1), icon: 'ri-image-line' }))

    return NextResponse.json({
      data: {
        images,
        vendors: [...VENDORS, ...extraVendors],
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
