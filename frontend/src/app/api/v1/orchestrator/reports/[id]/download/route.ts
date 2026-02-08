// src/app/api/v1/orchestrator/reports/[id]/download/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorApiKey } from '@/lib/orchestrator/api-key'
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'
const ORCHESTRATOR_API_KEY = getOrchestratorApiKey()

export const runtime = 'nodejs'

// GET /api/v1/orchestrator/reports/[id]/download - Download report PDF
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const url = `${ORCHESTRATOR_URL}/api/v1/reports/${id}/download`

    const headers: Record<string, string> = {}
    if (ORCHESTRATOR_API_KEY) {
      headers['X-API-Key'] = ORCHESTRATOR_API_KEY
    }

    const response = await fetch(url, {
      headers,
      cache: 'no-store',
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return NextResponse.json(
        { error: text || 'Failed to download report' },
        { status: response.status }
      )
    }

    // Get headers from orchestrator response
    const contentType = response.headers.get('Content-Type') || 'application/pdf'
    const contentDisposition = response.headers.get('Content-Disposition') || `attachment; filename="report-${id}.pdf"`
    const contentLength = response.headers.get('Content-Length')

    // Stream the response
    const responseHeaders = new Headers()
    responseHeaders.set('Content-Type', contentType)
    responseHeaders.set('Content-Disposition', contentDisposition)
    responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength)
    }

    return new NextResponse(response.body, {
      status: 200,
      headers: responseHeaders,
    })
  } catch (error: any) {
    console.error('Failed to download report:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to download report' },
      { status: 500 }
    )
  }
}
