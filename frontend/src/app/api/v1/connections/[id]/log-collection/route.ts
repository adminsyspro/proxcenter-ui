export const dynamic = 'force-dynamic'
// GET  the collection mode of the cluster, its settings and the forwarder of each node.
// PUT  change the mode or the settings: starts an installation or a removal on
//      the nodes, whose outcome per node the orchestrator audits itself.
// See lib/logCollection/relay.ts for the rights and the relay.
import { NextRequest } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { relayLogCollection } from '@/lib/logCollection/relay'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'

type Ctx = { params: Promise<{ id: string }> | { id: string } }

export async function GET(request: NextRequest, ctx: Ctx) {
  const iaasDenied = await denyIaasTenant()

  if (iaasDenied) return iaasDenied
  const { id } = await Promise.resolve(ctx.params)

  return relayLogCollection(request, id, { method: 'GET', path: () => '', write: false })
}

async function handlePut(request: NextRequest, ctx: Ctx) {
  const iaasDenied = await denyIaasTenant()

  if (iaasDenied) return iaasDenied
  const { id } = await Promise.resolve(ctx.params)

  return relayLogCollection(request, id, { method: 'PUT', path: () => '', body: true, write: true })
}

export const PUT = withAudit({ category: 'connections', action: 'update', resourceType: 'connection', resourceParam: 'id' }, handlePut)
