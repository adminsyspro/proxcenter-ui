import { NextResponse } from 'next/server'

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

export async function GET() {
  const now = Date.now()
  const points = 24

  // generate smooth-ish time series
  const baseCpu = 35 + Math.random() * 25
  const baseRam = 50 + Math.random() * 20
  const baseLatency = 2 + Math.random() * 4

  const series = Array.from({ length: points }).map((_, idx) => {
    const t = points - 1 - idx
    const ts = new Date(now - t * 60 * 60_000).toISOString()

    const cpu = clamp(baseCpu + (Math.sin(idx / 3) * 12) + (Math.random() * 6 - 3), 0, 100)
    const ram = clamp(baseRam + (Math.cos(idx / 4) * 10) + (Math.random() * 6 - 3), 0, 100)
    const latencyMs = clamp(baseLatency + (Math.sin(idx / 2) * 1.2) + (Math.random() * 0.8 - 0.4), 0.2, 40)

    return { ts, cpu: Math.round(cpu), ram: Math.round(ram), latencyMs: Number(latencyMs.toFixed(2)) }
  })

  const healthScore = clamp(
    Math.round(100 - (series[points - 1].cpu * 0.3 + series[points - 1].ram * 0.35 + series[points - 1].latencyMs * 2)),
    0,
    100
  )

  const hotspots = [
    { id: 'HS-001', type: 'node', name: 'pve-02', metric: 'CPU', value: `${series[points - 1].cpu}%`, trend: 'up' },
    { id: 'HS-002', type: 'vm', name: 'vm-db-01', metric: 'RAM', value: `${series[points - 1].ram}%`, trend: 'flat' },
    { id: 'HS-003', type: 'storage', name: 'ceph-prod', metric: 'Latency', value: `${series[points - 1].latencyMs}ms`, trend: 'up' }
  ]

  return NextResponse.json({
    data: {
      healthScore,
      kpis: {
        cpuUsagePct: series[points - 1].cpu,
        ramUsagePct: series[points - 1].ram,
        latencyMs: series[points - 1].latencyMs
      },
      series,
      hotspots
    }
  })
}
