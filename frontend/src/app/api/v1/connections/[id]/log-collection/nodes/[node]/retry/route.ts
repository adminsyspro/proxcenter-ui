export const dynamic = 'force-dynamic'
// POST  run again what a node missed: its installation in forwarder mode (a
//       failed one, a node that joined the cluster since), the removal of
//       what is left on it otherwise.
import { NextRequest } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { relayLogCollection } from '@/lib/logCollection/relay'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'

async function handlePost(request: NextRequest, ctx: { params: Promise<{ id: string; node: string }> | { id: string; node: string } }) {
  const iaasDenied = await denyIaasTenant()

  if (iaasDenied) return iaasDenied
  const { id, node } = await Promise.resolve(ctx.params)

  return relayLogCollection(request, id, { method: 'POST', path: segment => `/nodes/${segment(node, 'node')}/retry`, write: true })
}

export const POST = withAudit({ category: 'connections', action: 'update', resourceType: 'connection', resourceParam: 'id' }, handlePost)
