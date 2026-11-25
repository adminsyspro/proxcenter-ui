export const dynamic = 'force-dynamic'
// POST  compare the forwarder of each node with what was installed (checksum
//       of the program, service running and enabled). Changes nothing on the
//       nodes: see lib/audit/readOnlyRoutes.ts.
import { NextRequest } from 'next/server'

import { relayLogCollection } from '@/lib/logCollection/relay'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const iaasDenied = await denyIaasTenant()

  if (iaasDenied) return iaasDenied
  const { id } = await Promise.resolve(ctx.params)

  return relayLogCollection(request, id, { method: 'POST', path: () => '/check', write: true })
}
