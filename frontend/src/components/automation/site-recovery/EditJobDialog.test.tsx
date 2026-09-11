/**
 * Component tests for EditJobDialog's rate-limit field (discussion #634).
 *
 * The rate limit used to be coerced with `Math.max(0, Number(v) || 0)` inside
 * onChange, so the field could never be emptied. It is now buffered, with the
 * lower bound applied on blur, and the value it submits must follow what the
 * user actually typed.
 *
 * The dialog renders standalone: it takes the job as a prop and its only child
 * that talks to the network (none) means no fixtures are needed.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import type { ReplicationJob } from '@/lib/orchestrator/site-recovery.types'

import EditJobDialog from './EditJobDialog'

afterEach(cleanup)

function job(overrides: Partial<ReplicationJob> = {}): ReplicationJob {
  return {
    storage_engine: 'rbd',
    id: 'job-1',
    name: 'nightly',
    vm_ids: [100],
    vm_names: ['web-01'],
    tags: [],
    source_cluster: 'src',
    target_cluster: 'dst',
    target_pool: 'rbd',
    vmid_prefix: 0,
    status: 'idle' as ReplicationJob['status'],
    schedule: '',
    schedule_spec: null,
    timezone: 'UTC',
    rpo_target: 900,
    retry_count: 0,
    throughput_bps: 0,
    rate_limit_mbps: 200,
    bandwidth_windows: [],
    network_mapping: {},
    progress_percent: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function renderDialog(overrides: Partial<ReplicationJob> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)

  renderWithProviders(
    <EditJobDialog open job={job(overrides)} onClose={vi.fn()} onSubmit={onSubmit} connections={[]} />,
  )

  return { onSubmit }
}

// The rate limit is the only spinbutton on the dialog while no bandwidth
// window exists, so role alone identifies it.
const rateLimit = () => screen.getAllByRole('spinbutton')[0] as HTMLInputElement
const save = () => screen.getByRole('button', { name: 'Save changes' })
// getByRole('spinbutton'): the sliders now carry the same accessible name, so
// getByLabelText would match two elements per retention setting.
const retentionSource = () => screen.getByRole('spinbutton', { name: 'Keep on source' }) as HTMLInputElement
const retentionTarget = () => screen.getByRole('spinbutton', { name: 'Keep on target (DR)' }) as HTMLInputElement

describe('EditJobDialog rate limit', () => {
  it('shows the job rate limit', () => {
    renderDialog()
    expect(rateLimit().value).toBe('200')
  })

  it('lets the rate limit be cleared without snapping back to 0', async () => {
    renderDialog()
    await userEvent.clear(rateLimit())
    expect(rateLimit().value).toBe('')
  })

  it('submits the retyped rate limit, not the old digit glued in front', async () => {
    const { onSubmit } = renderDialog()

    await userEvent.clear(rateLimit())
    await userEvent.type(rateLimit(), '50')
    expect(rateLimit().value).toBe('50')

    await userEvent.click(save())
    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ rate_limit_mbps: 50 }))
  })

  it('commits the fallback of 0 when the rate limit is left empty', async () => {
    const { onSubmit } = renderDialog()

    await userEvent.clear(rateLimit())
    await userEvent.click(save())
    expect(rateLimit().value).toBe('0')
    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ rate_limit_mbps: 0 }))
  })
})

describe('EditJobDialog snapshot retention (issue #664)', () => {
  it('prefills 3 when the job has no retention fields (old backend)', () => {
    renderDialog({ snapshot_keep_source: undefined, snapshot_keep_target: undefined })
    expect(retentionSource().value).toBe('3')
    expect(retentionTarget().value).toBe('3')
  })

  it('prefills the job effective retention values when present', () => {
    renderDialog({ snapshot_keep_source: 5, snapshot_keep_target: 10 })
    expect(retentionSource().value).toBe('5')
    expect(retentionTarget().value).toBe('10')
  })

  it('submits edited retention values', async () => {
    const { onSubmit } = renderDialog({ snapshot_keep_source: 3, snapshot_keep_target: 3 })

    await userEvent.clear(retentionSource())
    await userEvent.type(retentionSource(), '7')
    await userEvent.clear(retentionTarget())
    await userEvent.type(retentionTarget(), '20')

    await userEvent.click(save())

    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({
      snapshot_keep_source: 7,
      snapshot_keep_target: 20,
    }))
  })
})

it('shows engine, storage and node as immutable information and excludes them from updates', async () => {
  const { onSubmit } = renderDialog({ storage_engine: 'zfs', target_pool: 'local-zfs', target_node: 'dr1' })
  expect(screen.getByRole('img', { name: 'ZFS' })).toBeInTheDocument()
  expect(screen.getByText('local-zfs')).toBeInTheDocument()
  expect(screen.getByText(/dr1/)).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Target storage' })).not.toBeInTheDocument()
  await userEvent.click(save())
  const update = onSubmit.mock.calls[0][1]
  expect(update).not.toHaveProperty('storage_engine')
  expect(update).not.toHaveProperty('target_pool')
  expect(update).not.toHaveProperty('target_node')
})

// #915: a job created before the feature must be able to name its replicas
// without being deleted and re-seeded, so unlike the VMID prefix the affixes
// are editable — the replica's config is rewritten from the source every sync.
describe('EditJobDialog replica name (issue #915)', () => {
  it('loads the job affixes and submits the edited ones', async () => {
    const { onSubmit } = renderDialog({ vm_name_prefix: '', vm_name_suffix: '-DR' })

    expect((screen.getByLabelText('Suffix') as HTMLInputElement).value).toBe('-DR')

    await userEvent.type(screen.getByLabelText('Prefix'), 'DR-')
    expect(await screen.findByText('DR-web-01-DR')).toBeInTheDocument()

    await userEvent.click(save())

    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({
      vm_name_prefix: 'DR-',
      vm_name_suffix: '-DR',
    }))
  })

  it('refuses to save an affix PVE would reject on the replica', async () => {
    const { onSubmit } = renderDialog()

    await userEvent.type(screen.getByLabelText('Prefix'), '-DR')

    expect(await screen.findByText(/must not start or end on a hyphen/)).toBeInTheDocument()
    expect(save()).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('can clear an affix back to the source name', async () => {
    const { onSubmit } = renderDialog({ vm_name_suffix: '-DR' })

    await userEvent.clear(screen.getByLabelText('Suffix'))
    await userEvent.click(save())

    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ vm_name_suffix: '' }))
  })
})
