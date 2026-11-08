export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS } from '@/lib/rbac'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { getConnectionById } from '@/lib/connections/getConnection'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

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
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_VIEW)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/status',
      () => orchestrator.get(`/firewall/status/${connectionId}`),
      async () => pveDirect.getFirewallStatus(await getConnectionById(connectionId)),
    )

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error fetching firewall status:', String(error?.message || error).replace(/[\r\n]/g, ''))
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch firewall status' },
      { status: 500 }
    )
  }
}
