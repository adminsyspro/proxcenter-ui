import { NextResponse } from 'next/server'

import { orchestratorHeaders } from '@/lib/orchestrator/headers'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

// Entering and leaving maintenance are the same proxied call under two verbs;
// keep them on one path so the guards can never drift apart.
async function proxyMaintenance(
  method: 'POST' | 'DELETE',
  params: Promise<{ node: string }>
) {
  const guard = await requireFeature(Features.HA)
  if (guard) return guard
  const perm = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  const { node } = await params
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ha/maintenance/${encodeURIComponent(node)}`, {
      method,
      headers: orchestratorHeaders(),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Orchestrator unavailable' }, { status: 503 })
  }
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
