import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"

export const runtime = "nodejs"

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    await prisma.managedHost.delete({ where: { id } })
    
return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const body = await req.json().catch(() => null)

    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const data: any = {}

    if (body.displayName !== undefined) data.displayName = body.displayName ? String(body.displayName).trim() : null
    if (body.enabled !== undefined) data.enabled = !!body.enabled
    if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null

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
        enabled: updated.enabled,
        notes: updated.notes ?? null,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

