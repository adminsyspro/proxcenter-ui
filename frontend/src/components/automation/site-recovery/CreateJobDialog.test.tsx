/**
 * Component tests for CreateJobDialog's VMID-prefix field (discussion #634).
 *
 * The field is a sentinel-blank one: 0 means "no prefix" and must display as an
 * empty box. It used to do that with `value={vmidPrefix || ''}` on the way in
 * plus `Number(v) || 0` on the way out — a round trip that made the box
 * impossible to correct, since the JSX rewrote whatever the parent recomputed.
 * The blank now comes from `format`, so the buffer is the user's to edit.
 *
 * The dialog is rendered with no connections and no VMs: every fetch it owns is
 * keyed off a selected cluster, so nothing hits the network here.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'
import type { ComponentProps } from 'react'

import { renderWithProviders, screen, userEvent, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import CreateJobDialog from './CreateJobDialog'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderDialog() {
  renderWithProviders(
    <CreateJobDialog open onClose={vi.fn()} onSubmit={vi.fn()} connections={[]} allVMs={[]} />,
  )
}

function renderDialogWithVMs(allVMs: ComponentProps<typeof CreateJobDialog>['allVMs']) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/v1/connections/src/replicable-vms?engine=rbd') {
      return new Response(JSON.stringify(allVMs.map(vm => ({ vmid: vm.vmid, diskGb: vm.diskGb }))), { status: 200 })
    }

    return new Response('{}', { status: 200 })
  }))

  renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true }}>
      <CreateJobDialog
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        connections={[{ id: 'src', name: 'Source', hasCeph: true, engines: ['rbd'] }]}
        allVMs={allVMs}
      />
    </SWRConfig>,
  )
}

async function selectSourceCluster() {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
  await userEvent.click(await screen.findByRole('option', { name: 'Source' }))
}

// No bandwidth window and no cluster selected, so the numeric inputs are, in
// DOM order: retention-source, retention-target, VMID prefix.
const prefix = () => screen.getAllByRole('spinbutton').at(-1) as HTMLInputElement
const blur = () => userEvent.click(screen.getByText('VMID Prefix'))
// getByRole('spinbutton'): the sliders now carry the same accessible name, so
// getByLabelText would match two elements per retention setting.
const retentionSource = () => screen.getByRole('spinbutton', { name: 'Keep on source' }) as HTMLInputElement
const retentionTarget = () => screen.getByRole('spinbutton', { name: 'Keep on target (DR)' }) as HTMLInputElement

describe('CreateJobDialog VMID prefix', () => {
  it('renders blank rather than 0 when no prefix is set', () => {
    renderDialog()
    expect(prefix().value).toBe('')
  })

  it('accepts a typed prefix', async () => {
    renderDialog()
    await userEvent.type(prefix(), '9')
    expect(prefix().value).toBe('9')
  })

  it('can be corrected without gluing the old digit in front', async () => {
    renderDialog()
    await userEvent.type(prefix(), '9')
    await userEvent.clear(prefix())
    expect(prefix().value).toBe('')
    await userEvent.type(prefix(), '12')
    expect(prefix().value).toBe('12')
  })

  it('falls back to blank (0) when left empty', async () => {
    renderDialog()
    await userEvent.type(prefix(), '9')
    await userEvent.clear(prefix())
    await blur()
    expect(prefix().value).toBe('')
  })
})

// The full create flow: every fetch the dialog owns, the four selections the
// Create button waits on, and the payload it finally submits. Shared so a test
// about one field does not carry a copy of the whole wiring.
function stubCreateFlowFetches() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/connections/src/replicable-vms?engine=rbd') {
      return new Response(JSON.stringify([{ vmid: 100, diskGb: 10 }]), { status: 200 })
    }
    if (url === '/api/v1/orchestrator/replication/check-ssh' && init?.method === 'POST') {
      return new Response(
        JSON.stringify({ connected: true, source_node: 'node1', target_ip: '10.0.0.1' }),
        { status: 200 },
      )
    }
    if (url === '/api/v1/connections/dst/ceph') {
      return new Response(
        JSON.stringify({
          data: { pools: { list: [{ name: 'rbd', percentUsed: 0.1, bytesUsed: 100, maxAvail: 900, bytesUsedFormatted: '100 MB', maxAvailFormatted: '900 MB' }] } },
        }),
        { status: 200 },
      )
    }
    if (url === '/api/v1/orchestrator/replication/preflight' && init?.method === 'POST') {
      return new Response(JSON.stringify({ checks: [], can_create: true }), { status: 200 })
    }

    return new Response('{}', { status: 200 })
  }))
}

function renderCreateFlow(onSubmit: () => void) {
  stubCreateFlowFetches()
  renderWithProviders(
    // renderWithProviders's own SWRConfig sets revalidateOnMount:false (to
    // keep other tests from triggering background fetches); this dialog's
    // VM list depends on a real SWR fetch resolving, so override it back
    // on for this one render — SWRConfig context merges when nested.
    <SWRConfig value={{ revalidateOnMount: true }}>
      <CreateJobDialog
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        connections={[
          { id: 'src', name: 'Source', hasCeph: true, engines: ['rbd'] },
          { id: 'dst', name: 'Target', hasCeph: true, engines: ['rbd'] },
        ]}
        allVMs={[{ vmid: 100, name: 'web-01', node: 'node1', connId: 'src', type: 'qemu', status: 'running', tags: [], diskGb: 10 }]}
      />
    </SWRConfig>,
  )
}

async function fillCreateFlow() {
  // Source cluster
  fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
  await userEvent.click(await screen.findByRole('option', { name: 'Source' }))

  // Select the only VM (its replicable-vms entry must resolve first)
  await userEvent.click(await screen.findByRole('checkbox', { name: /web-01/ }))

  // Target cluster
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1])
  await userEvent.click(await screen.findByRole('option', { name: 'Target' }))

  // Target pool (Select enables once the Ceph pools fetch resolves)
  await waitFor(() => expect(screen.getAllByRole('combobox')[2]).not.toHaveAttribute('aria-disabled', 'true'))
  fireEvent.mouseDown(screen.getAllByRole('combobox')[2])
  await userEvent.click(await screen.findByRole('option', { name: /rbd/ }))
}

describe('CreateJobDialog snapshot retention (issue #664)', () => {
  it('shows the default retention of 3 on both source and target', () => {
    renderDialog()
    expect(retentionSource().value).toBe('3')
    expect(retentionTarget().value).toBe('3')
  })

  it('includes snapshot_keep_source/target in the submitted payload', async () => {
    const onSubmit = vi.fn()
    renderCreateFlow(onSubmit)
    await fillCreateFlow()

    // The Create button only enables once the SSH check succeeds
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Job' })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: 'Create Job' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      snapshot_keep_source: 3,
      snapshot_keep_target: 3,
    }))
  })
})

// #915: production and DR carried the same name, so the wrong VM got started.
describe('CreateJobDialog replica name (issue #915)', () => {
  it('previews the rename on a VM the user actually picked, and submits the affixes', async () => {
    const onSubmit = vi.fn()
    renderCreateFlow(onSubmit)
    await fillCreateFlow()

    await userEvent.type(screen.getByLabelText('Prefix'), 'DR-')
    await userEvent.type(screen.getByLabelText('Suffix'), '-2')
    expect(await screen.findByText('DR-web-01-2')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Job' })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: 'Create Job' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      vm_name_prefix: 'DR-',
      vm_name_suffix: '-2',
    }))
  })

  it('omits the affixes entirely when both are left empty', async () => {
    const onSubmit = vi.fn()
    renderCreateFlow(onSubmit)
    await fillCreateFlow()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Job' })).not.toBeDisabled())
    await userEvent.click(screen.getByRole('button', { name: 'Create Job' }))

    const payload = onSubmit.mock.calls[0][0]

    expect(payload.vm_name_prefix).toBeUndefined()
    expect(payload.vm_name_suffix).toBeUndefined()
  })

  // The replica's config is written straight into the target's /etc/pve, so an
  // affix PVE would refuse must never reach the orchestrator.
  it('blocks creation on an affix that is not a DNS name fragment', async () => {
    const onSubmit = vi.fn()
    renderCreateFlow(onSubmit)
    await fillCreateFlow()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Job' })).not.toBeDisabled())

    await userEvent.type(screen.getByLabelText('Suffix'), '_DR')

    expect(await screen.findByText(/must not start or end on a hyphen/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Job' })).toBeDisabled()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('CreateJobDialog stopped VM replication (issue #687)', () => {
  it('lists and allows selecting a stopped qemu VM on Ceph storage', async () => {
    renderDialogWithVMs([
      { vmid: 200, name: 'stopped-db', node: 'node1', connId: 'src', type: 'qemu', status: 'stopped', tags: [], diskGb: 20 },
    ])

    await selectSourceCluster()

    const stoppedVM = await screen.findByRole('checkbox', { name: /stopped-db.*200/ })
    expect(stoppedVM).not.toBeChecked()

    await userEvent.click(stoppedVM)

    expect(stoppedVM).toBeChecked()
  })

  it('offers tags belonging to a stopped VM in tag selection mode', async () => {
    renderDialogWithVMs([
      { vmid: 201, name: 'stopped-app', node: 'node1', connId: 'src', type: 'qemu', status: 'stopped', tags: ['disaster-recovery'], diskGb: 15 },
    ])

    await selectSourceCluster()
    await userEvent.click(screen.getByRole('button', { name: 'Tags' }))

    expect(await screen.findByRole('checkbox', { name: /disaster-recovery/ })).toBeInTheDocument()
  })
})

const engineConnections: ComponentProps<typeof CreateJobDialog>['connections'] = [
  { id: 'src', name: 'Source', hasCeph: true, engines: ['rbd', 'zfs'] },
  { id: 'dst', name: 'Target', hasCeph: false, engines: ['rbd', 'zfs'] },
  { id: 'ceph-only', name: 'Ceph only', hasCeph: true, engines: ['rbd'] },
]
const engineVMs = [100, 101, 102, 103].map(vmid => ({ vmid, name: `guest-${vmid}`, node: vmid === 103 ? 'pve2' : 'pve1', connId: 'src', type: 'qemu', status: 'running', tags: ['db'], diskGb: 10 }))

function engineHarness(engines: ComponentProps<typeof CreateJobDialog>['engines'] = ['rbd', 'zfs']) {
  const onSubmit = vi.fn()
  const fetchMock = vi.fn(async (url: string) => {
    let body: unknown = {}
    if (url.includes('/replicable-vms?engine=')) body = engineVMs.map(vm => ({ vmid: vm.vmid, node: vm.node, diskGb: 10, mixed: vm.vmid === 101, unsupported: vm.vmid === 102 }))
    if (url.endsWith('/replication-storages')) body = { engines: ['zfs'], rbd: [], zfs: ['dr1', 'dr2', 'offline'].map(node => ({ storage: 'local-zfs', node, pool: 'rpool/data', availBytes: 512, totalBytes: 1024, availFormatted: '512 B', active: node !== 'offline' })) }
    if (url.endsWith('/ceph')) body = { data: { pools: { list: [{ name: 'rbd', percentUsed: 0.5, bytesUsed: 512, maxAvail: 512 }] } } }
    if (url.endsWith('/check-ssh')) body = { connected: true, source_node: 'pve1', target_ip: '10.0.0.1', checks: [{ source_node: 'pve1', target_node: 'dr1', ok: true }, { source_node: 'pve2', target_node: 'dr1', ok: true }] }
    if (url.endsWith('/preflight')) body = { can_create: true, checks: [{ id: 'target_storage', status: 'ok' }, { id: 'reverse_ssh', status: 'warn', message: 'Reverse key is missing' }] }
    return new Response(JSON.stringify(body))
  })
  vi.stubGlobal('fetch', fetchMock)
  const view = renderWithProviders(<SWRConfig value={{ revalidateOnMount: true }}>
    <CreateJobDialog open onClose={vi.fn()} onSubmit={onSubmit} engines={engines} connections={engineConnections} allVMs={engineVMs} />
  </SWRConfig>)
  return { ...view, onSubmit, fetchMock }
}

async function chooseEngineSource(engine: 'rbd' | 'zfs') {
  if (engine === 'zfs') await userEvent.click(screen.getByRole('button', { name: /ZFS/ }))
  await selectSourceCluster()
  await screen.findByRole('checkbox', { name: /guest-100/ })
}

async function chooseTarget(node = 'dr1') {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1])
  await userEvent.click(await screen.findByRole('option', { name: 'Target' }))
  const storage = screen.getByRole('combobox', { name: 'Target storage' })
  await waitFor(() => expect(storage).not.toHaveAttribute('aria-disabled', 'true'))
  fireEvent.mouseDown(storage)
  expect(await screen.findByRole('option', { name: /offline/ })).toHaveAttribute('aria-disabled', 'true')
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(node) }))
}

describe('CreateJobDialog storage engines', () => {
  it('disables ZFS when the orchestrator does not advertise it', () => {
    engineHarness(['rbd'])
    expect(screen.getByRole('button', { name: /ZFS/ })).toBeDisabled()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })

  it('resets clusters, VM selection and storage when the engine changes and filters connections', async () => {
    engineHarness()
    await chooseEngineSource('rbd')
    await userEvent.click(screen.getByRole('checkbox', { name: /guest-100/ }))
    await userEvent.click(screen.getByRole('button', { name: /ZFS/ }))
    expect(screen.queryByRole('checkbox', { name: /guest-100/ })).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0])
    expect(screen.queryByRole('option', { name: 'Ceph only' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('option', { name: 'Source' }))
    expect(await screen.findByRole('checkbox', { name: /guest-100/ })).not.toBeChecked()
    expect(screen.getByRole('combobox', { name: 'Target storage' })).toHaveAttribute('aria-disabled', 'true')
  })

  it.each(['rbd', 'zfs'] as const)('applies mixed and unsupported disk rules for %s', async engine => {
    engineHarness()
    await chooseEngineSource(engine)
    expect(screen.getByRole('checkbox', { name: /guest-102/ })).toBeDisabled()
    const mixed = screen.getByRole('checkbox', { name: /guest-101/ })
    if (engine === 'zfs') expect(mixed).toBeDisabled()
    else {
      expect(mixed).toBeEnabled()
      await userEvent.click(mixed)
      expect(mixed).toBeChecked()
      expect(screen.getByLabelText(/Only Ceph RBD disks will be replicated/)).toBeInTheDocument()
    }
  })

  it('sends ZFS storage/node and VM identity, lists SSH pairs and allows reverse-SSH warnings', async () => {
    const { onSubmit, fetchMock } = engineHarness()
    await chooseEngineSource('zfs')
    await userEvent.click(screen.getByRole('checkbox', { name: /guest-100/ }))
    await chooseTarget()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create Job' })).toBeEnabled())
    expect(screen.getByText('pve1 → dr1')).toBeInTheDocument()
    expect(screen.getByText('pve2 → dr1')).toBeInTheDocument()
    expect(screen.getByText('Reverse key is missing')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/replicable-vms?engine=zfs'))
    await userEvent.click(screen.getByRole('button', { name: 'Create Job' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ storage_engine: 'zfs', target_node: 'dr1', target_pool: 'local-zfs', vm_ids: [100] }))
  })

  it('reruns both checks when VM selection, node or tags change, even at the same disk size', async () => {
    const { fetchMock } = engineHarness()
    await chooseEngineSource('zfs')
    await userEvent.click(screen.getByRole('checkbox', { name: /guest-100/ }))
    await chooseTarget()
    const requests = (endpoint: string) => fetchMock.mock.calls.filter(call => call[0].endsWith(endpoint))
    await waitFor(() => expect(requests('/preflight')).toHaveLength(1))
    await userEvent.click(screen.getByRole('checkbox', { name: /guest-100/ }))
    expect(screen.getByRole('button', { name: 'Create Job' })).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /guest-103/ }))
    await waitFor(() => expect(requests('/preflight')).toHaveLength(2))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target storage' }))
    await userEvent.click(screen.getByRole('option', { name: /dr2/ }))
    await waitFor(() => expect(requests('/check-ssh')).toHaveLength(3))
    await userEvent.click(screen.getByRole('button', { name: /Tags/ }))
    await userEvent.click(await screen.findByRole('checkbox', { name: /db/ }))
    await waitFor(() => expect(requests('/preflight')).toHaveLength(4))
    const latest = vi.mocked(fetch).mock.calls.filter(call => String(call[0]).endsWith('/preflight')).at(-1)
    expect(JSON.parse(String(latest?.[1]?.body))).toMatchObject({ storage_engine: 'zfs', target_node: 'dr2', vm_ids: [], tags: ['db'] })
  })

  it('keeps creation disabled after preflight fails', async () => {
    const { fetchMock } = engineHarness()
    const implementation = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async url => url.endsWith('/preflight') ? new Response('{}', { status: 500 }) : implementation(url))
    await chooseEngineSource('zfs')
    await userEvent.click(screen.getByRole('checkbox', { name: /guest-100/ }))
    await chooseTarget()
    await screen.findByText('Direct SSH connection failed')
    expect(screen.getByRole('button', { name: 'Create Job' })).toBeDisabled()
  })
})

describe('CreateJobDialog SSH check against a replication network (issue #870)', () => {
  // The orchestrator refuses a target connection whose replication network
  // matches no address of the DR node. That is a settings problem, not a
  // missing SSH key, so the alert must not send the operator to fix SSH.
  it('points at the connection setting rather than at passwordless SSH', async () => {
    const { fetchMock } = engineHarness()
    const implementation = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async url => url.endsWith('/check-ssh')
      ? new Response(JSON.stringify({ connected: false, error: 'node 10.42.0.111: no address lies in the replication network 10.44.0.0/24 (addresses: 10.42.0.111, 10.43.0.111)' }))
      : implementation(url))
    await chooseEngineSource('zfs')
    await userEvent.click(screen.getByRole('checkbox', { name: /guest-100/ }))
    await chooseTarget()

    await screen.findByText(/no address lies in the replication network 10\.44\.0\.0\/24/)
    expect(screen.getByText(/replication network of the target connection/i)).toBeInTheDocument()
    expect(screen.queryByText(/Passwordless SSH must be configured/)).not.toBeInTheDocument()
  })
})
