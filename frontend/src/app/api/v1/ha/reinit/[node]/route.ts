import { proxyHaJson } from '@/lib/orchestrator/haProxy'
import { haWriteGuard } from '@/lib/orchestrator/haRoute'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(
  _request: Request,
  { params }: { params: Promise<{ node: string }> }
) {
  const guard = await haWriteGuard()
  if (guard) return guard

  const { node } = await params

  // Reinit polls Patroni for up to 5 minutes on the orchestrator side.
  return proxyHaJson(`/ha/reinit/${encodeURIComponent(node)}`, { method: 'POST' })
}

export const POST = withAudit({ category: 'system', resourceType: 'node', resourceParam: 'node' }, handlePost)
