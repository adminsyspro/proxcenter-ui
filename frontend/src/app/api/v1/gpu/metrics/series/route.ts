// GET /api/v1/gpu/metrics/series?range=1h|6h|24h|7d|30d
//
// The bucketed load history (#672) of the GPUs the caller may see, one series
// per GPU. The step follows the range so a chart never carries more than a
// few hundred points per GPU.
import { NextResponse } from 'next/server'

import { requireGpuRead } from '@/lib/gpu/guard'
import {
  GPU_RANGES,
  getGpuMetricsLatest,
  getGpuMetricsSeries,
  gpuCode,
  gpuMetricsErrorResponse,
  isGpuRange,
  visibleSeries,
} from '@/lib/gpu/metrics'
import { loadVisibleGpuReport } from '@/lib/gpu/visibleReport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const access = await requireGpuRead()
  if (access.denied) return access.denied
  const range = new URL(req.url).searchParams.get('range') ?? '24h'
  if (!isGpuRange(range)) return gpuCode('invalid_range', 400)
  const { seconds, step } = GPU_RANGES[range]
  // Aligned on the step so two reads of the same minute share their buckets.
  const to = Math.ceil(Date.now() / 1000 / step) * step
  const from = to - seconds
  try {
    const report = await loadVisibleGpuReport()
    const connectionIds = [...new Set([...report.connections.map(c => c.id), ...report.allocations.map(a => a.connId)])]
    if (connectionIds.length === 0) return NextResponse.json({ data: { range, stepSeconds: step, from, to, series: [] } })
    const [res, latest] = await Promise.all([
      getGpuMetricsSeries({ from: new Date(from * 1000).toISOString(), to: new Date(to * 1000).toISOString(), step_seconds: step, connection_ids: connectionIds }),
      getGpuMetricsLatest(),
    ])
    return NextResponse.json({ data: { range, stepSeconds: step, from, to, series: visibleSeries(report, res.points, latest.gpus) } })
  } catch (e) {
    return gpuMetricsErrorResponse(e, 'series')
  }
}
