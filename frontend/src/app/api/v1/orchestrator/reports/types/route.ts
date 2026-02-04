// src/app/api/v1/orchestrator/reports/types/route.ts
import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports/types - Get available report types
export async function GET() {
  try {
    const data = await orchestratorFetch('/reports/types')

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to get report types:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get report types' },
      { status: 500 }
    )
  }
}
