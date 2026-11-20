import { describe, expect, it } from 'vitest'

import type { PCTask } from '@/contexts/ProxCenterTasksContext'

import { reportBellItems } from './reportBellItems'
import { REPORT_JOB_TTL_MS } from './reportJobConstants'

const NOW = Date.parse('2026-11-20T18:00:00Z')

function task(over: Partial<PCTask>): PCTask {
  return {
    id: 'report-j1',
    type: 'report',
    label: 'NIST SP 800-53 report',
    detail: 'PVE-PROD',
    progress: 100,
    status: 'done',
    createdAt: NOW - 60_000,
    finishedAt: NOW - 30_000,
    statusUrl: '/api/v1/compliance/report-jobs/j1',
    downloadUrl: '/api/v1/compliance/report-jobs/j1/download',
    ...over,
  }
}

describe('reportBellItems', () => {
  it('lists a ready report with its PDF and connection', () => {
    expect(reportBellItems([task({})], NOW)).toEqual([{
      taskId: 'report-j1',
      label: 'NIST SP 800-53 report',
      connectionName: 'PVE-PROD',
      status: 'done',
      error: undefined,
      downloadUrl: '/api/v1/compliance/report-jobs/j1/download',
      finishedAt: NOW - 30_000,
    }])
  })

  it('lists a failed report with why, and no download', () => {
    const [item] = reportBellItems([task({ status: 'error', error: 'PDF generation failed' })], NOW)

    expect(item).toMatchObject({ status: 'error', error: 'PDF generation failed', downloadUrl: undefined })
  })

  it('leaves out running reports, other tasks and reports the user removed', () => {
    expect(reportBellItems([
      task({ id: 'a', status: 'running' }),
      task({ id: 'b', type: 'upload' }),
      task({ id: 'c', dismissed: true }),
      task({ id: 'd', status: 'cancelled' }),
    ], NOW)).toEqual([])
  })

  it('drops a report once the server no longer holds it, dating an old row by its creation', () => {
    expect(reportBellItems([task({ finishedAt: NOW - REPORT_JOB_TTL_MS - 1 })], NOW)).toEqual([])
    expect(reportBellItems([task({ finishedAt: undefined, createdAt: NOW - REPORT_JOB_TTL_MS - 1 })], NOW)).toEqual([])
    expect(reportBellItems([task({ finishedAt: undefined, createdAt: NOW - 1000 })], NOW)).toHaveLength(1)
  })

  it('puts the newest first and reads the clock by default', () => {
    const now = Date.now()
    const items = reportBellItems([
      task({ id: 'old', finishedAt: now - 5000 }),
      task({ id: 'new', finishedAt: now - 1000 }),
    ])

    expect(items.map(i => i.taskId)).toEqual(['new', 'old'])
  })
})
