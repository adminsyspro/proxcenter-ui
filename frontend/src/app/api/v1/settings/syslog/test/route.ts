// src/app/api/v1/settings/syslog/test/route.ts
//
// "Send test" button: deliver one synthetic audit line to a destination that
// may not be saved yet, on a throw-away connection, and report the outcome
// together with the rendered line so the operator can check the dialect.

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { testSyslogDestination } from '@/lib/syslog/forwarder'
import { requireSyslogAdmin } from '@/lib/syslog/guard'
import { syslogDestinationSchema } from '@/lib/syslog/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = syslogDestinationSchema.extend({ id: z.string().trim().max(64).optional() })

export async function POST(request: Request) {
  const guard = await requireSyslogAdmin()
  if (guard.denied) return guard.denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid destination',
        issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
      },
      { status: 400 },
    )
  }

  const dest = { ...parsed.data, id: parsed.data.id || 'test' }

  try {
    const result = await testSyslogDestination(dest, { userId: guard.userId, userEmail: guard.userEmail })
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Erreur POST settings/syslog/test:', error)
    return NextResponse.json({ ok: false, error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
