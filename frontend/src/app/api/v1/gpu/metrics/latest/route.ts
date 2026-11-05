// GET /api/v1/gpu/metrics/latest
//
// The last round of GPU readings (#672) the caller may see, joined with its
// inventory, plus the collector settings that shape the page (interval,
// thresholds, whether anything is read at all). Never names a VM or a node
// outside the caller's GPU report.
import { NextResponse } from 'next/server'

import { requireGpuRead } from '@/lib/gpu/guard'
import { getGpuMetricsLatest, getGpuMetricsSettings, gpuMetricsErrorResponse, visibleLatest } from '@/lib/gpu/metrics'
import { loadVisibleGpuReport } from '@/lib/gpu/visibleReport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const access = await requireGpuRead()
  if (access.denied) return access.denied
  try {
    const [report, snap, settings] = await Promise.all([loadVisibleGpuReport(), getGpuMetricsLatest(), getGpuMetricsSettings()])
    const latest = visibleLatest(report, snap)
    return NextResponse.json({
      data: {
        ...latest,
        enabled: settings.enabled,
        intervalSeconds: settings.interval_seconds,
        thresholds: settings.thresholds,
        // Whether any target is read at all, without disclosing which.
        configured: settings.guest_vms.length + settings.host_nodes.length > 0,
      },
    })
  } catch (e) {
    return gpuMetricsErrorResponse(e, 'latest')
  }
}
