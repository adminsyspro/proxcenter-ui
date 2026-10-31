// GET /api/v1/incidents/by-alerts?ids=a,b,c   the incident of each alert, absent when it has none (500 ids at most)

import { NextResponse } from 'next/server'

import { codeResponse } from '@/lib/availability/orchestrator'
import { requireIncidentAccess } from '@/lib/incidents/guard'
import { incidentErrorResponse, incidentsByAlerts } from '@/lib/incidents/orchestrator'
import { parseAlertIds } from '@/lib/incidents/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const access = await requireIncidentAccess('read')
    if (access.denied) return access.denied

    const ids = parseAlertIds(new URL(request.url).searchParams.get('ids'))
    if (ids === null) return codeResponse('invalid_body', 400)
    if (ids.length === 0) return NextResponse.json({ incidents: {} })

    return NextResponse.json(await incidentsByAlerts(ids))
  } catch (e) {
    return incidentErrorResponse(e, 'incidents by alerts')
  }
}
