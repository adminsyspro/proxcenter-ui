// src/app/api/v1/orchestrator/reports/languages/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports/languages - Get available languages
export async function GET(request: NextRequest) {
  try {
    const data = await orchestratorFetch('/reports/languages')

    return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to get languages:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get languages' },
      { status: 500 }
    )
  }
}
