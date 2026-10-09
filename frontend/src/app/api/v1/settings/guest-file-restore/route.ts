// src/app/api/v1/settings/guest-file-restore/route.ts
//
// Provider-level settings of the guest file restore feature. GET is for the
// restore dialog (any authenticated user with the feature licensed: the
// settings hold no secret); PUT is the Settings tab (provider super admin).

import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import { requireGuestFileRestoreAdmin, requireGuestFileRestoreUser } from '@/lib/guestFileRestore/guard'
import {
  guestFileRestoreSettingsSchema,
  loadGuestFileRestoreSettings,
  saveGuestFileRestoreSettings,
} from '@/lib/guestFileRestore/settings'
import type { GuestFileRestoreSettings } from '@/lib/guestFileRestore/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function payload(settings: GuestFileRestoreSettings) {
  return { data: settings }
}

export async function GET() {
  const guard = await requireGuestFileRestoreUser()
  if (guard.denied) return guard.denied

  try {
    return NextResponse.json(payload(await loadGuestFileRestoreSettings()))
  } catch (error: any) {
    console.error('Erreur GET settings/guest-file-restore:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const guard = await requireGuestFileRestoreAdmin()
  if (guard.denied) return guard.denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = guestFileRestoreSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid settings',
        issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
      },
      { status: 400 },
    )
  }

  try {
    const before = await loadGuestFileRestoreSettings()
    const saved = await saveGuestFileRestoreSettings(parsed.data)

    await audit({
      action: 'update',
      category: 'settings',
      resourceType: 'guest_file_restore_settings',
      resourceId: 'guest_file_restore_settings',
      resourceName: 'Guest file restore settings',
      details: { before, after: saved },
    })

    return NextResponse.json(payload(saved))
  } catch (error: any) {
    console.error('Erreur PUT settings/guest-file-restore:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
