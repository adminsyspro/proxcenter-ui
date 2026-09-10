// src/app/api/v1/orchestrator/reports/[id]/download/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || ''

export const runtime = 'nodejs'

// Formats the orchestrator can serve for a stored report. Both are built at
// generation time from the same data, so neither re-runs any collection.
const FORMATS = ['pdf', 'csv'] as const

type Format = (typeof FORMATS)[number]

// Content type to announce when the orchestrator does not send one.
function fallbackContentType(format: Format): string {
  return format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf'
}

// GET /api/v1/orchestrator/reports/[id]/download — tenant-scoped
//
// ?format=csv downloads the report's data as one CSV instead of the PDF.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.REPORTS_VIEW)
    if (denied) return denied

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const format = (searchParams.get('format') || 'pdf').toLowerCase()

    if (!FORMATS.includes(format as Format)) {
      return NextResponse.json({ error: `Unsupported format: ${format}` }, { status: 400 })
    }

    // Tenant ownership is enforced by the orchestrator: orchestratorFetch
    // does not stream binary, so we hit the download URL directly here and
    // forward the X-Tenant-ID header explicitly.
    const query = new URLSearchParams()

    if (format === 'csv') {
      query.set('format', 'csv')
    }

    const suffix = query.toString()
    const url = `${ORCHESTRATOR_URL}/api/v1/reports/${id}/download${suffix ? `?${suffix}` : ''}`

    const headers: Record<string, string> = {}
    if (ORCHESTRATOR_API_KEY) {
      headers['X-API-Key'] = ORCHESTRATOR_API_KEY
    }
    const tid = await getCurrentTenantId()
    if (tid && tid !== DEFAULT_TENANT_ID) {
      headers['X-Tenant-ID'] = tid
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
    const fallbackType = fallbackContentType(format as Format)
    const fallbackExt = format === 'csv' ? 'csv' : 'pdf'
    const contentType = response.headers.get('Content-Type') || fallbackType
    const contentDisposition = response.headers.get('Content-Disposition') || `attachment; filename="report-${id}.${fallbackExt}"`
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
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to download report:', error)
    }
    return NextResponse.json(
      { error: error.message || 'Failed to download report' },
      { status: 500 }
    )
  }
}
