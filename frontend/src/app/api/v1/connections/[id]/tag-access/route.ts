import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { loadTagPolicy } from "@/lib/proxmox/tagAccessServer"

export const runtime = "nodejs"

// GET - What the current user may do with guest tags on this connection
// (datacenter User Tag Access + Registered Tags, #1208).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    // Unscoped like /resources: scoped users pass, the tags below are
    // limited to the guests they can see.
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const conn = await getConnectionById(id)
    const { policy, visibleGuestCount } = await loadTagPolicy(id, conn, { guestTags: "always" })
    const sorted = (tags: Iterable<string>) => [...tags].sort((a, b) => a.localeCompare(b))
    // A session that sees no guest here learns none of the datacenter's tags.
    const blind = !policy.privileged && visibleGuestCount === 0

    return NextResponse.json({
      data: {
        userAllow: policy.userAllow,
        privileged: policy.privileged,
        freeform: policy.freeform,
        allowedTags: blind ? [] : sorted(policy.allowed),
        // Registered tags matter to the UI only on guests it shows, so only
        // those already on a visible guest are named.
        lockedTags: policy.privileged ? [] : sorted([...policy.guestTags].filter(t => policy.registered.has(t))),
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
