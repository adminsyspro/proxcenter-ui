/**
 * Component tests for EmergencyDRTab's job status chip (issue #687): a job
 * whose tags currently match no VMs carries the new "no_match" status, which
 * must render as a translated warning chip, not as the raw enum value.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { ReplicationJob } from '@/lib/orchestrator/site-recovery.types'

import EmergencyDRTab from './EmergencyDRTab'

afterEach(cleanup)

function job(overrides: Partial<ReplicationJob> = {}): ReplicationJob {
  return {
    id: 'job-1',
    name: '',
    vm_ids: [100],
    vm_names: ['web-01'],
    tags: [],
    source_cluster: 'src',
    target_cluster: 'dst',
    target_pool: 'rbd',
    vmid_prefix: 0,
    status: 'pending',
    schedule: '*/15 * * * *',
    schedule_spec: null,
    timezone: '',
    rpo_target: 900,
    last_sync: null,
    next_sync: null,
    retry_count: 0,
    next_retry_at: null,
    throughput_bps: 0,
    rate_limit_mbps: 0,
    bandwidth_windows: [],
    network_mapping: {},
    progress_percent: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderTab(jobs: ReplicationJob[]) {
  renderWithProviders(
    <EmergencyDRTab
      jobs={jobs}
      plans={[]}
      loading={false}
      connections={[]}
      vmNamesByConn={{}}
      onStartVM={vi.fn()}
      onExecuteFailover={vi.fn()}
      onExecuteFailback={vi.fn()}
    />,
  )
}

describe('EmergencyDRTab: job status chip', () => {
  it('renders a translated warning chip for a no_match job instead of the raw value', () => {
    renderTab([job({ status: 'no_match' })])

    const chipLabel = screen.getByText('No matching VMs')
    const chip = chipLabel.closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('MuiChip-colorWarning')
    expect(screen.queryByText('no_match')).not.toBeInTheDocument()
  })

  it('keeps the existing raw labels for the other statuses', () => {
    renderTab([job({ status: 'synced' })])

    const chip = screen.getByText('synced').closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('MuiChip-colorSuccess')
  })
})
