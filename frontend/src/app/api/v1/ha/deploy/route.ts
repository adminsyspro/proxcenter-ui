import { NextRequest } from 'next/server'

import { proxyHaJson } from '@/lib/orchestrator/haProxy'
import { haWriteGuard } from '@/lib/orchestrator/haRoute'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(request: NextRequest) {
  const guard = await haWriteGuard()
  if (guard) return guard

  // Not haOperationWithBody: an empty body is legitimate here, it is how the
  // wizard retries a deployment.
  let body: Record<string, unknown> = {}
  try { body = await request.json() } catch { /* empty body is OK for retry */ }

  return proxyHaJson('/ha/deploy', { method: 'POST', body })
}

export const POST = withAudit({ category: 'system', resourceType: 'ha', action: 'create' }, handlePost)
