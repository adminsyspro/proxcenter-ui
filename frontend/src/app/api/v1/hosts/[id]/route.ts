import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { isSshAddress, normalizeSshAddress, normalizeSshPort } from "@/lib/ssh/node-endpoint-core"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type SessionDb = Awaited<ReturnType<typeof getSessionPrisma>>

/**
 * Whether the caller may act on this host row: the row reads through the
 * session client (a row of another tenant is absent), and so does its
 * connection. The SSH override of a node redirects every session opened
 * with the connection's credentials, so it belongs to the connection owner
 * (roadmap#99).
 */
async function hostIsReachable(db: SessionDb, id: string): Promise<boolean> {
  const host = await db.managedHost.findUnique({ where: { id }, select: { connectionId: true } })
  if (!host) return false
  if (!host.connectionId) return true
  return !!(await db.connection.findUnique({ where: { id: host.connectionId }, select: { id: true } }))
}

async function handleDelete(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    if (!(await hostIsReachable(prisma, id))) return NextResponse.json({ error: "Host not found" }, { status: 404 })

    await prisma.managedHost.delete({ where: { id } })
    
return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

async function handlePatch(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const body = await req.json().catch(() => null)

    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const data: any = {}

    if (body.displayName !== undefined) data.displayName = body.displayName ? String(body.displayName).trim() : null
    if (body.enabled !== undefined) data.enabled = !!body.enabled
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null
    if (body.sshAddress !== undefined) {
      // null or "" clears the override; anything kept must be a bare host.
      const address = normalizeSshAddress(body.sshAddress == null ? null : String(body.sshAddress))
      if (address !== null && !isSshAddress(address)) {
        return NextResponse.json({ error: "sshAddress must be a host name or an IP address" }, { status: 400 })
      }
      data.sshAddress = address
    }
    if (body.sshPort !== undefined) {
      // null or "" clears the override (the connection port applies again).
      const cleared = body.sshPort === null || body.sshPort === ""
      const port = normalizeSshPort(body.sshPort)
      if (!cleared && port === null) {
        return NextResponse.json({ error: "sshPort must be an integer between 1 and 65535" }, { status: 400 })
      }
      data.sshPort = port
    }
    if (body.tags !== undefined) data.tags = body.tags ? String(body.tags) : null

    if (!(await hostIsReachable(prisma, id))) return NextResponse.json({ error: "Host not found" }, { status: 404 })

    const updated = await prisma.managedHost.update({
      where: { id },
      data,
      include: { connection: { select: { id: true, name: true } } },
    })

    return NextResponse.json({
      data: {
        id: updated.id,
        connectionId: updated.connectionId,
        connectionName: updated.connection?.name ?? null,
        node: updated.node,
        displayName: updated.displayName ?? null,
        sshAddress: updated.sshAddress ?? null,
        sshPort: updated.sshPort ?? null,
        enabled: updated.enabled,
        notes: updated.notes ?? null,
        tags: updated.tags ?? null,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const DELETE = withAudit({ category: "nodes", resourceType: "host", resourceParam: "id" }, handleDelete)
export const PATCH = withAudit({ category: "nodes", resourceType: "host", resourceParam: "id" }, handlePatch)
