// POST /api/v1/incidents/for-outages   the alerts and the incident that match each outage of the availability page
//
// A POST for the size of the body (200 outages at most); it reads only. The
// alerts of a match are the ones the caller may see.

import { NextResponse } from 'next/server'

import { codeResponse } from '@/lib/availability/orchestrator'
import { filterVisibleAlerts, visibleAlertFilter } from '@/lib/incidents/alertVisibility'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { incidentErrorResponse, incidentsForOutages } from '@/lib/incidents/orchestrator'
import { parseOutages, readJson } from '@/lib/incidents/validate'
import { PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const access = await requireIncidentAccess('read')
    if (access.denied) return access.denied

    const parsed = parseOutages(await readJson(request))
    if (parsed.ok === false) return codeResponse(parsed.code, 400)
    if (parsed.value.length === 0) return NextResponse.json({ matches: [] })

    const { matches } = await incidentsForOutages(parsed.value)
    const isVisible = await visibleAlertFilter(PERMISSIONS.ALERTS_VIEW)
    // A match left without a visible alert does not reveal its incident.
    const visible = await Promise.all(
      (matches as { alerts?: unknown[]; incident?: unknown }[]).map(async m => {
        const alerts = await filterVisibleAlerts(m.alerts ?? [], isVisible)

        return { ...m, alerts, incident: alerts.length > 0 ? (m.incident ?? null) : null }
      }),
    )
    return NextResponse.json({ matches: visible })
  } catch (e) {
    return incidentErrorResponse(e, 'incidents for outages')
  }
}
