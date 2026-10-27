// GET /api/v1/availability/settings   { retentionDays, defaultTarget }
// PUT /api/v1/availability/settings   either field or both
//
// Provider tenant only (another tenant gets a 404), sla_monitoring and
// admin.settings. The retention is the orchestrator's; it is written first,
// so a refused or unreachable orchestrator leaves the default target as is.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { requireAvailabilitySettingsAccess } from '@/lib/availability/guard'
import {
  availabilityErrorResponse,
  codeResponse,
  getRetentionSettings,
  putRetentionSettings,
} from '@/lib/availability/orchestrator'
import { getDefaultTarget, parseSettingsBody, setDefaultTarget } from '@/lib/availability/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const access = await requireAvailabilitySettingsAccess()
    if (access.denied) return access.denied

    const [retention, defaultTarget] = await Promise.all([getRetentionSettings(), getDefaultTarget()])

    return NextResponse.json({ retentionDays: retention.retention_days, defaultTarget })
  } catch (e) {
    return availabilityErrorResponse(e, 'get settings')
  }
}

async function handlePut(request: Request) {
  try {
    const access = await requireAvailabilitySettingsAccess()
    if (access.denied) return access.denied

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return codeResponse('invalid_body', 400)
    }
    const parsed = parseSettingsBody(body)
    if (parsed.ok === false) return codeResponse(parsed.error, 400)
    const { retentionDays, defaultTarget } = parsed.value

    const retention = retentionDays !== undefined
      ? await putRetentionSettings({ retention_days: retentionDays })
      : await getRetentionSettings()
    if (defaultTarget !== undefined) await setDefaultTarget(defaultTarget)

    return NextResponse.json({ retentionDays: retention.retention_days, defaultTarget: await getDefaultTarget() })
  } catch (e) {
    return availabilityErrorResponse(e, 'update settings')
  }
}

export const PUT = withAudit({ category: 'settings', resourceType: 'availability_settings' }, handlePut)
