export const dynamic = 'force-dynamic'
// POST  check that every node of the cluster can get its forwarder with the
//       settings of the body (SSH, confirmed host key, sudo rules, systemd,
//       reaching the receiver). Writes nothing: see lib/audit/readOnlyRoutes.ts.
import { NextRequest } from 'next/server'

import { relayLogCollection } from '@/lib/logCollection/relay'
import { denyIaasTenant } from '@/lib/tenant/iaasGuard'

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const iaasDenied = await denyIaasTenant()

  if (iaasDenied) return iaasDenied
  const { id } = await Promise.resolve(ctx.params)

  return relayLogCollection(request, id, { method: 'POST', path: () => '/preflight', body: true, write: true })
}
