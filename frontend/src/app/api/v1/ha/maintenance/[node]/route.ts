import { proxyHaJson } from '@/lib/orchestrator/haProxy'
import { haWriteGuard } from '@/lib/orchestrator/haRoute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Entering and leaving maintenance are the same proxied call under two verbs;
// keep them on one path so the guards can never drift apart.
async function proxyMaintenance(
  method: 'POST' | 'DELETE',
  params: Promise<{ node: string }>
) {
  const guard = await haWriteGuard()
  if (guard) return guard

  const { node } = await params

  return proxyHaJson(`/ha/maintenance/${encodeURIComponent(node)}`, { method })
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ node: string }> }
) {
  return proxyMaintenance('POST', params)
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ node: string }> }
) {
  return proxyMaintenance('DELETE', params)
}
