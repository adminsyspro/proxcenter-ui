// GET/PUT /api/v1/compliance/policies
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { authOptions } from '@/lib/auth/config'
import { demoResponse } from '@/lib/demo/demo-api'
import {
  AUDIT_RETENTION_MIN_DAYS,
  E_AUDIT_RETENTION_TOO_SHORT,
  getSecurityPolicies,
  updateSecurityPolicies,
} from '@/lib/compliance/policies'
import { audit } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/tenant'
import { withAudit } from '@/lib/audit/withAudit'
import {
  collectionSettingsToPolicyFields,
  E_COLLECTION_SETTINGS_INVALID,
  parseCollectionSettingsPatch,
} from '@/lib/compliance/collectionSettings'
import { getCollectionSettings, saveCollectionSettings } from '@/lib/compliance/collectionSettingsStore'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const policies = await getSecurityPolicies(tenantId)
    // The compliance collection settings ride along: one Policies form, one save.
    const collection = collectionSettingsToPolicyFields(await getCollectionSettings(tenantId))
    return NextResponse.json({ data: { ...policies, ...collection } })
  } catch (e: any) {
    console.error('Error fetching security policies:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

async function handlePut(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await req.json()
    const tenantId = await getCurrentTenantId()
    // Checked before anything is written: a refused value saves nothing.
    const collectionPatch = parseCollectionSettingsPatch(body)
    const updated = await updateSecurityPolicies(body, session.user.id, tenantId)
    const collection = collectionPatch
      ? await saveCollectionSettings(tenantId, collectionPatch)
      : await getCollectionSettings(tenantId)

    await audit({
      action: 'update',
      category: 'security',
      resourceType: 'security_policies',
      resourceId: 'default',
      resourceName: 'Security Policies',
      details: body,
    })

    return NextResponse.json({ data: { ...updated, ...collectionSettingsToPolicyFields(collection) } })
  } catch (e: any) {
    if (e?.message === E_COLLECTION_SETTINGS_INVALID) {
      return NextResponse.json(
        {
          error: 'Invalid compliance collection settings: cache duration must be 0, 1, 5, 15 or 30 minutes, guests in parallel between 1 and 10.',
          code: E_COLLECTION_SETTINGS_INVALID,
        },
        { status: 400 },
      )
    }
    if (e?.message === E_AUDIT_RETENTION_TOO_SHORT) {
      return NextResponse.json(
        {
          error: `Audit retention must be a whole number of days, at least ${AUDIT_RETENTION_MIN_DAYS}.`,
          code: E_AUDIT_RETENTION_TOO_SHORT,
        },
        { status: 400 },
      )
    }
    if (e?.message === 'E_NEED_OWN_2FA') {
      return NextResponse.json(
        {
          error: 'Enable 2FA on your own account before enforcing this policy.',
          code: 'E_NEED_OWN_2FA',
        },
        { status: 409 },
      )
    }
    console.error('Error updating security policies:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

export const PUT = withAudit({ category: 'security', resourceType: 'policy' }, handlePut)
