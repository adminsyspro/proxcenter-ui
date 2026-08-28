/**
 * Component tests for ProtectionTab's "failed over" lockdown (issue #664
 * follow-up): once a recovery plan fails over, its replication jobs are
 * marked "failed_over" on the backend. The job card must show a distinct
 * chip and its Sync now / Resume / Edit actions must be disabled — a
 * "Sync now" or resume on a failed-over job would rbd import-diff over
 * what is now the production copy.
 */

import { useState } from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import type { ReplicationJob } from '@/lib/orchestrator/site-recovery.types'

import ProtectionTab from './ProtectionTab'

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

// ProtectionTab is controlled: which job is selected (drawer open/closed)
// lives with the parent. This harness plays that role so clicking a card
// actually opens the drawer, matching RecoveryPlansTab.test.tsx's pattern.
function Harness({ jobs }: { jobs: ReplicationJob[] }) {
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  return (
    <ProtectionTab
      jobs={jobs}
      loading={false}
      logs={[]}
      logsLoading={false}
      connections={[]}
      onSyncJob={vi.fn()}
      onPauseJob={vi.fn()}
      onResumeJob={vi.fn()}
      onDeleteJob={vi.fn()}
      onEditJob={vi.fn()}
      selectedJobId={selectedJobId}
      onSelectJob={setSelectedJobId}
    />
  )
}

function renderTab(jobs: ReplicationJob[]) {
  renderWithProviders(<Harness jobs={jobs} />)
}

// Opening the drawer triggers a throughput fetch unconditionally (and a
// per-VM status fetch for multi-VM jobs, not used here since every fixture
// job has a single VM). Stub it so the drawer renders without an unhandled
// MSW request failing the test.
function stubThroughputFetch() {
  server.use(
    http.get('/api/v1/orchestrator/replication/jobs/:id/throughput', () => HttpResponse.json([])),
  )
}

const openDrawer = async (label: string) => userEvent.click(screen.getByText(label))

describe('ProtectionTab — failed-over job lockdown', () => {
  it('shows a distinct "Failed over" chip with the warning color and shield icon', () => {
    renderTab([job({ status: 'failed_over' })])

    const chipLabel = screen.getByText('Failed over')
    const chip = chipLabel.closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('MuiChip-colorWarning')
    expect(chip?.querySelector('.ri-shield-star-line')).toBeInTheDocument()
  })

  it('disables the card-level Edit button for a failed-over job but not for a pending job', () => {
    renderTab([job({ status: 'failed_over' })])
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()

    cleanup()

    renderTab([job({ status: 'pending' })])
    expect(screen.getByRole('button', { name: 'Edit' })).not.toBeDisabled()
  })

  it('disables Sync now, Resume and Edit in the drawer for a failed-over job, keeps Delete enabled', async () => {
    stubThroughputFetch()
    renderTab([job({ status: 'failed_over' })])

    await openDrawer('100 - web-01')

    expect(await screen.findByRole('button', { name: 'Sync Now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled()
  })

  it('keeps Sync now and Resume enabled in the drawer for a paused (not failed-over) job', async () => {
    stubThroughputFetch()
    renderTab([job({ status: 'paused' })])

    await openDrawer('100 - web-01')

    expect(await screen.findByRole('button', { name: 'Sync Now' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Resume' })).not.toBeDisabled()
  })
})

describe('ProtectionTab: no matching VMs status (issue #687)', () => {
  it('shows the "No matching VMs" chip for a no_match job', () => {
    renderTab([job({ status: 'no_match' })])

    const chipLabel = screen.getByText('No matching VMs')
    const chip = chipLabel.closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('MuiChip-colorWarning')
    expect(chip?.querySelector('.ri-price-tag-3-line')).toBeInTheDocument()
  })

  it('offers no_match in the status filter and filters the job list to matching jobs', async () => {
    renderTab([
      job({ id: 'job-no-match', status: 'no_match', vm_ids: [200], vm_names: ['no-match-vm'] }),
      job({ id: 'job-pending', status: 'pending', vm_ids: [201], vm_names: ['pending-vm'] }),
    ])

    fireEvent.mouseDown(screen.getByRole('combobox'))
    const noMatchOption = await screen.findByRole('option', { name: 'No matching VMs' })
    expect(noMatchOption).toBeInTheDocument()
    await userEvent.click(noMatchOption)

    expect(screen.getByText('200 - no-match-vm')).toBeInTheDocument()
    expect(screen.queryByText('201 - pending-vm')).not.toBeInTheDocument()
  })
})

describe('ProtectionTab: partially synced status', () => {
  // A job where some VMs synced and one failed (for instance a VM whose
  // Proxmox snapshot broke the mirror snapshot) is "partial": the healthy
  // VMs are protected, the job stays scheduled, and the card must say so
  // instead of showing a bare error or a raw status string.
  it('shows the "Partially synced" warning chip for a partial job', () => {
    renderTab([job({ status: 'partial', error_message: '1 of 6 VMs failed: VM 279: failed to create snapshot' })])

    const chipLabel = screen.getByText('Partially synced')
    const chip = chipLabel.closest('.MuiChip-root')
    expect(chip).toBeInTheDocument()
    expect(chip).toHaveClass('MuiChip-colorWarning')
    expect(chip?.querySelector('.ri-error-warning-line')).toBeInTheDocument()
    expect(screen.queryByText('partial')).not.toBeInTheDocument()
  })

  it('offers partial in the status filter and filters the job list to partial jobs', async () => {
    renderTab([
      job({ id: 'job-partial', status: 'partial', vm_ids: [279], vm_names: ['git-ia'] }),
      job({ id: 'job-synced', status: 'synced', vm_ids: [221], vm_names: ['sarbacane'] }),
    ])

    fireEvent.mouseDown(screen.getByRole('combobox'))
    await userEvent.click(await screen.findByRole('option', { name: 'Partially synced' }))

    expect(screen.getByText('279 - git-ia')).toBeInTheDocument()
    expect(screen.queryByText('221 - sarbacane')).not.toBeInTheDocument()
  })

  it('shows the failure summary as a warning in the drawer of a partial job', async () => {
    renderTab([job({ status: 'partial', error_message: '1 of 6 VMs failed: VM 279: failed to create snapshot' })])

    await openDrawer('100 - web-01')

    const alert = await screen.findByText('1 of 6 VMs failed: VM 279: failed to create snapshot')
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorWarning')
  })
})
