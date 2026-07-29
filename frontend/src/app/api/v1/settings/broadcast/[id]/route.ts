export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import type { BroadcastInput } from '@/lib/broadcast/types'
import { requireBroadcastAdmin } from '@/lib/broadcast/guard'
import { deleteBroadcast, updateBroadcast } from '@/lib/db/broadcasts'
import { broadcastMessageSchema } from '@/lib/schemas'

type Ctx = { params: Promise<{ id: string }> }

export async function PUT(req: Request, ctx: Ctx) {
  const auth = await requireBroadcastAdmin()
  if (auth.denied) return auth.denied

  try {
    const { id } = await ctx.params
    const parsed = broadcastMessageSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
    }

    // See route.ts: parsed.data's inferred type marks the transform-bearing
    // fields optional even though the schema guarantees they are populated
    // after a successful parse. Cast to the BroadcastInput contract that
    // updateBroadcast expects.
    const updated = await updateBroadcast(id, parsed.data as BroadcastInput)
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
