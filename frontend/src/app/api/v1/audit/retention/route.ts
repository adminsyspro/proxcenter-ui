// GET /api/v1/audit/retention
//
// What the audit page needs to say that the journal is trimmed: whether the
// retention sweeper (lib/audit/retentionSweeper.ts) is on and after how many
// days. Guarded by the audit permission, not the compliance one: an auditor
// may read the journal without being allowed to read or edit the policy.
import { NextResponse } from 'next/server'

import { getAuditRetentionPolicy } from '@/lib/compliance/policies'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_AUDIT)

    if (denied) return denied

    // The policy is global: the provider row applies to every tenant's rows.
    const policy = await getAuditRetentionPolicy('default')

    return NextResponse.json({ data: policy })
  } catch (error: any) {
    console.error('GET audit retention error:', error)

    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
