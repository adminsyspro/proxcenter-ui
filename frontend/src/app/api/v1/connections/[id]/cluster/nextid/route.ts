// src/app/api/v1/connections/[id]/cluster/nextid/route.ts
import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/{id}/cluster/nextid
 *   → returns the next free vmid: { data: number, available: true }
 *
 * GET /api/v1/connections/{id}/cluster/nextid?vmid=<n>
 *   → checks whether the given vmid is free without allocating it.
 *     PVE returns 200 with the same vmid when free, 400 with
 *     "VM <n> already exists" when taken. We normalize both into
 *     { data: <n>, available: boolean, error?: string } so the UI
 *     can render a non-blocking inline status.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "connection", id)

    if (denied) return denied

    const conn = await getConnectionById(id)
    const url = new URL(req.url)
    const vmidParam = url.searchParams.get("vmid")

    if (vmidParam) {
      const requested = Number(vmidParam)

      if (!Number.isInteger(requested) || requested < 100 || requested > 999999999) {
        return NextResponse.json({ data: requested, available: false, error: "VMID must be an integer between 100 and 999999999" })
      }

      try {
        const checked = await pveFetch<number | string>(conn, `/cluster/nextid?vmid=${encodeURIComponent(String(requested))}`)


return NextResponse.json({ data: Number(checked) || requested, available: true })
      } catch (e: any) {
        // PVE 400 = "VM <n> already exists" or "invalid format". Treat as
        // "not available" so the UI can show inline feedback without burning
        // a 4xx error path.
        return NextResponse.json({ data: requested, available: false, error: e?.message || "VMID is not available" })
      }
    }

    const nextid = await pveFetch<number | string>(conn, "/cluster/nextid")


return NextResponse.json({ data: Number(nextid), available: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
