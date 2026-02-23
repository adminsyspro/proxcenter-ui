// src/app/api/v1/templates/catalog/route.ts
import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { CLOUD_IMAGES, VENDORS, getImagesByVendor } from "@/lib/templates/cloudImages"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const vendor = searchParams.get("vendor")

    const images = vendor ? getImagesByVendor(vendor) : CLOUD_IMAGES

    return NextResponse.json({ data: { images, vendors: VENDORS } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
