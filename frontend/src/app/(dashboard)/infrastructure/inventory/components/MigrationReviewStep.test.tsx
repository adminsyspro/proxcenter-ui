/**
 * Component tests for the migration review step (#317, lot 1): the NIC table
 * shows every source adapter with its vSphere network next to the target
 * bridge picker fed by `network-choices`, the hardware fields start on the
 * source values and report an out-of-range value, and the CPU list merges the
 * node's `cpu-models`.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent, within } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import MigrationReviewStep, { toNetworkChoices, formatGB } from './MigrationReviewStep'
import type { ReviewSource } from './migrationReview'

const GIB = 1024 ** 3
const source: ReviewSource = {
  numCPU: 4, numCoresPerSocket: 2, sockets: 2, memoryMB: 4096,
  nics: [
    { label: 'Network adapter 1', type: 'Vmxnet3', macAddress: '00:50:56:aa:00:01', network: 'VM Network' },
    { label: 'Network adapter 2', type: 'E1000', macAddress: '00:50:56:aa:00:02', network: 'i317-net' },
  ],
  disks: [
    { label: 'Hard disk 1', capacityBytes: 40 * GIB, fileName: '[ds1] web/web.vmdk' },
    { label: 'Hard disk 2', capacityBytes: 100 * GIB, fileName: '[ds1] web/web_1.vmdk' },
  ],
}
const storages = [
  { storage: 'san-lvm', type: 'lvm', avail: 800 * GIB },
  { storage: 'tank', type: 'zfspool', avail: 120 * GIB },
]
const onDefault = { storage: 'san-lvm', exclude: false }

// The jsdom setup owns server.listen/close; only the handlers are per test.
afterEach(() => { cleanup(); server.resetHandlers() })

function seedNode() {
  server.use(
    http.get('/api/v1/connections/pve/network-choices', () => HttpResponse.json({ data: [
      { kind: 'bridge', name: 'vmbr0', type: 'bridge' },
      { kind: 'vnet', name: 'vf95117a', displayName: 'dmz', zone: 'zmsppvep' },
    ] })),
    http.get('/api/v1/connections/pve/nodes/pve1/cpu-models', () => HttpResponse.json({ data: [{ name: 'host' }, { name: 'EPYC-Rome' }, { name: 'gold', custom: 1 }] })),
  )
}

function renderStep(overrides: Partial<React.ComponentProps<typeof MigrationReviewStep>> = {}) {
  const props: React.ComponentProps<typeof MigrationReviewStep> = {
    source, sourceLoading: false, sourceName: 'web-01', targetConnId: 'pve', targetNode: 'pve1', defaultBridge: 'vmbr0', canEditVlan: true,
    cpuType: 'x86-64-v2-AES', onCpuTypeChange: vi.fn(),
    hardware: { cores: '2', sockets: '2', memoryMB: '4096' }, onHardwareChange: vi.fn(),
    disks: [onDefault, onDefault], onDisksChange: vi.fn(), storages,
    nics: [{ bridge: 'vmbr0', vlanTag: '', model: '' }, { bridge: 'vmbr0', vlanTag: '', model: '' }], onNicsChange: vi.fn(),
    ...overrides,
  }
  renderWithProviders(<MigrationReviewStep {...props} />)
  return props
}

describe('toNetworkChoices', () => {
  it('keeps bridges first, labels VNets with their alias and zone, drops malformed rows', () => {
    expect(toNetworkChoices([
      { kind: 'vnet', name: 'vf95117a', displayName: 'dmz', zone: 'z1' },
      { kind: 'bridge', name: 'vmbr0', type: 'bridge' },
      { kind: 'shared', name: 'vmbr1', label: 'uplink' },
      { kind: 'bridge', name: '' },
      null,
    ])).toEqual([
      { name: 'vmbr0', kind: 'bridge', label: '' },
      { name: 'vmbr1', kind: 'shared', label: 'uplink' },
      { name: 'vf95117a', kind: 'vnet', label: 'VNet · dmz · z1' },
    ])
    expect(toNetworkChoices(undefined)).toEqual([])
  })
})

describe('MigrationReviewStep', () => {
  it('lists every source NIC with its vSphere network and offers the node bridges and VNets', async () => {
    seedNode()
    const props = renderStep()
    expect(screen.getByText('Network adapter 1')).toBeTruthy()
    expect(screen.getByText('Network adapter 2')).toBeTruthy()
    expect(screen.getByText('VM Network')).toBeTruthy()
    expect(screen.getByText('i317-net')).toBeTruthy()

    const row1 = screen.getByTestId('review-nic-1')
    const combo = within(within(row1).getByTestId('review-nic-1-bridge')).getByRole('combobox')
    await waitFor(async () => {
      fireEvent.mouseDown(combo)
      expect(screen.getByRole('option', { name: /vf95117a/ })).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('option', { name: /vf95117a/ }))
    expect(props.onNicsChange).toHaveBeenCalledWith([
      { bridge: 'vmbr0', vlanTag: '', model: '' }, { bridge: 'vf95117a', vlanTag: '', model: '' },
    ])
  })

  it('starts the hardware fields on the source values and flags an out-of-range value', async () => {
    seedNode()
    const props = renderStep({ hardware: { cores: '200', sockets: '2', memoryMB: '4096' } })
    expect((screen.getByTestId('review-cores') as HTMLInputElement).value).toBe('200')
    expect(screen.getByText('1 to 128')).toBeTruthy()
    expect(screen.getAllByText(/Source: 4 GiB/).length).toBe(1)
    // one row per value, each with its slider showing what will apply
    expect(screen.getByTestId('review-memory-value')).toHaveTextContent('4 GiB')
    expect(screen.getByRole('slider', { name: 'Memory' })).toBeTruthy()
    fireEvent.change(screen.getByTestId('review-memory'), { target: { value: '8192' } })
    expect(props.onHardwareChange).toHaveBeenCalledWith({ cores: '200', sockets: '2', memoryMB: '8192' })
    await waitFor(() => expect(screen.queryByText(/could not be read/)).toBeNull())
  })

  it('moves a value with its slider: cores linearly, memory by steps rounded to 256 MiB', () => {
    seedNode()
    const props = renderStep({ hardware: { cores: '', sockets: '', memoryMB: '' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Cores' }), { target: { value: 7 } })
    expect(props.onHardwareChange).toHaveBeenLastCalledWith(expect.objectContaining({ cores: '8' }))
    // stop 3 = 4 GiB, halfway to stop 4 (8 GiB) = 6 GiB
    fireEvent.change(screen.getByRole('slider', { name: 'Memory' }), { target: { value: 3.5 } })
    expect(props.onHardwareChange).toHaveBeenLastCalledWith(expect.objectContaining({ memoryMB: '6144' }))
  })

  it('merges the node CPU models into the picker', async () => {
    seedNode()
    const props = renderStep()
    const combo = within(screen.getByTestId('review-cpu-type')).getByRole('combobox')
    await waitFor(async () => {
      fireEvent.mouseDown(combo)
      expect(screen.getByRole('option', { name: /EPYC-Rome/ })).toBeTruthy()
    })
    expect(screen.getByRole('option', { name: /custom-gold/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('option', { name: /^host$/ }))
    expect(props.onCpuTypeChange).toHaveBeenCalledWith('host')
  })

  it('tells the operator when the source could not be read and hides the VLAN field without the permission', () => {
    seedNode()
    renderStep({ source: null, nics: [], disks: [], canEditVlan: false })
    expect(screen.getByText(/could not be read/)).toBeTruthy()
    expect(screen.getByText(/No network adapter/)).toBeTruthy()
    expect(screen.getByText(/No disk detected/)).toBeTruthy()
  })

  // #317 lot 2: the disk table, before the NICs.
  it('lists every source disk with its size and path, and moves one to another storage of the node', async () => {
    seedNode()
    const props = renderStep()
    const disks = screen.getByTestId('review-disks')
    expect(within(disks).getByText('Hard disk 1')).toBeTruthy()
    expect(within(disks).getByText('40.0 GB · [ds1] web/web.vmdk')).toBeTruthy()
    expect(within(disks).getByText('100.0 GB · [ds1] web/web_1.vmdk')).toBeTruthy()
    // disks come before the network interfaces
    expect(disks.compareDocumentPosition(screen.getByText('Network interfaces')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    const combo = within(screen.getByTestId('review-disk-1-storage')).getByRole('combobox')
    fireEvent.mouseDown(combo)
    const option = await screen.findByRole('option', { name: /tank/ })
    // the menu shows the type and the free space, like the step-1 selector
    expect(option.textContent).toContain('(zfspool)')
    expect(option.textContent).toContain('120.0 GB')
    fireEvent.click(option)
    expect(props.onDisksChange).toHaveBeenCalledWith([onDefault, { storage: 'tank', exclude: false }])
  })

  it('leaves a disk out with its checkbox, dims the row and locks its storage; the boot disk stays locked', () => {
    seedNode()
    const props = renderStep({ disks: [onDefault, { storage: 'tank', exclude: true }] })
    const boot = screen.getByTestId('review-disk-0-include') as HTMLInputElement
    expect(boot.checked).toBe(true)
    expect(boot.disabled).toBe(true)
    const second = screen.getByTestId('review-disk-1-include') as HTMLInputElement
    expect(second.checked).toBe(false)
    expect(screen.getByTestId('review-disk-1')).toHaveStyle({ opacity: '0.45' })
    expect(within(screen.getByTestId('review-disk-1-storage')).getByRole('combobox').getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(second)
    expect(props.onDisksChange).toHaveBeenCalledWith([onDefault, { storage: 'tank', exclude: false }])
  })

  it('flags a kept disk without a storage and keeps an unknown storage selectable', async () => {
    seedNode()
    renderStep({ disks: [{ storage: 'old-pool', exclude: false }, { storage: '', exclude: false }] })
    const blank = within(screen.getByTestId('review-disk-1-storage')).getByRole('combobox')
    expect(blank.closest('.MuiInputBase-root')?.className).toMatch(/Mui-error/)
    expect(within(screen.getByTestId('review-disk-1-storage')).getByText('Select storage...')).toBeTruthy()
    fireEvent.mouseDown(within(screen.getByTestId('review-disk-0-storage')).getByRole('combobox'))
    expect(await screen.findByRole('option', { name: /old-pool/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /san-lvm/ })).toBeTruthy()
  })

  it('renders the parent controls under the disk table, where the thick LVM options belong', () => {
    seedNode()
    renderStep({ belowDisks: <span>Convert disks to qcow2 after migration</span> })
    expect(within(screen.getByTestId('review-disks')).getByTestId('review-disks-below').textContent).toContain('Convert disks to qcow2')
  })

  it('formats sizes like the storage selector', () => {
    expect(formatGB(40 * GIB)).toBe('40.0 GB')
    expect(formatGB(0)).toBe('')
    expect(formatGB(undefined)).toBe('')
  })

  it('warns about a source vTPM: its state is never copied and the recovery key is needed', () => {
    seedNode()
    renderStep({ source: { ...source, hasVtpm: true } })
    const alert = screen.getByTestId('review-vtpm-warning')
    expect(alert.textContent).toMatch(/virtual TPM/)
    expect(alert.textContent).toMatch(/BitLocker/)
    expect(alert.textContent).toMatch(/recovery key/)
  })

  it('shows no TPM warning for a source without one', () => {
    seedNode()
    renderStep()
    expect(screen.queryByTestId('review-vtpm-warning')).toBeNull()
  })
})
