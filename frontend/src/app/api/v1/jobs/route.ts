import { NextResponse } from 'next/server'

function pick<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

export async function GET() {
  const now = Date.now()
  const types = ['backup', 'replication', 'snapshot', 'migration', 'scrub', 'inventory'] as const
  const statuses = ['queued', 'running', 'success', 'failed', 'canceled'] as const

  const jobs = Array.from({ length: 28 }).map((_, i) => {
    const type = pick([...types])
    const status = pick([...statuses])
    const createdMinutesAgo = Math.floor(Math.random() * 24 * 60)

    const progress =
      status === 'running'
        ? Math.floor(10 + Math.random() * 85)
        : status === 'queued'
          ? 0
          : 100

    const durationSec =
      status === 'queued' ? 0 : Math.floor(10 + Math.random() * 900)

    return {
      id: `JOB-${String(i + 1).padStart(5, '0')}`,
      type,
      status,
      target: pick(['vm-web-01', 'vm-db-01', 'ct-monitoring', 'pve-03', 'ceph-prod']),
      createdAt: new Date(now - createdMinutesAgo * 60_000).toISOString(),
      startedAt: status === 'queued' ? null : new Date(now - Math.max(createdMinutesAgo - 2, 0) * 60_000).toISOString(),
      finishedAt: status === 'running' || status === 'queued' ? null : new Date(now - Math.max(createdMinutesAgo - 1, 0) * 60_000).toISOString(),
      progress,
      durationSec,
      steps: [
        { name: 'Prepare', status: progress >= 5 ? 'done' : 'pending' },
        { name: 'Execute', status: progress >= 30 ? (status === 'failed' ? 'failed' : 'done') : 'running' },
        { name: 'Verify', status: progress >= 80 ? 'done' : 'pending' },
        { name: 'Finalize', status: status === 'success' ? 'done' : status === 'failed' ? 'skipped' : 'pending' }
      ],
      logs: [
        `[${new Date(now - createdMinutesAgo * 60_000).toISOString()}] Job created`,
        status === 'queued' ? 'Waiting for worker slot...' : 'Worker allocated',
        status === 'failed' ? 'Error: remote endpoint timeout' : 'No errors reported',
      ]
    }
  })

  jobs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  return NextResponse.json({ data: jobs })
}
