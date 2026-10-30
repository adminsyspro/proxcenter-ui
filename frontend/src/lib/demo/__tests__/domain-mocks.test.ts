import { describe, it, expect } from 'vitest'

import { EXTRA_MOCKS, demoResponse } from '../demo-api'
import mockDataJson from '../mock-data.json'
import { DOMAIN_MOCKS } from '../mocks'
import { demoBackupRuns } from '../mocks/backups'

const demoGet = async (path: string): Promise<any> => {
  const prev = process.env.DEMO_MODE

  process.env.DEMO_MODE = 'true'

  try {
    const res = await demoResponse(new Request(`http://localhost${path}`))

    return res ? await res.json() : null
  } finally {
    process.env.DEMO_MODE = prev
  }
}

describe('demo domain mocks', () => {
  it('no domain key is masked by EXTRA_MOCKS or mock-data.json, nor duplicated across domains', () => {
    const seen = new Set<string>()

    for (const map of DOMAIN_MOCKS) {
      for (const key of Object.keys(map)) {
        expect(EXTRA_MOCKS, key).not.toHaveProperty([key])
        expect(mockDataJson, key).not.toHaveProperty([key.replace(/^GET:/, '')])
        expect(seen.has(key), `${key} in two domains`).toBe(false)
        seen.add(key)
      }
    }
  })

  it('tag-access is the policy object TagManager reads, not the list fallback', async () => {
    // TagManager reads access.allowedTags.length as soon as access is set.
    const body = await demoGet('/api/v1/connections/demo-pve-cluster-001/tag-access')

    expect(Array.isArray(body.data)).toBe(false)
    expect(Array.isArray(body.data.allowedTags)).toBe(true)
    expect(Array.isArray(body.data.lockedTags)).toBe(true)
  })

  it('backup-jobs/runs is the BackupRunsResult PveJobsTab reads', async () => {
    // BackupJobsTabs reads runsData.unreachableNodes.length and runsData.manual.runs.
    const body = await demoGet('/api/v1/connections/demo-pve-cluster-001/backup-jobs/runs?days=7')

    expect(body.data.unreachableNodes).toEqual([])
    expect(body.data.window.days).toBe(7)
    expect(body.data.manual.runs.length).toBeGreaterThan(0)
    expect(body.data.jobs.map((j: any) => j.jobId)).toEqual(['backup-daily-001', 'backup-weekly-001'])
  })

  it('backup jobs carry the formatted route fields BackupJobsPanel and BackupCoverageCard read', async () => {
    // BackupJobsPanel shows nextRun; BackupCoverageCard.toVzdumpJob reads selectionMode/vmids/excludedVmids.
    const { data } = await demoGet('/api/v1/connections/demo-pve-cluster-001/backup-jobs')

    for (const job of data.jobs) {
      expect(typeof job.nextRun, job.id).toBe('number')
      expect(job.schedule, job.id).not.toMatch(/\*/)
      expect(Array.isArray(job.vmids) && Array.isArray(job.excludedVmids), job.id).toBe(true)
    }
    expect(data.jobs.map((j: any) => j.selectionMode)).toEqual(['all', 'include'])
  })

  it('compliance profiles are ComplianceProfile rows (snake_case, created_at)', async () => {
    // security/compliance Profiles tab renders new Date(p.created_at) and p.is_active.
    const { data } = await demoGet('/api/v1/compliance/profiles')

    for (const p of data) {
      expect(Number.isNaN(new Date(p.created_at).getTime()), p.id).toBe(false)
      expect([0, 1]).toContain(p.is_active)
    }
  })

  it('a guest without an HA resource answers data: null, not the list fallback', async () => {
    // useHA fills the HA form from configJson.data when it is truthy.
    for (const sid of ['vm:121', 'vm%3A121', 'ct:300']) {
      expect(await demoGet(`/api/v1/connections/demo-pve-cluster-001/ha/${sid}`), sid).toEqual({ data: null })
    }
  })

  it('backup runs are newest first and inside the window', () => {
    const now = 1_800_000_000
    const { jobs, window } = demoBackupRuns(30, now)

    for (const job of jobs) {
      expect(job.lastRun).toBe(job.runs[0])
      for (const run of job.runs) {
        expect(run.start).toBeGreaterThanOrEqual(window.since)
        expect(run.start).toBeLessThanOrEqual(now)
      }
      expect([...job.runs].sort((a, b) => b.start - a.start)).toEqual(job.runs)
    }
  })
})
