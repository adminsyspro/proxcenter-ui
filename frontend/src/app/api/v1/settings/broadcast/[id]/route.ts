export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import { requireBroadcastAdmin } from '@/lib/broadcast/guard'
import { deleteBroadcast, updateBroadcast } from '@/lib/db/broadcasts'
import { broadcastMessageSchema } from '@/lib/schemas'

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: Request, ctx: Ctx) {
  const auth = await requireBroadcastAdmin()
  if (auth.denied) return auth.denied

  try {
    const { id } = await ctx.params

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
    }

    const parsed = broadcastMessageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
    }

    const updated = await updateBroadcast(id, parsed.data)
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await audit({
      action: 'update',
      category: 'settings',
      resourceType: 'broadcast_message',
      resourceId: id,
      resourceName: updated.message.slice(0, 80),
      details: { targetKind: updated.targetKind, enabled: updated.enabled },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const auth = await requireBroadcastAdmin()
  if (auth.denied) return auth.denied

  try {
    const { id } = await ctx.params
    const removed = await deleteBroadcast(id)
    if (!removed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await audit({
      action: 'delete',
      category: 'settings',
      resourceType: 'broadcast_message',
      resourceId: id,
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
