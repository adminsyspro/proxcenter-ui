/**
 * Demo mocks for the backup screens (/operations/backups).
 */

import type { BackupRunsResult } from '@/lib/backups/vzdumpRunsService'
import type { RunStatus, RunSummary } from '@/lib/backups/vzdumpRuns'

import type { DemoMockMap, DemoMockResolver } from './index'

const DAY = 86400

// Jobs of GET /connections/demo-pve-cluster-001/backup-jobs, with the guests
// each one covers and the nodes its tasks run on.
const DEMO_RUN_JOBS = [
  { jobId: 'backup-daily-001', hourUtc: 2, everyDays: 1, nodes: ['pve-node-01', 'pve-node-02', 'pve-node-03'], vmids: [[100, 101, 102], [103, 104, 105], [106, 107, 108]] },
  { jobId: 'backup-weekly-001', hourUtc: 3, everyDays: 7, nodes: ['pve-node-01', 'pve-node-03'], vmids: [[100, 101, 102], [104]] },
]

// Deterministic per run, so the history does not reshuffle on every poll.
const runStatus = (seed: number): RunStatus => {
  const r = (seed * 2654435761) % 100

  if (r < 4) return 'failed'
  if (r < 10) return 'warning'

  return 'ok'
}

function buildRun(jobId: string, start: number, nodes: string[], vmids: number[][], origin: RunSummary['origin']): RunSummary {
  const status = runStatus(Math.floor(start / DAY) + jobId.length)
  const tasks = nodes.map((node, i) => {
    const taskStart = start + i * 7
    const taskEnd = taskStart + 600 + vmids[i].length * 240
    const hex = taskStart.toString(16).toUpperCase()

    return {
      node,
      upid: `UPID:${node}:000${(4000 + i).toString(16).toUpperCase()}:00A1B2C3:${hex}:vzdump::root@pam:`,
      status: status === 'failed' && i === 0 ? 'job errors' : 'OK',
      start: taskStart,
      end: taskEnd,
      vmids: vmids[i],
      logUnavailable: false,
    }
  })
  const end = Math.max(...tasks.map(t => t.end))
  const total = vmids.flat().length

  return {
    id: `${jobId}:${start}`,
    start,
    end,
    durationSec: end - start,
    origin,
    status,
    statusDetail: { failed: status === 'failed' ? vmids[0].length : 0, total },
    tasks,
  }
}

/** Shape of buildBackupRunsResult(), read by BackupJobsTabs (PveJobsTab). */
export function demoBackupRuns(days: number, now = Math.floor(Date.now() / 1000)): BackupRunsResult {
  const since = now - days * DAY
  const today = now - (now % DAY)

  const jobs = DEMO_RUN_JOBS.map(job => {
    const runs: RunSummary[] = []

    for (let d = 0; d <= days; d += job.everyDays) {
      const start = today - d * DAY + job.hourUtc * 3600

      if (start <= now && start >= since) runs.push(buildRun(job.jobId, start, job.nodes, job.vmids, 'scheduled'))
    }

    return {
      jobId: job.jobId,
      pool: null,
      nextRun: today + DAY + job.hourUtc * 3600,
      lastRun: runs[0] ?? null,
      runs,
    }
  })

  const manualStart = today - 3 * DAY + 15 * 3600
  const manual = [buildRun('manual', manualStart, ['pve-node-02'], [[110]], 'manual')]

  return {
    jobs,
    manual: { lastRun: manual[0], runs: manual },
    unreachableNodes: [],
    truncatedNodes: [],
    window: { since, days },
  }
}

export const BACKUP_MOCKS: DemoMockMap = {}

export const resolveBackupMock: DemoMockResolver = (method, cleanPath, url) => {
  if (method !== 'GET') return null

  if (/^\/api\/v1\/connections\/[^/]+\/backup-jobs\/runs$/.test(cleanPath)) {
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 90)

    return { data: demoBackupRuns(days) }
  }

  return null
}
