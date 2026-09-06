// src/app/api/v1/orchestrator/reports/preview/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'
import {
  CUSTOM_CSS_ERROR_MESSAGES,
  DEFAULT_REPORT_TEMPLATE,
  normalizeReportTemplate,
} from '@/lib/reports/templateSettings'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'
const ORCHESTRATOR_API_KEY = process.env.ORCHESTRATOR_API_KEY || ''

// WeasyPrint takes a few seconds on a sample report; leave headroom over the
// orchestrator's own renderer timeout (60 s by default).
const PREVIEW_TIMEOUT_MS = 90_000

export const runtime = 'nodejs'

// POST /api/v1/orchestrator/reports/preview — render a sample PDF under a
// draft layout, for the Customization tab. Nothing is stored on either side.
// orchestratorFetch does not stream binary, so the orchestrator is called
// directly here (same shape as the report download route).
export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { value, cssError } = normalizeReportTemplate({ ...DEFAULT_REPORT_TEMPLATE, ...(body.template ?? {}) })
    if (cssError) {
      return NextResponse.json({ error: CUSTOM_CSS_ERROR_MESSAGES[cssError], code: cssError }, { status: 400 })
    }

    const language = typeof body.language === 'string' && body.language ? body.language : 'en'

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (ORCHESTRATOR_API_KEY) {
      headers['X-API-Key'] = ORCHESTRATOR_API_KEY
    }
    const tid = await getCurrentTenantId()
    if (tid && tid !== DEFAULT_TENANT_ID) {
      headers['X-Tenant-ID'] = tid
    }

    // The component aborts a preview as soon as the draft changes again; the
    // upstream call must go with it so superseded renders stop queueing on the
    // sidecar shared with real report generation.
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetch(`${ORCHESTRATOR_URL}/api/v1/reports/preview`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ language, template: value }),
        signal: AbortSignal.any([request.signal, controller.signal]),
        cache: 'no-store',
      })
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let message = text || 'Failed to render report preview'
      try {
        message = JSON.parse(text).error || message
      } catch {
        // plain-text error from the orchestrator, keep it as is
      }
      return NextResponse.json({ error: message }, { status: response.status })
    }

    const responseHeaders = new Headers()
    responseHeaders.set('Content-Type', 'application/pdf')
    responseHeaders.set('Content-Disposition', 'inline; filename="report-preview.pdf"')
    responseHeaders.set('Cache-Control', 'no-cache, no-store, must-revalidate')
    const contentLength = response.headers.get('Content-Length')
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength)
    }

    return new NextResponse(response.body, { status: 200, headers: responseHeaders })
  } catch (error: any) {
    const timedOut = error?.name === 'AbortError'
    if (!timedOut && (error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to render report preview:', error)
    }
    return NextResponse.json(
      { error: timedOut ? 'Report preview timed out' : error.message || 'Failed to render report preview' },
      { status: timedOut ? 504 : 500 }
    )
  }
}
