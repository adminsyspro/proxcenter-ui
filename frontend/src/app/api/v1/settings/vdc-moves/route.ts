// Provider settings of the moves between vDCs (#1335): tenant self-service,
// moves copying at once per tenant, bandwidth cap of the copy.

import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'
import { loadVdcMoveSettings, saveVdcMoveSettings, vdcMoveSettingsSchema } from '@/lib/vdc/move/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function guard(): Promise<Response | null> {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  return checkPermission(PERMISSIONS.ADMIN_SETTINGS)
}

export async function GET() {
  const denied = await guard()
  if (denied) return denied

  try {
    return NextResponse.json({ data: await loadVdcMoveSettings() })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

async function handlePut(request: Request) {
  const denied = await guard()
  if (denied) return denied

  let body: unknown

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = vdcMoveSettingsSchema.safeParse(body)

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
    const before = await loadVdcMoveSettings()
    const saved = await saveVdcMoveSettings(parsed.data)

    await audit({
      action: 'update',
      category: 'settings',
      resourceType: 'vdc_move_settings',
      resourceId: 'vdc_move_settings',
      resourceName: 'vDC move settings',
      details: { before, after: saved },
    })

    return NextResponse.json({ data: saved })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export const PUT = withAudit({ category: 'settings', resourceType: 'vdc_move_settings' }, handlePut)
