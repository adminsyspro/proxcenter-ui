import { describe, expect, it, vi } from 'vitest'

import { bulkBatchFromPayload, bulkJobRowTone, bulkJobState, bulkJobsAwaitingCutover, bulkJobsWithSyncInterval, bulkRowsFromBatch, countBulkJobs, migrationChipLabelKey, migrationChipTone, orderBulkJobs } from './bulkJobList'

const jobs = [
  { vmid: 'a', status: 'completed' },
  { vmid: 'b', status: 'queued' },
  { vmid: 'c', status: 'transferring' },
  { vmid: 'd', status: 'cancelled' },
  { vmid: 'e', status: 'pending' },
  { vmid: 'f', status: 'failed' },
]

describe('bulkJobList (roadmap#53)', () => {
  it('maps every job status to the five states the dialog shows', () => {
    expect(['completed', 'failed', 'cancelled', 'queued', 'pending', 'cutover'].map(bulkJobState))
      .toEqual(['completed', 'failed', 'cancelled', 'queued', 'active', 'active'])
    expect(countBulkJobs(jobs)).toEqual({ failed: 1, active: 2, queued: 1, completed: 1, cancelled: 1 })
  })

  it('lists failed, running, queued, completed then cancelled, in batch order within each', () => {
    expect(orderBulkJobs(jobs).map(j => j.vmid)).toEqual(['f', 'c', 'e', 'b', 'a', 'd'])
  })

  it('gives a queued or cancelled job a greyed-out chip with its label, a running one its %', () => {
    expect(['completed', 'failed', 'cancelled', 'queued', 'full_copy'].map(migrationChipTone))
      .toEqual(['success', 'error', 'muted', 'muted', 'active'])
    expect(['completed', 'failed', 'cancelled', 'queued', 'full_copy'].map(migrationChipLabelKey))
      .toEqual(['completed', 'failed', 'cancelled', 'queued', null])
  })
})

describe('rows and batch read from the server', () => {
  const snap = {
    id: 'b1', status: 'running', concurrency: 2, sourceConnectionId: 'esxi-1', targetConnectionId: 'pve-1',
    jobs: [
      { id: 'j1', sourceVmId: '1', sourceVmName: 'a', targetNode: 'pve1', status: 'transferring', progress: 40, bytesTransferred: 1024 },
      { id: 'j2', sourceVmId: '2', status: 'queued', bytesTransferred: null },
    ],
  }

  it('carries the copied bytes of a job, for the throughput of the follow-up', () => {
    expect(bulkRowsFromBatch(snap.jobs)).toEqual([
      { vmid: '1', name: 'a', jobId: 'j1', status: 'transferring', progress: 40, targetNode: 'pve1', bytesTransferred: 1024 },
      { vmid: '2', name: '2', jobId: 'j2', status: 'queued', progress: 0 },
    ])
  })

  it('keeps the target connection of the batch, for the live load of its nodes', () => {
    expect(bulkBatchFromPayload(snap)).toEqual({ id: 'b1', status: 'running', concurrency: 2, sourceConnectionId: 'esxi-1', targetConnectionId: 'pve-1' })
  })
})

describe('bulk batch follow-up helpers (roadmap#53)', () => {
  it('maps a batch read to the dialog rows and batch, keeping only the fields set', async () => {
    const { bulkRowsFromBatch, bulkBatchFromPayload } = await import('./bulkJobList')
    const rows = bulkRowsFromBatch([
      { id: 'j1', sourceVmId: 'vm-1', sourceVmName: 'web', targetNode: 'pve1', status: 'full_copy', progress: 40, logs: [{ ts: 't', msg: 'm', level: 'info' }], bytesTransferred: 1024, transferSpeed: '33 MB/s' },
      { id: 'j2', sourceVmId: 'vm-2', status: 'failed', error: 'boom', bytesTransferred: null, progress: null },
      { id: 'j3', sourceVmId: 'vm-3', status: 'queued', bytesTransferred: Number.NaN },
    ])
    expect(rows[0]).toEqual({ vmid: 'vm-1', name: 'web', jobId: 'j1', status: 'full_copy', progress: 40, logs: [{ ts: 't', msg: 'm', level: 'info' }], targetNode: 'pve1', bytesTransferred: 1024, transferSpeed: '33 MB/s' })
    expect(rows[1]).toEqual({ vmid: 'vm-2', name: 'vm-2', jobId: 'j2', status: 'failed', progress: 0, error: 'boom' })
    expect(rows[2]).not.toHaveProperty('bytesTransferred')
    expect(bulkBatchFromPayload({ id: 'b', status: 'running', concurrency: 2, sourceConnectionId: 's', targetConnectionId: 't', jobs: [] }))
      .toEqual({ id: 'b', status: 'running', concurrency: 2, sourceConnectionId: 's', targetConnectionId: 't' })
  })

  it('a batch is finished only when it starts nothing more and no job holds a slot', async () => {
    const { isBulkBatchFinished } = await import('./bulkJobList')
    expect(isBulkBatchFinished('completed', [{ status: 'completed' }, { status: 'failed' }])).toBe(true)
    expect(isBulkBatchFinished('cancelled', [{ status: 'cancelled' }])).toBe(true)
    expect(isBulkBatchFinished('cancelled', [{ status: 'full_copy' }])).toBe(false)
    expect(isBulkBatchFinished('paused', [{ status: 'completed' }])).toBe(false)
    expect(isBulkBatchFinished('running', [])).toBe(false)
  })

  it('tracks a job in the task bar once it started, never a queued one nor one already over at first look', async () => {
    const { shouldTrackBulkJob } = await import('./bulkJobList')
    expect(shouldTrackBulkJob({ status: 'queued' }, undefined)).toBe(false)
    expect(shouldTrackBulkJob({ status: 'full_copy' }, 'queued')).toBe(true)
    expect(shouldTrackBulkJob({ status: 'completed' }, undefined)).toBe(false)
    expect(shouldTrackBulkJob({ status: 'completed' }, 'completed')).toBe(false)
    expect(shouldTrackBulkJob({ status: 'completed' }, 'full_copy')).toBe(true)
    expect(shouldTrackBulkJob({ status: 'cancelled' }, 'queued')).toBe(false)
    expect(shouldTrackBulkJob({ status: 'failed', startedAt: '2026-10-18T00:00:00Z' }, 'queued')).toBe(true)
  })

  it('labels the source of the task-bar entries', async () => {
    const { bulkSourceTypeLabel } = await import('./bulkJobList')
    expect(['xcpng', 'vcenter', 'hyperv', 'nutanix', 'vmware', undefined].map(bulkSourceTypeLabel))
      .toEqual(['XCP-ng', 'vCenter', 'Hyper-V', 'Nutanix', 'ESXi', 'ESXi'])
  })

  it('reads a batch and the newest active one, null when unreadable', async () => {
    const { fetchBulkBatch, fetchActiveBulkBatch } = await import('./bulkJobList')
    const batch = { id: 'b1', status: 'running', concurrency: 1, sourceConnectionId: 's', targetConnectionId: 't', jobs: [] }
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('active=1')) return new Response(JSON.stringify({ data: [{ id: 'b1' }] }))
      if (url.endsWith('/b1')) return new Response(JSON.stringify({ data: batch }))
      return new Response('{}', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect(await fetchActiveBulkBatch('s')).toEqual(batch)
      expect(await fetchBulkBatch('nope')).toBeNull()
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      expect(await fetchActiveBulkBatch('s')).toBeNull()
      fetchMock.mockRejectedValueOnce(new Error('offline'))
      expect(await fetchBulkBatch('b1')).toBeNull()
      fetchMock.mockRejectedValueOnce(new Error('offline'))
      expect(await fetchActiveBulkBatch('s')).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('asks only for the log lines past the ones each row shows', async () => {
    const { fetchBulkBatch } = await import('./bulkJobList')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { id: 'b1', jobs: [] } })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await fetchBulkBatch('b1', [4, 0, 12])
      await fetchBulkBatch('b1', [])
      expect(fetchMock.mock.calls.map(c => (c as unknown[])[0])).toEqual([
        '/api/v1/migrations/batches/b1?logsAfter=4,0,12',
        '/api/v1/migrations/batches/b1',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('extends the log of each row with the new lines a read sent', async () => {
    const { bulkLogOffsets } = await import('./bulkJobList')
    const line = (msg: string) => ({ ts: 't', msg, level: 'info' })
    const shown = bulkRowsFromBatch([
      { id: 'j1', sourceVmId: 'vm-1', status: 'full_copy', logs: [line('a'), line('b')] },
      { id: 'j2', sourceVmId: 'vm-2', status: 'queued' },
    ])
    expect(bulkLogOffsets(shown)).toEqual([2, 0])

    const next = bulkRowsFromBatch([
      { id: 'j1', sourceVmId: 'vm-1', status: 'full_copy', logs: [line('c')], logOffset: 2 },
      { id: 'j2', sourceVmId: 'vm-2', status: 'pending', logs: [line('x')], logOffset: 0 },
    ], shown)

    expect(next[0].logs?.map(l => l.msg)).toEqual(['a', 'b', 'c'])
    expect(next[1].logs?.map(l => l.msg)).toEqual(['x'])
    expect(bulkLogOffsets(next)).toEqual([3, 1])

    // No new line: the row keeps its log.
    const idle = bulkRowsFromBatch([{ id: 'j1', sourceVmId: 'vm-1', status: 'full_copy', logs: [], logOffset: 3 }], next)
    expect(idle[0].logs).toHaveLength(3)
  })
})

describe('bulkJobsAwaitingCutover', () => {
  const job = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, sourceVmId: id, sourceVmName: id, status, ...extra })

  it('keeps the hold and its projection on the rows of a batch read', () => {
    const rows = bulkRowsFromBatch([
      job('a', 'delta_sync', { projectedDowntimeSec: 95, cutoverMode: 'manual' }),
      job('b', 'delta_sync', { projectedDowntimeSec: 80, cutoverMode: 'auto' }),
    ] as any)
    expect(rows[0]).toMatchObject({ manualHold: true, projectedDowntimeSec: 95 })
    expect(rows[1].manualHold).toBeUndefined()
  })

  it('lists the VMs held for a manual cutover once a first sync gave a projection, and the ones at the operator gate', () => {
    const rows = bulkRowsFromBatch([
      job('held', 'delta_sync', { projectedDowntimeSec: 95, cutoverMode: 'manual' }),
      job('first-pass', 'delta_sync', { projectedDowntimeSec: null, cutoverMode: 'manual' }),
      job('auto', 'delta_sync', { projectedDowntimeSec: 80, cutoverMode: 'auto' }),
      job('gate', 'awaiting_cutover', { projectedDowntimeSec: 900, cutoverMode: 'auto' }),
      job('copy', 'full_copy', { cutoverMode: 'manual' }),
      job('done', 'completed', { cutoverMode: 'manual' }),
    ] as any)
    expect(bulkJobsAwaitingCutover(rows).map(r => r.jobId)).toEqual(['held', 'gate'])
  })
})

describe('sync interval of a batch', () => {
  it('carries the interval and the suggestion of the manual jobs only', () => {
    const rows = bulkRowsFromBatch([
      { id: 'a', sourceVmId: 'vm-a', status: 'delta_sync', cutoverMode: 'manual', syncIntervalSec: 300, suggestedSyncIntervalSec: 900 },
      { id: 'b', sourceVmId: 'vm-b', status: 'delta_sync', cutoverMode: 'manual', syncIntervalSec: 60, suggestedSyncIntervalSec: null },
      { id: 'c', sourceVmId: 'vm-c', status: 'delta_sync', cutoverMode: 'auto', syncIntervalSec: 60, suggestedSyncIntervalSec: 900 },
    ])

    expect(rows.map(r => [r.syncIntervalSec, r.suggestedSyncIntervalSec])).toEqual([[300, 900], [60, undefined], [undefined, undefined]])
  })

  it('offers the change for the manual jobs that are not over, queued ones included', () => {
    const row = (jobId: string, status: string, manualHold = true) => ({ vmid: jobId, name: jobId, jobId, status, progress: 0, manualHold })
    const rows = [row('queued', 'queued'), row('copy', 'full_copy'), row('hold', 'delta_sync'), row('cut', 'cutover'), row('done', 'completed'), row('auto', 'delta_sync', false)]

    expect(bulkJobsWithSyncInterval(rows).map(r => r.jobId)).toEqual(['queued', 'copy', 'hold'])
  })
})

describe('a VM of a batch whose copy is under test', () => {
  const job = (over: Record<string, unknown> = {}) => ({ id: 'j1', sourceVmId: 'vm-1', sourceVmName: 'web-1', status: 'delta_sync', progress: 90, cutoverMode: 'manual', ...over })

  it('is marked while its test runs, and only then', () => {
    expect(bulkRowsFromBatch([job({ testState: { phase: 'running', testVmid: 9001 } }) as any])[0].inTest).toBe(true)
    expect(bulkRowsFromBatch([job({ testState: { phase: 'ended' } }) as any])[0]).not.toHaveProperty('inTest')
    expect(bulkRowsFromBatch([job({ status: 'cancelled', testState: { phase: 'running' } }) as any])[0]).not.toHaveProperty('inTest')
  })

  it('shows a test chip instead of its progress', () => {
    const flags = { isDone: false, isFailed: false, isCancelled: false, isQueued: false, isPaused: false }
    expect(bulkJobRowTone({ ...flags, inTest: true })).toMatchObject({ labelKey: 'testRowLabel', chipBg: 'info.main', chipColor: 'info.contrastText' })
    expect(bulkJobRowTone(flags).labelKey).toBeUndefined()
    expect(bulkJobRowTone({ ...flags, isDone: true }).labelKey).toBe('completed')
  })
})
