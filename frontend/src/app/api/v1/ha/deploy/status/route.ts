import { orchestratorBaseUrl, orchestratorFailure } from '@/lib/orchestrator/haProxy'
import { haWriteGuard } from '@/lib/orchestrator/haRoute'
import { orchestratorHeaders } from '@/lib/orchestrator/headers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const guard = await haWriteGuard()
  if (guard) return guard

  // Not proxyHaJson: this one streams the orchestrator's SSE body straight
  // through instead of parsing it.
  try {
    const res = await fetch(`${orchestratorBaseUrl()}/api/v1/ha/deploy/status`, {
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
  } catch (cause) {
    const failure = orchestratorFailure(cause)

    return new Response(JSON.stringify({ error: failure.error }), {
      status: failure.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
