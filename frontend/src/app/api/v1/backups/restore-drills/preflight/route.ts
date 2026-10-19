// POST /api/v1/backups/restore-drills/preflight
//
// Runs the orchestrator checks of a drill without starting it. A failed check
// is a 200 with `ok: false`; only a malformed request is refused.

import { NextResponse } from 'next/server'

import { drillErrorResponse } from '@/lib/backups/restoreDrills/errors'
import { requireRestoreDrillAccess } from '@/lib/backups/restoreDrills/guard'
import { prepareDrillRequest } from '@/lib/backups/restoreDrills/server'
import { getOrchestratorClient } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const access = await requireRestoreDrillAccess()
    if (access.denied) return access.denied

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const prepared = await prepareDrillRequest(body, access.userEmail)
    if (prepared.response) return prepared.response

    const res = await getOrchestratorClient().preflightRestoreDrill(prepared.request)

    return NextResponse.json({ ...res.data, archive: prepared.request.archive })
  } catch (e) {
    return drillErrorResponse(e, 'Failed to run the restore drill preflight')
  }
}
