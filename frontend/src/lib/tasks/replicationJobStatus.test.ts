import { describe, expect, it } from 'vitest'

import { replicationJobStatus } from './replicationJobStatus'

describe('replicationJobStatus', () => {
  it('maps the terminal statuses to the unified success / failed values', () => {
    expect(replicationJobStatus('synced')).toBe('success')
    expect(replicationJobStatus('error')).toBe('failed')
  })

  it('reports a partially synced job as failed so the taskbar does not show it as running forever', () => {
    expect(replicationJobStatus('partial')).toBe('failed')
  })

  it('keeps syncing as running and passes the other statuses through', () => {
    expect(replicationJobStatus('syncing')).toBe('running')
    expect(replicationJobStatus('paused')).toBe('paused')
    expect(replicationJobStatus('pending')).toBe('pending')
    expect(replicationJobStatus('no_match')).toBe('no_match')
  })
})
