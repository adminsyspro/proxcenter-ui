export const dynamic = "force-dynamic"

import { NextResponse } from 'next/server'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { getSetting, setSetting } from '@/lib/db/settings'
import { isTileTemplate, normalizeBasemapSettings, type BasemapSettings } from '@/lib/map/basemap'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'

export const runtime = "nodejs"

/**
 * Instance-wide basemap configuration (issue #960).
 *
 * GET is deliberately NOT gated on admin.settings: every user who opens the
 * geographic topology or a vDC card needs these two strings to draw a map. The
 * row holds a tile URL and an attribution, no credential of its own — an
 * operator who embeds a key in the URL template is publishing it to the tile
 * server on every request anyway.
 *
 * `canEdit` rides along so the Appearance tab can show the form read-only to a
 * user who cannot save, instead of letting them type into a 403.
 */
const SETTING_KEY = 'map'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const tenantId = await getCurrentTenantId()
    const stored = await getSetting<unknown>(SETTING_KEY, tenantId)
    const canEdit = (await checkPermission(PERMISSIONS.ADMIN_SETTINGS)) === null

    return NextResponse.json({ data: normalizeBasemapSettings(stored), canEdit })
  } catch (e: any) {
    console.error('[settings/map] GET error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const body = await request.json().catch(() => null)

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Expected an object of basemap settings' }, { status: 400 })
    }

    const settings: BasemapSettings = normalizeBasemapSettings(body)

    // Refuse a custom provider that cannot draw: without the three
    // placeholders Leaflet requests one fixed image for every tile, and the
    // screen turns into a wall of the same picture rather than a clear error.
    if (settings.provider === 'custom') {
      if (!isTileTemplate(settings.lightUrl)) {
        return NextResponse.json({ error: 'The light tile URL must contain {z}, {x} and {y}' }, { status: 400 })
      }

      if (settings.darkUrl && !isTileTemplate(settings.darkUrl)) {
        return NextResponse.json({ error: 'The dark tile URL must contain {z}, {x} and {y}' }, { status: 400 })
      }
    }

    const tenantId = await getCurrentTenantId()

    await setSetting(SETTING_KEY, tenantId, settings)

    return NextResponse.json({ data: settings })
  } catch (e: any) {
    console.error('[settings/map] PUT error:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
