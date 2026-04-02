import { NextResponse } from "next/server"

import { getDb } from "@/lib/db/sqlite"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE)
    if (denied) return denied

    // Read Auto-HA settings
    const db = getDb()
    const row = db.prepare("SELECT value FROM settings WHERE key = ? AND tenant_id = ?").get(`auto_ha:${id}`, "default") as any
    const settings = row?.value ? JSON.parse(row.value) : null

    if (!settings?.enabled) {
      return NextResponse.json({ error: "Auto-HA is not enabled for this connection" }, { status: 400 })
    }

    const conn = await getConnectionById(id)

    // Fetch all cluster resources and current HA resources in parallel
    const [resources, haResources] = await Promise.all([
      pveFetch<any[]>(conn, "/cluster/resources"),
      pveFetch<any[]>(conn, "/cluster/ha/resources").catch(() => []),
    ])

    // Build set of existing HA sids
    const existingHa = new Set((haResources || []).map((r: any) => r.sid))

    // Filter to VMs/CTs, exclude templates
    const guests = (resources || []).filter(
      (r: any) => (r.type === "qemu" || r.type === "lxc") && r.template !== 1
    )

    let added = 0
    let skipped = 0
    const errors: string[] = []

    for (const g of guests) {
      const sid = `${g.type === "lxc" ? "ct" : "vm"}:${g.vmid}`

      if (existingHa.has(sid)) {
        skipped++
        continue
      }

      try {
        const params = new URLSearchParams()
        params.append("sid", sid)
        params.append("state", settings.state || "started")
        if (settings.group) params.append("group", settings.group)
        if (settings.max_restart !== undefined) params.append("max_restart", String(settings.max_restart))
        if (settings.max_relocate !== undefined) params.append("max_relocate", String(settings.max_relocate))
        if (settings.comment) params.append("comment", settings.comment)

        await pveFetch<any>(conn, "/cluster/ha/resources", {
          method: "POST",
          body: params.toString(),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })

        added++
      } catch (e: any) {
        errors.push(`${sid}: ${e?.message || String(e)}`)
      }

      // Small delay between calls to avoid overwhelming PVE HA manager
      if (added > 0) await new Promise(r => setTimeout(r, 200))
    }

    return NextResponse.json({ data: { added, skipped, errors } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
