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

import { renderWithProviders, screen, userEvent, fireEvent, within, waitFor } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import type { ReplicationJob } from '@/lib/orchestrator/site-recovery.types'

import ProtectionTab from './ProtectionTab'

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

type VMStatus = {
  vmid: number
  vm_name?: string
  status: string
  last_sync: string | null
  last_error?: string
  bytes_sent: number
  duration_ms: number
}

// Opening the drawer triggers both requests for every job that protects a VM.
function stubDrawerFetch(vmStatuses: VMStatus[] = []) {
  server.use(
    http.get('/api/v1/orchestrator/replication/jobs/:id/throughput', () => HttpResponse.json([])),
    http.get('/api/v1/orchestrator/replication/jobs/:id/vms', () => HttpResponse.json(vmStatuses)),
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
    stubDrawerFetch()
    renderTab([job({ status: 'failed_over' })])

    await openDrawer('100 - web-01')

    expect(await screen.findByRole('button', { name: 'Sync Now' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled()
  })

  it('keeps Sync now and Resume enabled in the drawer for a paused (not failed-over) job', async () => {
    stubDrawerFetch()
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
    stubDrawerFetch()
    renderTab([job({ status: 'partial', error_message: '1 of 6 VMs failed: VM 279: failed to create snapshot' })])

    await openDrawer('100 - web-01')

    const alert = await screen.findByText('1 of 6 VMs failed: VM 279: failed to create snapshot')
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorWarning')
  })
})

it('shows ZFS glyphs and target node in the job row and detail drawer without a repeating tooltip', async () => {
  stubDrawerFetch()
  renderTab([job({ storage_engine: 'zfs', target_pool: 'local-zfs', target_node: 'dr1' })])
  expect(screen.getByRole('img', { name: 'ZFS' })).toBeInTheDocument()
  expect(screen.queryByText('local-zfs · dr1')).not.toBeInTheDocument()
  await openDrawer('100 - web-01')
  // Drawer header, then the source and target of its route block; the open
  // drawer hides the list behind it from assistive technology.
  expect(screen.getAllByRole('img', { name: 'ZFS' })).toHaveLength(3)
  expect(screen.getByText('dst / local-zfs · dr1')).toBeInTheDocument()
  expect(screen.queryByRole('tooltip', { name: 'ZFS' })).not.toBeInTheDocument()
})

it('uses the Ceph glyph for a legacy job without an engine field', () => {
  renderTab([job({ storage_engine: undefined })])
  expect(screen.getByRole('img', { name: 'Ceph RBD' })).toHaveAttribute('src', '/images/ceph-logo.svg')
})

it('paginates long job lists', async () => {
  renderTab(Array.from({ length: 26 }, (_, index) => job({ id: `job-${index}`, name: `Protection ${index}` })))
  expect(screen.getByText('Protection 0')).toBeInTheDocument()
  expect(screen.queryByText('Protection 25')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
  expect(screen.getByText('Protection 25')).toBeInTheDocument()
  expect(screen.queryByText('Protection 0')).not.toBeInTheDocument()
})

it('separates Ceph and ZFS jobs of the same cluster pair with one labelled section per engine', () => {
  renderTab([
    job({ id: 'zfs-1', vm_ids: [102], vm_names: ['win'], storage_engine: 'zfs', target_pool: 'ZFS-Pool', target_node: 'pve2-dr' }),
    job({ id: 'rbd-1', storage_engine: 'rbd' }),
  ])
  const separators = screen.getAllByRole('separator')
  expect(separators.map(s => s.getAttribute('aria-label'))).toEqual(['Ceph RBD', 'ZFS'])
  const rows = screen.getAllByText(/100 - web-01|102 - win/)
  expect(rows.map(r => r.textContent)).toEqual(['100 - web-01', '102 - win'])
})

it('shows no engine section when a cluster pair holds a single engine', () => {
  renderTab([job({ id: 'a' }), job({ id: 'b', vm_ids: [101], vm_names: ['db'] })])
  expect(screen.queryByRole('separator')).not.toBeInTheDocument()
})

describe('ProtectionTab job details', () => {
  it('shows the explicit job name, engine and replication label while syncing from source to target', async () => {
    stubDrawerFetch()
    renderTab([job({ name: 'Nightly DR', status: 'syncing' })])

    await openDrawer('Nightly DR')

    const dialog = await screen.findByRole('dialog')
    expect(screen.getByRole('heading')).toHaveTextContent('Nightly DR- Ceph RBD Replication')
    expect(dialog).toHaveTextContent('0100111011010010')
    expect(dialog.querySelector('.ri-arrow-right-s-line')).toBeInTheDocument()
  })

  it('falls back to the derived guest label and shows an idle connector', async () => {
    stubDrawerFetch()
    renderTab([job({ storage_engine: 'zfs', target_node: 'dr1', target_pool: 'local-zfs' })])

    await openDrawer('100 - web-01')

    const dialog = await screen.findByRole('dialog')
    expect(screen.getByRole('heading')).toHaveTextContent('100 - web-01- ZFS Replication')
    expect(dialog).not.toHaveTextContent('0100111011010010')
    expect(dialog.querySelector('.ri-arrow-right-s-line')).not.toBeInTheDocument()
  })

  it('shows every per-VM state with its state colour, tooltip, figures and glyph', async () => {
    stubDrawerFetch([
      { vmid: 100, vm_name: 'synced-vm', status: 'synced', last_sync: '2026-01-02T03:04:05Z', bytes_sent: 2048, duration_ms: 120000 },
      { vmid: 101, vm_name: 'syncing-vm', status: 'syncing', last_sync: null, bytes_sent: 0, duration_ms: 0 },
      { vmid: 102, vm_name: 'error-vm', status: 'error', last_sync: null, last_error: 'snapshot failed', bytes_sent: 4096, duration_ms: 60000 },
      { vmid: 103, vm_name: 'suspended-vm', status: 'suspended', last_sync: null, bytes_sent: 0, duration_ms: 0 },
      { vmid: 104, status: 'pending', last_sync: null, bytes_sent: 0, duration_ms: 0 },
    ])
    renderTab([job({ vm_ids: [100, 101, 102, 103, 104], vm_names: ['synced-vm', 'syncing-vm', 'error-vm', 'suspended-vm', 'pending-vm'] })])

    await openDrawer('5 VMs (100 - synced-vm, 101 - syncing-vm…)')

    const expected = [
      ['Synced', 'ri-checkbox-circle-line', 'rgb(46, 125, 50)'],
      ['Syncing', 'ri-refresh-line', 'rgb(25, 118, 210)'],
      ['Error', 'ri-error-warning-line', 'rgb(211, 47, 47)'],
      ['Suspended (test in progress)', 'ri-pause-circle-line', 'rgb(237, 108, 2)'],
      ['Pending', 'ri-time-line', 'rgba(0, 0, 0, 0.38)'],
    ] as const

    for (const [label, glyph, dotColor] of expected) {
      const state = await screen.findByRole('img', { name: label })
      const row = state.parentElement!
      expect(row.querySelector(`.${glyph}`)).toBeInTheDocument()
      expect(getComputedStyle(state.querySelector('span')!).backgroundColor).toBe(dotColor)
    }

    expect(screen.getByText('100 · synced-vm').parentElement).toHaveTextContent('2.0 KB · 2m')
    const errorRow = screen.getByText('102 · error-vm').parentElement!
    expect(errorRow).toHaveTextContent('snapshot failed')
    expect(errorRow).not.toHaveTextContent('4.0 KB')
    await userEvent.hover(screen.getByRole('img', { name: 'Error' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Error — snapshot failed')
    expect(screen.getByText('VM 104')).toBeInTheDocument()
  })

  it('fetches and displays per-VM status for a single guest', async () => {
    stubDrawerFetch([
      { vmid: 100, vm_name: 'web-01', status: 'synced', last_sync: null, bytes_sent: 0, duration_ms: 0 },
    ])
    renderTab([job()])

    await openDrawer('100 - web-01')

    expect(await screen.findByText('Per-VM status')).toBeInTheDocument()
    expect(screen.getByText('100 · web-01')).toBeInTheDocument()
  })

  it('paginates per-VM status beyond five guests', async () => {
    const statuses = Array.from({ length: 7 }, (_, index) => ({
      vmid: 200 + index,
      vm_name: `guest-${index + 1}`,
      status: 'pending',
      last_sync: null,
      bytes_sent: 0,
      duration_ms: 0,
    }))
    stubDrawerFetch(statuses)
    renderTab([job({ vm_ids: statuses.map(row => row.vmid), vm_names: statuses.map(row => row.vm_name) })])

    await openDrawer('7 VMs (200 - guest-1, 201 - guest-2…)')

    expect(await screen.findByText('200 · guest-1')).toBeInTheDocument()
    expect(screen.queryByText('206 · guest-7')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Go to next page' }))
    expect(screen.getByText('206 · guest-7')).toBeInTheDocument()
    expect(screen.queryByText('200 · guest-1')).not.toBeInTheDocument()
  })
})


it('shows backup skips with their reason instead of old successful run figures', async () => {
  stubDrawerFetch([{ vmid: 100, vm_name: 'web-01', status: 'skipped', last_sync: null, last_error: 'Backup is running', bytes_sent: 2048, duration_ms: 1000 }])
  renderTab([job()])
  await openDrawer('100 - web-01')
  expect(await screen.findByRole('img', { name: 'Skipped (guest busy)' })).toBeInTheDocument()
  expect(screen.getByText('Backup is running')).toBeInTheDocument()
  expect(screen.queryByText(/2.0 KB/)).not.toBeInTheDocument()
})

it.each(['rbd', 'zfs'] as const)('requires explicit confirmation before re-seeding a %s guest', async storage_engine => {
  stubDrawerFetch([{ vmid: 100, vm_name: 'web-01', status: 'reseed_required', last_sync: null, last_error: 'Source disk was replaced', bytes_sent: 0, duration_ms: 0 }])
  const requests: unknown[] = []
  server.use(http.post('/api/v1/orchestrator/replication/jobs/:id/vms/:vmid/reseed', async ({ request }) => {
    requests.push(await request.json())
    return HttpResponse.json({ status: 'queued' }, { status: 202 })
  }))
  renderTab([job({ storage_engine })])
  await openDrawer('100 - web-01')
  await userEvent.click(await screen.findByRole('button', { name: 'Re-seed' }))
  const confirmation = screen.getAllByRole('dialog').at(-1)!
  expect(confirmation).toHaveTextContent('100 · web-01')
  expect(confirmation).toHaveTextContent('All DR restore points')
  expect(requests).toEqual([])
  await userEvent.click(within(confirmation).getByRole('button', { name: 'Re-seed' }))
  await waitFor(() => expect(requests).toEqual([{ confirm: true }]))
  expect(await screen.findByText('Full replication queued.')).toBeInTheDocument()
})

it('preserves the confirmation and displays a rejected re-seed reason', async () => {
  stubDrawerFetch([{ vmid: 100, vm_name: 'web-01', status: 'reseed_required', last_sync: null, bytes_sent: 0, duration_ms: 0 }])
  server.use(http.post('/api/v1/orchestrator/replication/jobs/:id/vms/:vmid/reseed', () => HttpResponse.json({ error: 'Recovery is active' }, { status: 409 })))
  renderTab([job()])
  await openDrawer('100 - web-01')
  await userEvent.click(await screen.findByRole('button', { name: 'Re-seed' }))
  const confirmation = screen.getAllByRole('dialog').at(-1)!
  await userEvent.click(within(confirmation).getByRole('button', { name: 'Re-seed' }))
  expect(await screen.findByText('Recovery is active')).toBeInTheDocument()
  expect(within(confirmation).getByRole('button', { name: 'Re-seed' })).toBeEnabled()
})


it('shows missing source guests without offering re-seed', async () => {
  stubDrawerFetch([{ vmid: 100, vm_name: 'web-01', status: 'source_missing', last_sync: null, last_error: 'Source guest no longer exists', bytes_sent: 0, duration_ms: 0 }])
  renderTab([job()])
  await openDrawer('100 - web-01')
  expect(await screen.findByRole('img', { name: 'Source guest missing' })).toBeInTheDocument()
  expect(screen.getByText('Source guest no longer exists')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Re-seed' })).not.toBeInTheDocument()
})


describe('ProtectionTab — a re-seed the orchestrator has accepted but not started', () => {
  // The drawer re-reads /vms every time the job list refreshes (15 s upstream
  // poll). Between the 202 and the moment the orchestrator picks the guest up,
  // that read still reports `reseed_required`: the row must not offer the
  // destructive wipe a second time under the green "queued" banner.
  const reseedRequired = [{
    vmid: 100, vm_name: 'web-01', status: 'reseed_required',
    last_sync: null, last_error: 'Source disk was replaced', bytes_sent: 0, duration_ms: 0,
  }]

  const queueAReseed = async (requests: unknown[]) => {
    server.use(http.post('/api/v1/orchestrator/replication/jobs/:id/vms/:vmid/reseed', async ({ request }) => {
      requests.push(await request.json())

      // An accepted re-seed may answer 202 with no body at all.
      return new HttpResponse(null, { status: 202 })
    }))
    await openDrawer('100 - web-01')
    await userEvent.click(await screen.findByRole('button', { name: 'Re-seed' }))
    const confirmation = screen.getAllByRole('dialog').at(-1)!
    await userEvent.click(within(confirmation).getByRole('button', { name: 'Re-seed' }))
    expect(await screen.findByText('Full replication queued.')).toBeInTheDocument()
  }

  it('leaves the button disabled when the poll still reports reseed_required', async () => {
    stubDrawerFetch(reseedRequired)
    const requests: unknown[] = []
    const { rerender } = renderWithProviders(<Harness jobs={[job()]} />)
    await queueAReseed(requests)

    // The poll lands and the orchestrator has not moved the row yet.
    rerender(<Harness jobs={[job()]} />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Re-seed' })).toBeDisabled())
    expect(screen.getByText('Full replication queued.')).toBeInTheDocument()
    expect(requests).toHaveLength(1)
  })

  it('lifts the lock once the orchestrator takes the guest', async () => {
    stubDrawerFetch(reseedRequired)
    const requests: unknown[] = []
    const { rerender } = renderWithProviders(<Harness jobs={[job()]} />)
    await queueAReseed(requests)

    stubDrawerFetch([{ ...reseedRequired[0], status: 'syncing', last_error: '' }])
    rerender(<Harness jobs={[job()]} />)

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Re-seed' })).not.toBeInTheDocument())
  })

})
