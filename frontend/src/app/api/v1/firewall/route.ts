// src/app/api/v1/firewall/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'

// GET /api/v1/firewall?connectionId=xxx - Get firewall status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const connectionId = searchParams.get('connectionId')

    if (!connectionId) {
      return NextResponse.json({ error: 'connectionId is required' }, { status: 400 })
    }

    // Validate connectionId format to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(connectionId)) {
      return NextResponse.json({ error: 'Invalid connectionId format' }, { status: 400 })
    }

    // codeql[js/user-controlled-bypass] — connectionId is format-validated and ownership-checked
    const denied = await verifyConnectionOwnership(connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.get(`/firewall/status/${connectionId}`)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error fetching firewall status:', String(error?.message || error).replace(/[\r\n]/g, ''))
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch firewall status' },
      { status: 500 }
    )
  }
}
