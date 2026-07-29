export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
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

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  try {
    const parsed = broadcastMessageSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', issues: parsed.error.issues }, { status: 400 })
    }

    const created = await createBroadcast(parsed.data, auth.userId)

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
