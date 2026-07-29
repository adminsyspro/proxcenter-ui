export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import type { BroadcastInput } from '@/lib/broadcast/types'
import { requireBroadcastAdmin } from '@/lib/broadcast/guard'
import { createBroadcast, listBroadcasts } from '@/lib/db/broadcasts'
import { broadcastMessageSchema } from '@/lib/schemas'

export async function GET() {
  const auth = await requireBroadcastAdmin()
  if (auth.denied) return auth.denied

  try {
    return NextResponse.json({ data: await listBroadcasts() })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const auth = await requireBroadcastAdmin()
  if (auth.denied) return auth.denied

  try {
    const parsed = broadcastMessageSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
    }

    // parsed.data is z.infer<typeof broadcastMessageSchema>: zod v4 marks the
    // transform-bearing fields (message, linkUrl, linkLabel, startsAt, endsAt)
    // optional in that inferred type even though the schema guarantees they
    // are always present after a successful parse. Cast to the hand-written
    // BroadcastInput contract that createBroadcast expects.
    const created = await createBroadcast(parsed.data as BroadcastInput, auth.userId)

    await audit({
      action: 'create',
      category: 'settings',
      resourceType: 'broadcast_message',
      resourceId: created.id,
      resourceName: created.message.slice(0, 80),
      details: { targetKind: created.targetKind, enabled: created.enabled },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
