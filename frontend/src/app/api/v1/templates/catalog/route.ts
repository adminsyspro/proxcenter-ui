// src/app/api/v1/templates/catalog/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { CLOUD_IMAGES, VENDORS, getImagesByVendor, customImageToCloudImage } from "@/lib/templates/cloudImages"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const vendor = searchParams.get("vendor")

    // Built-in images
    const builtIn = vendor ? getImagesByVendor(vendor) : CLOUD_IMAGES
    const builtInWithFlag = builtIn.map(img => ({ ...img, isCustom: false }))

    // Custom images from DB
    const customRows = await prisma.customImage.findMany({
      orderBy: { createdAt: 'desc' },
    })
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
