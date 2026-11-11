import { NextResponse } from "next/server"

import { withAudit } from "@/lib/audit/withAudit"
import { getPrincipal } from "@/lib/auth/principal"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { assertNodeName, assertVmid } from "@/lib/ssh/validate"
import { followMoveInBackground } from "@/lib/vdc/move/runner"
import { getMoveOptions, MoveRequestError, planMove, startMove, type MoveActor } from "@/lib/vdc/move/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string; type: string; node: string; vmid: string }> }

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

/**
 * Shared guards: identifiers, vm.move_vdc on the guest, and the actor. A vDC
 * tenant moves its own guests; the provider moves a guest of any vDC on its
 * tenant's behalf. Whose guest it is is settled by the service from the PVE
 * pool, never from the request.
 */
async function guard(ctx: Ctx): Promise<{ denied: Response } | { connectionId: string; node: string; vmid: number; actor: MoveActor }> {
  const { id, type, node, vmid } = await ctx.params
  if (type !== "qemu") {
    return { denied: NextResponse.json({ error: "Only virtual machines can be moved to another vDC", code: "LXC_NOT_SUPPORTED" }, { status: 400 }) }
  }
  let safeNode: string
  let safeVmid: string
  try {
    safeNode = assertNodeName(node)
    safeVmid = assertVmid(vmid)
  } catch {
    return { denied: NextResponse.json({ error: "Invalid node name or vmid" }, { status: 400 }) }
  }
  const denied = await checkPermission(PERMISSIONS.VM_MOVE_VDC, "vm", buildVmResourceId(id, safeNode, type, safeVmid))
  if (denied) return { denied }

  const tenantId = await getCurrentTenantId()
  const principal = await getPrincipal().catch(() => null)

  return {
    connectionId: id,
    node: safeNode,
    vmid: Number(safeVmid),
    actor: { tenantId, isProvider: tenantId === DEFAULT_TENANT_ID, userEmail: principal?.principal?.userEmail ?? null },
  }
}

function errorResponse(e: unknown): Response {
  if (e instanceof MoveRequestError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status })
  console.error("[move-vdc] error:", String((e as any)?.message || e).replace(/[\r\n]/g, " "))

  return NextResponse.json({ error: "The move could not be prepared" }, { status: 500 })
}

/**
 * GET .../move-vdc[?targetVdcId=]
 * What the move dialog needs: the guest's disks per source storage and NICs
 * per source bridge, the tenant's other vDCs, the storages (with their
 * policy and tier usage) and networks of the chosen target, and what blocks
 * the move whatever the target.
 */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx)
    if ("denied" in g) return g.denied
    const targetVdcId = new URL(req.url).searchParams.get("targetVdcId")
    if (targetVdcId !== null && !ID_RE.test(targetVdcId)) return NextResponse.json({ error: "Invalid targetVdcId" }, { status: 400 })

    return NextResponse.json({ data: await getMoveOptions(g.actor, g.connectionId, g.node, g.vmid, targetVdcId) })
  } catch (e) {
    return errorResponse(e)
  }
}

function parseMap(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!ID_RE.test(k) || typeof v !== "string" || !ID_RE.test(v)) return null
    out[k] = v
  }

  return out
}

/**
 * POST .../move-vdc  { targetVdcId, storageMap, bridgeMap, online }
 * Runs every check again server-side, then starts the copy. 409 with the
 * blockers when anything stands in the way; 202 with the move id otherwise.
 */
async function handlePost(req: Request, ctx: Ctx) {
  try {
    const g = await guard(ctx)
    if ("denied" in g) return g.denied
    const body = await req.json().catch(() => null)
    const storageMap = parseMap(body?.storageMap)
    const bridgeMap = parseMap(body?.bridgeMap ?? {})
    if (!body || typeof body.targetVdcId !== "string" || !ID_RE.test(body.targetVdcId) || !storageMap || !bridgeMap) {
      return NextResponse.json({ error: "targetVdcId, storageMap and bridgeMap are required" }, { status: 400 })
    }

    const { blockers, plan } = await planMove(g.actor, g.connectionId, g.node, g.vmid, {
      targetVdcId: body.targetVdcId,
      storageMap,
      bridgeMap,
      online: body.online !== false,
    })
    if (!plan) return NextResponse.json({ error: "The move is blocked", code: "MOVE_BLOCKED", blockers }, { status: 409 })

    const tenantId = plan.source.vdc.tenantId
    const { moveId, stopping } = await startMove(plan, g.actor, g.actor.isProvider ? "provider" : "tenant", (id) => followMoveInBackground(id, tenantId))

    return NextResponse.json({
      data: { moveId, status: stopping ? "stopping" : "copying", targetVdc: { id: plan.target.id, name: plan.target.name }, online: plan.online },
    }, { status: 202 })
  } catch (e) {
    return errorResponse(e)
  }
}

export const POST = withAudit({ category: "vms", resourceType: "guest", resourceTypeParam: "type", resourceParam: "vmid", action: "migrate" }, handlePost)
