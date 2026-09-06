// src/app/api/v1/settings/reports-template/route.ts
//
// Per-tenant PDF report layout (Customization tab of /operations/reports).
// Same storage and permission model as the branding settings: one JSONB row
// per tenant, administrators only. The orchestrator reads the row at render
// time, so a saved change reaches the next report without a restart.
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { getSetting, setSetting } from '@/lib/db/settings'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import {
  CUSTOM_CSS_ERROR_MESSAGES,
  DEFAULT_REPORT_TEMPLATE,
  normalizeReportTemplate,
  REPORT_TEMPLATE_SETTING_KEY,
  type ReportTemplateSettings,
} from '@/lib/reports/templateSettings'

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const stored = await getSetting<Partial<ReportTemplateSettings>>(REPORT_TEMPLATE_SETTING_KEY, tenantId)

    // Decode over the defaults so a row written before a field existed keeps
    // the default for that field. The CSS is handed back as stored even when
    // it would be refused today, so the administrator can see and fix it.
    const { value } = normalizeReportTemplate({ ...DEFAULT_REPORT_TEMPLATE, ...(stored ?? {}) })

    return NextResponse.json(value)
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { value, cssError } = normalizeReportTemplate({ ...DEFAULT_REPORT_TEMPLATE, ...body })
    if (cssError) {
      return NextResponse.json({ error: CUSTOM_CSS_ERROR_MESSAGES[cssError], code: cssError }, { status: 400 })
    }

    const tenantId = await getCurrentTenantId()
    await setSetting(REPORT_TEMPLATE_SETTING_KEY, tenantId, value)

    return NextResponse.json({ success: true, ...value })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
