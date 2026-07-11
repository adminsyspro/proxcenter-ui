import { orchestratorHeaders } from '@/lib/orchestrator/headers'
import { requireEnterprise } from '@/lib/auth/requireEnterprise'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

export async function GET() {
  const guard = await requireEnterprise()
  if (guard) return guard
  const perm = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ha/deploy/status`, {
      headers: orchestratorHeaders(),
    })

    if (!res.ok || !res.body) {
      return new Response(JSON.stringify({ error: 'Deployment status unavailable' }), {
        status: res.status || 503,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: 'Orchestrator unavailable' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
