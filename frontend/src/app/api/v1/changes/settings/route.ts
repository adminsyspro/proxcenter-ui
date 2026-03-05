import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const permError = await checkPermission(PERMISSIONS.EVENTS_VIEW)
    if (permError) return permError

    const data = await orchestratorFetch<any>('/changes/settings')

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const permError = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError

    const body = await req.json()
    const data = await orchestratorFetch<any>('/changes/settings', { method: 'PUT', body })

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
