// GET /api/v1/gpu/billing?month=YYYY-MM
//
// GPU chargeback (#672): GPU-hours and amounts per customer (vDC, tenant or
// the provider itself), model and VM over one month, priced with the current
// rates. Provider tenant, gpu_management, reports.view.
import { NextResponse } from 'next/server'

import { currentMonth, loadBillingReport } from '@/lib/gpu/billing/load'
import { requireGpuBilling } from '@/lib/gpu/guard'
import { gpuCode } from '@/lib/gpu/metrics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const access = await requireGpuBilling()
  if (access.denied) return access.denied
  const month = new URL(req.url).searchParams.get('month') ?? currentMonth()
  const report = await loadBillingReport(month)
  if (!report) return gpuCode('invalid_month', 400)
  return NextResponse.json({ data: { month, ...report } })
}
