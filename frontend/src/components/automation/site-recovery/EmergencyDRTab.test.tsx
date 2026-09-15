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
    storage_engine: 'rbd',
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

function renderTab(jobs: ReplicationJob[], vmStatesByConn: Record<string, Record<number, string>> = {}) {
  renderWithProviders(
    <EmergencyDRTab
      jobs={jobs}
      plans={[]}
      loading={false}
      connections={[]}
      vmNamesByConn={{}}
      vmStatesByConn={vmStatesByConn}
      onStartVM={vi.fn()}
      onStopVM={vi.fn()}
      loadRestorePoints={vi.fn().mockResolvedValue({ restore_points: [] })}
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

  it('renders a translated warning chip for a partial job instead of the raw value', () => {
    renderTab([job({ status: 'partial' })])

    const chip = screen.getByText('Partially synced').closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('MuiChip-colorWarning')
    expect(screen.queryByText('partial')).not.toBeInTheDocument()
  })

  it('keeps the existing raw labels for the other statuses', () => {
    renderTab([job({ status: 'synced' })])

    const chip = screen.getByText('synced').closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('MuiChip-colorSuccess')
  })
})

describe('EmergencyDRTab: DR replica state column (issue #944)', () => {
  // Column order of a standalone row: name, source VMID, DR VMID, replica.
  const replicaCell = () => (screen.getAllByRole('row')[1] as HTMLTableRowElement).cells[3].textContent

  it('says the replica is started, never "running", for a guest PVE reports as running', () => {
    renderTab([job({ vmid_prefix: 5 })], { dst: { 5100: 'running' } })

    expect(replicaCell()).toBe('Started')
  })

  it('says started for a PAUSED replica too: PVE reports it as running, and a paused guest serves nothing', () => {
    renderTab([job({ vmid_prefix: 5 })], { dst: { 5100: 'paused' } })

    expect(replicaCell()).toBe('Started')
  })

  it('renders a stopped replica as stopped', () => {
    renderTab([job({ vmid_prefix: 5 })], { dst: { 5100: 'stopped' } })

    expect(replicaCell()).toBe('Stopped')
  })

  it('falls back to a dash when the inventory knows nothing about the replica', () => {
    renderTab([job({ vmid_prefix: 5 })], {})

    expect(replicaCell()).toBe('-')
  })

  it('reads the replica state on the TARGET cluster, not the source VMID of the same number', () => {
    renderTab([job({ vmid_prefix: 5 })], { src: { 100: 'running' }, dst: { 5100: 'stopped' } })

    expect(replicaCell()).toBe('Stopped')
  })
})
