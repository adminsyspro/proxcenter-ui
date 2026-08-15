export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { demoResponse } from '@/lib/demo/demo-api'
import { getUserAppearance, setUserAppearance } from '@/lib/db/userPreferences'

export const runtime = "nodejs"

/**
 * The signed-in user's own appearance settings (issue #696).
 *
 * No RBAC check on purpose: this is every user's own colour scheme, not an
 * administrative setting, so the session alone is the authorisation. The blob
 * is scoped to (tenant, user) by the store, so one user can never read or
 * write another's.
 */
async function currentPrincipal() {
  const session = await getServerSession(authOptions)
  const userId = session?.user?.id

  if (!userId) return null

  return { userId, tenantId: session.user.tenantId || 'default' }
}

export async function GET(req: Request) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const principal = await currentPrincipal()

    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const appearance = await getUserAppearance(principal.tenantId, principal.userId)

    // `stored` lets the client tell "never saved" from "saved nothing", which
    // is what decides whether it may seed the store from an existing cookie.
    return NextResponse.json({ data: appearance ?? {}, stored: appearance !== null })
  } catch (e: any) {
    console.error('[settings/appearance] GET error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const principal = await currentPrincipal()

    if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null)

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Expected an object of appearance settings' }, { status: 400 })
    }

    // Unknown keys and out-of-range values are dropped rather than refused: a
    // client one version ahead or behind should still get its valid keys saved.
    const appearance = await setUserAppearance(principal.tenantId, principal.userId, body)

    return NextResponse.json({ data: appearance, stored: true })
  } catch (e: any) {
    console.error('[settings/appearance] PUT error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
