export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch, parseOrchestratorError } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

type Params = { params: Promise<{ id: string }> | { id: string } }

function relayError(error: any, fallback: string) {
  const upstream = parseOrchestratorError(error)

  if (upstream && upstream.status >= 400 && upstream.status < 500) {
    return NextResponse.json({ error: upstream.message }, { status: upstream.status })
  }

  if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
    console.error(fallback, error)
  }

  return NextResponse.json({ error: error?.message || fallback }, { status: 500 })
}

export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  const { id } = await params

  try {
    const body = await request.json()

    const data = await orchestratorFetch(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body
    })

    return NextResponse.json(data)
  } catch (error: any) {
    return relayError(error, 'Failed to update notification channel')
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  const { id } = await params

  try {
    const data = await orchestratorFetch(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })

    return NextResponse.json(data)
  } catch (error: any) {
    return relayError(error, 'Failed to delete notification channel')
  }
}
