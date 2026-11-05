// GET /api/v1/gpu/billing/export?month=YYYY-MM
//
// The month of GPU chargeback as CSV, one line per customer, VM and GPU model,
// for an invoicing tool. Same access as the report.
import { currentMonth, loadBillingReport } from '@/lib/gpu/billing/load'
import { billingCsv } from '@/lib/gpu/billing/report'
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
  return new Response(billingCsv(report), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="gpu-chargeback-${month}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
