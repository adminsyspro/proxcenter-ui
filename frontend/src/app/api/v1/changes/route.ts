import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const permError = await checkPermission(PERMISSIONS.EVENTS_VIEW)
    if (permError) return permError

    const { searchParams } = new URL(req.url)
    const params = new URLSearchParams()

    for (const [key, value] of searchParams.entries()) {
      params.set(key, value)
    }

    const query = params.toString()
    const data = await orchestratorFetch<any>(`/changes${query ? `?${query}` : ''}`)

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Error fetching changes:', error)

    return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  try {
    const permError = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError

    const data = await orchestratorFetch<any>('/changes', { method: 'DELETE' })

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}
