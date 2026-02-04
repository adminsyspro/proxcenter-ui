// src/app/api/v1/connections/[id]/resources/route.ts
import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { mapClusterResource } from "@/lib/proxmox/mappers"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const conn = await getConnectionById(id)
    const raw = await pveFetch<any[]>(conn, "/cluster/resources")
    
    // Filtrer uniquement les VMs/CTs (pas les nodes, storage, etc.)
    const guests = raw
      .filter((r) => r?.type === "qemu" || r?.type === "lxc")
      .map(mapClusterResource)

    return NextResponse.json({ data: guests })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
