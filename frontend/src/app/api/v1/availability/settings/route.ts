// GET /api/v1/availability/settings   { retentionDays, defaultTarget, measuredConnections, policiesByConnection }
// PUT /api/v1/availability/settings   any of the fields
//
// Provider tenant only (another tenant gets a 404), sla_monitoring and
// admin.settings. The retention and the measured connections are the
// orchestrator's; they are written first, so a refused or unreachable
// orchestrator leaves the default target as is. A measured connection must be
// a Proxmox VE connection of the install.

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'

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

    return NextResponse.json({
      retentionDays: retention.retention_days,
      defaultTarget,
      measuredConnections: retention.connection_ids ?? [],
      policiesByConnection: retention.connection_policies ?? {},
    })
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
    const { retentionDays, defaultTarget, measuredConnections } = parsed.value

    if (measuredConnections !== undefined && measuredConnections.length > 0) {
      const known = await prisma.connection.count({ where: { id: { in: measuredConnections }, type: 'pve' } })
      if (known !== measuredConnections.length) return codeResponse('invalid_connections', 400)
    }

    const retention = retentionDays !== undefined || measuredConnections !== undefined
      ? await putRetentionSettings({ retention_days: retentionDays, connection_ids: measuredConnections })
      : await getRetentionSettings()
    if (defaultTarget !== undefined) await setDefaultTarget(defaultTarget)

    return NextResponse.json({
      retentionDays: retention.retention_days,
      defaultTarget: await getDefaultTarget(),
      measuredConnections: retention.connection_ids ?? [],
      policiesByConnection: retention.connection_policies ?? {},
    })
  } catch (e) {
    return availabilityErrorResponse(e, 'update settings')
  }
}

export const PUT = withAudit({ category: 'settings', resourceType: 'availability_settings' }, handlePut)
