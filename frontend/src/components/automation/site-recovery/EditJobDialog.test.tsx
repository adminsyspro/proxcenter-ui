/**
 * Component tests for EditJobDialog's rate-limit field (discussion #634).
 *
 * The rate limit used to be coerced with `Math.max(0, Number(v) || 0)` inside
 * onChange, so the field could never be emptied. It is now buffered, with the
 * lower bound applied on blur, and the value it submits must follow what the
 * user actually typed.
 *
 * The dialog takes the job as a prop; its one network call is the guest picker,
 * which asks the source cluster which guests its storage can replicate. That
 * endpoint is stubbed per test so a row's state (offered, blocked, held by
 * another job) is the endpoint's answer rather than a fixture.
 */

import type { ComponentProps } from 'react'
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, userEvent, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { ReplicableVM, ReplicationJob } from '@/lib/orchestrator/site-recovery.types'

import EditJobDialog from './EditJobDialog'

/** What /api/v1/connections/{cluster}/replicable-vms answers for the next render. */
let replicable: Array<Partial<ReplicableVM> & { vmid: number }> = []

beforeEach(() => {
  replicable = []
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    JSON.stringify(replicable.map(vm => ({ node: 'pve1', diskGb: 20, mixed: false, unsupported: false, ...vm }))),
    { status: 200 },
  )))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

type Inventory = NonNullable<ComponentProps<typeof EditJobDialog>['allVMs']>

/** One source-cluster guest as the inventory hands it to the dialog. */
const guest = (vmid: number, name: string, extra: Partial<Inventory[number]> = {}): Inventory[number] =>
  ({ vmid, name, connId: 'src', type: 'qemu', tags: [], ...extra })

function renderDialog(
  overrides: Partial<ReplicationJob> = {},
  inventory: { allVMs?: Inventory; jobs?: ReplicationJob[]; open?: boolean } = {},
) {
  const onSubmit = vi.fn().mockResolvedValue(undefined)

  renderWithProviders(
    // renderWithProviders turns revalidateOnMount off so an idle render never
    // reaches the network; the guest picker only fills once that fetch
    // resolves, so turn it back on for this render — nested SWRConfig merges.
    // shouldRetryOnError stays off so a failing endpoint settles at once.
    <SWRConfig value={{ revalidateOnMount: true, shouldRetryOnError: false }}>
      <EditJobDialog
        open={inventory.open ?? true}
        job={job(overrides)}
        onClose={vi.fn()}
        onSubmit={onSubmit}
        connections={[]}
        allVMs={inventory.allVMs}
        jobs={inventory.jobs}
      />
    </SWRConfig>,
  )

  return { onSubmit }
}

/**
 * The form is split across tabs (General, Schedule, Retention), so a test
 * reaching a field opens its tab first, exactly as an operator would.
 */
async function openTab(name: RegExp) {
  await userEvent.click(screen.getByRole('tab', { name }))
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
  it('shows the job rate limit', async () => {
    renderDialog()
    await openTab(/schedule/i)
    expect(rateLimit().value).toBe('200')
  })

  it('lets the rate limit be cleared without snapping back to 0', async () => {
    renderDialog()
    await openTab(/schedule/i)
    await userEvent.clear(rateLimit())
    expect(rateLimit().value).toBe('')
  })

  it('submits the retyped rate limit, not the old digit glued in front', async () => {
    const { onSubmit } = renderDialog()

    await openTab(/schedule/i)
    await userEvent.clear(rateLimit())
    await userEvent.type(rateLimit(), '50')
    expect(rateLimit().value).toBe('50')

    await userEvent.click(save())
    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ rate_limit_mbps: 50 }))
  })

  it('commits the fallback of 0 when the rate limit is left empty', async () => {
    const { onSubmit } = renderDialog()

    await openTab(/schedule/i)
    await userEvent.clear(rateLimit())
    await userEvent.click(save())
    expect(rateLimit().value).toBe('0')
    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ rate_limit_mbps: 0 }))
  })
})

describe('EditJobDialog snapshot retention (issue #664)', () => {
  it('prefills 3 when the job has no retention fields (old backend)', async () => {
    renderDialog({ snapshot_keep_source: undefined, snapshot_keep_target: undefined })
    await openTab(/retention/i)
    expect(retentionSource().value).toBe('3')
    expect(retentionTarget().value).toBe('3')
  })

  it('prefills the job effective retention values when present', async () => {
    renderDialog({ snapshot_keep_source: 5, snapshot_keep_target: 10 })
    await openTab(/retention/i)
    expect(retentionSource().value).toBe('5')
    expect(retentionTarget().value).toBe('10')
  })

  it('submits edited retention values', async () => {
    const { onSubmit } = renderDialog({ snapshot_keep_source: 3, snapshot_keep_target: 3 })

    await openTab(/retention/i)

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

    await openTab(/retention/i)

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

    await openTab(/retention/i)

    await userEvent.type(screen.getByLabelText('Prefix'), '-DR')

    expect(await screen.findByText(/must not start or end on a hyphen/)).toBeInTheDocument()
    expect(save()).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('can clear an affix back to the source name', async () => {
    const { onSubmit } = renderDialog({ vm_name_suffix: '-DR' })

    await openTab(/retention/i)

    await userEvent.clear(screen.getByLabelText('Suffix'))
    await userEvent.click(save())

    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ vm_name_suffix: '' }))
  })
})

// The guests a job carries used to be frozen at creation: taking one out meant
// deleting the job. The General tab now owns a picker, and what it offers is
// the source cluster's inventory crossed with the storage's own answer about
// which of those guests it can actually replicate.
describe('EditJobDialog guest picker', () => {
  const searchBox = () => screen.getByPlaceholderText('Search a guest')
  const noGuest = 'No guest of this source cluster has a disk this job can replicate'

  it('offers the guests this storage can replicate, plus the ones the job already carries', async () => {
    replicable = [{ vmid: 100 }, { vmid: 101 }, { vmid: 103 }]

    renderDialog({ vm_ids: [100] }, {
      allVMs: [
        guest(100, 'web-01'),
        guest(101, 'db-01'),
        guest(102, 'app-01'),
        guest(103, ''),
        guest(900, 'ct-01', { type: 'lxc' }),
        guest(300, 'remote-01', { connId: 'dst' }),
      ],
    })

    expect(await screen.findByRole('checkbox', { name: 'web-01' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'db-01' })).not.toBeChecked()
    // Nameless guests still have to be tellable apart, so they fall back to their VMID.
    expect(screen.getByRole('checkbox', { name: 'VM 103' })).toBeInTheDocument()
    // Not replicable, a container, or on another cluster: none of them belong here.
    expect(screen.queryByRole('checkbox', { name: 'app-01' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'ct-01' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'remote-01' })).not.toBeInTheDocument()
  })

  it('locks a guest another job of the same source cluster already replicates, naming that job', async () => {
    replicable = [{ vmid: 100 }, { vmid: 101 }, { vmid: 102 }]

    const { onSubmit } = renderDialog({ vm_ids: [100] }, {
      allVMs: [guest(100, 'web-01'), guest(101, 'db-01'), guest(102, 'app-01')],
      jobs: [
        job({ vm_ids: [100] }),                                                 // the job being edited: never holds against itself
        job({ id: 'job-2', name: 'weekly', vm_ids: [101] }),                    // same source cluster: holds 101
        job({ id: 'job-3', name: 'elsewhere', source_cluster: 'dst', vm_ids: [100] }), // another cluster: irrelevant
        job({ id: 'job-4', name: '', vm_ids: [102] }),                          // unnamed job: falls back to its id
        job({ id: 'job-5', name: 'empty', vm_ids: undefined as unknown as number[] }),
      ],
    })

    expect(await screen.findByRole('checkbox', { name: 'db-01' })).toBeDisabled()
    expect(screen.getByText('replicated by weekly')).toBeInTheDocument()
    expect(screen.getByText('replicated by job-4')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'web-01' })).not.toBeDisabled()

    await userEvent.click(screen.getByText('db-01'))
    expect(screen.getByRole('checkbox', { name: 'db-01' })).not.toBeChecked()

    await userEvent.click(save())
    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ vm_ids: [100] }))
  })

  it('still lists a guest the job carries whose disk left the storage, and lets it be dropped', async () => {
    replicable = [{ vmid: 100 }]

    const { onSubmit } = renderDialog({ vm_ids: [100, 102] }, {
      allVMs: [guest(100, 'web-01'), guest(102, 'app-01')],
    })

    expect(await screen.findByRole('checkbox', { name: 'app-01' })).toBeChecked()
    expect(screen.getByText('no Ceph RBD disk')).toBeInTheDocument()

    await userEvent.click(screen.getByText('app-01'))

    // Dropped, it is no longer replicable either, so it leaves the list for good.
    expect(screen.queryByRole('checkbox', { name: 'app-01' })).not.toBeInTheDocument()

    await userEvent.click(save())
    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ vm_ids: [100] }))
  })

  it('refuses a guest whose disk format the engine cannot read, or that straddles a ZFS pool', async () => {
    replicable = [{ vmid: 100 }, { vmid: 101, unsupported: true }, { vmid: 102, mixed: true }]

    renderDialog({ storage_engine: 'zfs', target_pool: 'local-zfs', target_node: 'dr1', vm_ids: [] }, {
      allVMs: [guest(100, 'web-01'), guest(101, 'db-01'), guest(102, 'app-01')],
    })

    expect(await screen.findByRole('checkbox', { name: 'db-01' })).toBeDisabled()
    expect(screen.getByText('unsupported disk')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'app-01' })).toBeDisabled()
    expect(screen.getByText('disks outside ZFS')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'web-01' })).not.toBeDisabled()
  })

  it('accepts a guest with disks on several storages when the job replicates RBD', async () => {
    replicable = [{ vmid: 102, mixed: true }]

    renderDialog({ vm_ids: [] }, { allVMs: [guest(102, 'app-01')] })

    expect(await screen.findByRole('checkbox', { name: 'app-01' })).not.toBeDisabled()
    expect(screen.queryByText(/disks outside/)).not.toBeInTheDocument()
  })

  it('narrows the guest list on a name, on a VMID, and says so when nothing matches', async () => {
    replicable = [{ vmid: 100 }, { vmid: 101 }, { vmid: 102 }]

    renderDialog({ vm_ids: [] }, {
      allVMs: [guest(100, 'web-01'), guest(101, 'db-01'), guest(102, 'app-01')],
    })

    await screen.findByRole('checkbox', { name: 'web-01' })

    await userEvent.type(searchBox(), 'db')
    expect(screen.getByRole('checkbox', { name: 'db-01' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'web-01' })).not.toBeInTheDocument()

    await userEvent.clear(searchBox())
    await userEvent.type(searchBox(), '102')
    expect(screen.getByRole('checkbox', { name: 'app-01' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'db-01' })).not.toBeInTheDocument()

    await userEvent.clear(searchBox())
    await userEvent.type(searchBox(), 'nothing-like-this')
    expect(screen.getByText(noGuest)).toBeInTheDocument()
  })

  it('adds and removes guests on a row click and saves the VMID list that results', async () => {
    replicable = [{ vmid: 100 }, { vmid: 101 }]

    const { onSubmit } = renderDialog({ vm_ids: [100] }, {
      allVMs: [guest(100, 'web-01'), guest(101, 'db-01')],
    })

    await userEvent.click(await screen.findByText('db-01'))
    expect(screen.getByRole('checkbox', { name: 'db-01' })).toBeChecked()

    await userEvent.click(screen.getByText('web-01'))
    expect(screen.getByRole('checkbox', { name: 'web-01' })).not.toBeChecked()

    await userEvent.click(save())
    expect(onSubmit).toHaveBeenCalledWith('job-1', expect.objectContaining({ vm_ids: [101] }))
    expect(onSubmit.mock.calls[0][1]).not.toHaveProperty('tags')
  })

  it('asks the cluster nothing while the dialog is closed', () => {
    replicable = [{ vmid: 100 }]

    renderDialog({}, { open: false, allVMs: [guest(100, 'web-01')] })

    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled()
    expect(screen.queryByRole('checkbox', { name: 'web-01' })).not.toBeInTheDocument()
  })

  it('treats a job saved before guests, tags and engine were stored as an empty Ceph RBD job', async () => {
    replicable = [{ vmid: 100 }]

    renderDialog({
      vm_ids: undefined as unknown as number[],
      tags: undefined as unknown as string[],
      storage_engine: undefined as unknown as ReplicationJob['storage_engine'],
    }, { allVMs: [guest(100, 'web-01')] })

    // No tags stored means the job picks its guests one by one, not by tag.
    expect(screen.getByPlaceholderText('Search a guest')).toBeInTheDocument()
    expect(await screen.findByRole('checkbox', { name: 'web-01' })).not.toBeChecked()
    expect(screen.getByRole('img', { name: 'Ceph RBD' })).toBeInTheDocument()
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith('/api/v1/connections/src/replicable-vms?engine=rbd')
  })

  it('shows an empty picker rather than a stale list when the source cluster cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))

    renderDialog({ vm_ids: [] }, { allVMs: [guest(100, 'web-01')] })

    expect(await screen.findByText(noGuest)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'web-01' })).not.toBeInTheDocument()
  })
})

// A job whose guests are resolved from tags edits its tags, not a guest list:
// the membership is recomputed at every run, so a picker would lie.
describe('EditJobDialog tag-based job', () => {
  const inventory = [
    guest(100, 'web-01', { tags: ['prod', 'web'] }),
    guest(101, 'db-01', { tags: ['db', 'legacy'] }),
    guest(102, 'cache-01', { tags: undefined as unknown as string[] }),
    guest(300, 'remote-01', { connId: 'dst', tags: ['elsewhere'] }),
  ]

  const deleteChip = (label: string) => {
    const chip = screen.getByText(label).closest('.MuiChip-root') as HTMLElement

    fireEvent.click(chip.querySelector('.MuiChip-deleteIcon') as HTMLElement)
  }

  it('edits the tags that select the guests and saves them instead of a VMID list', async () => {
    const { onSubmit } = renderDialog({ tags: ['prod', 'db'], vm_ids: [100] }, { allVMs: inventory })

    expect(screen.getByText('Tags selecting the guests')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Search a guest')).not.toBeInTheDocument()
    expect(screen.getByText('prod')).toBeInTheDocument()
    expect(screen.getByText('db')).toBeInTheDocument()

    deleteChip('prod')
    expect(screen.queryByText('prod')).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByRole('combobox'))
    // Only tags seen on this source cluster, and none already carried.
    expect(await screen.findByRole('option', { name: 'prod' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'db' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'elsewhere' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'web' }))

    expect(await screen.findByText('web')).toBeInTheDocument()

    await userEvent.click(save())

    const update = onSubmit.mock.calls[0][1]

    expect(update.tags).toEqual(['db', 'web'])
    expect(update).not.toHaveProperty('vm_ids')
  })

  it('warns that a job left without a tag would replicate nothing', async () => {
    renderDialog({ tags: ['prod'], vm_ids: [] }, { allVMs: inventory })

    deleteChip('prod')

    expect(await screen.findByText('No tag: this job would replicate nothing.')).toBeInTheDocument()
  })
})
