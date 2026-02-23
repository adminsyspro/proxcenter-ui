// src/app/api/v1/templates/check-image/route.ts
import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { getImageBySlug } from "@/lib/templates/cloudImages"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get("connectionId")
    const node = searchParams.get("node")
    const storage = searchParams.get("storage")
    const imageSlug = searchParams.get("imageSlug")

    if (!connectionId || !node || !storage || !imageSlug) {
      return NextResponse.json(
        { error: "Missing required params: connectionId, node, storage, imageSlug" },
        { status: 400 }
      )
    }

    const image = getImageBySlug(imageSlug)
    if (!image) {
      return NextResponse.json({ error: "Unknown image slug" }, { status: 400 })
    }

    const conn = await getConnectionById(connectionId)

    // List content on the target storage to check if image is already downloaded
    const storageContent = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content`,
      { method: "GET" }
    ).catch(() => [])

    // Extract filename from the download URL
    const urlFilename = image.downloadUrl.split("/").pop() || ""

    // Check if any file matches the image filename
    const found = storageContent.find((item: any) => {
      const volName = item.volid?.split("/").pop() || ""
      return volName === urlFilename || volName.includes(image.slug)
    })

    return NextResponse.json({
      data: {
        exists: !!found,
        volid: found?.volid || null,
        filename: urlFilename,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
