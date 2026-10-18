import { describe, expect, it, vi } from 'vitest'

import { bulkBatchFromPayload, bulkJobState, bulkRowsFromBatch, countBulkJobs, migrationChipLabelKey, migrationChipTone, orderBulkJobs } from './bulkJobList'

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
})
