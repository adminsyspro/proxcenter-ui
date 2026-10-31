// GET /api/v1/availability/measured   { connectionIds }
//
// The visible connections the availability registry measures: the only ones
// whose guests a policy is offered. Same access as the reading of the SLA.

import { NextResponse } from 'next/server'

import { requireSlaRead } from '@/lib/availability/guard'
import { availabilityErrorResponse, getMeasuredConnections } from '@/lib/availability/orchestrator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const access = await requireSlaRead()
    if (access.denied) return access.denied

    const measured = new Set(await getMeasuredConnections())

    return NextResponse.json({ connectionIds: access.connectionIds.filter(id => measured.has(id)) })
  } catch (e) {
    return availabilityErrorResponse(e, 'measured connections')
  }
}
