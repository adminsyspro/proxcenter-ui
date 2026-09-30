/**
 * Component tests for EditDiskDialog.tsx — clearable bus-index field.
 *
 * Only the unused-disk branch is exercised: that is where the converted
 * numeric field lives (the reassign bus slot, fallback 0 / min 0 / max 30).
 * Passing an unused disk and no connId/node keeps the dialog offline — the
 * storage and ISO fetches are all guarded on isCdrom / connId / node.
 *
 * The Options and Bandwidth tabs of the regular-disk branch keep raw string
 * state and were deliberately left untouched, so they are not covered here.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import {
  renderWithProviders,
  screen,
  userEvent,
  waitFor,
} from '@/__tests__/setup/renderWithProviders'

import { EditDiskDialog } from './EditDiskDialog'

const unusedDisk = {
  id: 'unused0',
  size: '8G',
  storage: 'local',
  isUnused: true,
  rawValue: 'local:vm-100-disk-1',
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    disk: unusedDisk,
    canEditHardware: true,
    canChangeMedia: true,
    ...overrides,
  }
}

// The reassign index is the only numeric input in the unused-disk branch.
const indexField = () => screen.getByRole('spinbutton') as HTMLInputElement

describe('EditDiskDialog — clearable reassign index', () => {
  // This suite renders repeatedly; RTL is not auto-cleaned up in this repo.
  afterEach(cleanup)

  it('replaces the index instead of gluing the old digit in front', async () => {
    renderWithProviders(<EditDiskDialog {...makeProps()} />)
    expect(indexField().value).toBe('0')

    await userEvent.clear(indexField())
    expect(indexField().value).toBe('')

    await userEvent.type(indexField(), '3')
    expect(indexField().value).toBe('3')

    // The preview caption proves the number reached the parent state.
    expect(screen.getByText(/scsi3/)).toBeInTheDocument()
  })

  it('commits the fallback index when the field is left empty', async () => {
    renderWithProviders(<EditDiskDialog {...makeProps()} />)

    await userEvent.clear(indexField())
    await userEvent.tab()
    expect(indexField().value).toBe('0')
    expect(screen.getByText(/scsi0/)).toBeInTheDocument()
  })

  it('reassigns to the retyped bus slot', async () => {
    const props = makeProps()

    renderWithProviders(<EditDiskDialog {...props} />)

    await userEvent.clear(indexField())
    await userEvent.type(indexField(), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Reassign' }))

    expect(props.onSave).toHaveBeenCalledWith({ scsi5: unusedDisk.rawValue })
  })
})

/**
 * Task 16: tenant UI honesty on QoS. The disk's storage is derived from
 * `disk.rawValue.split(':')[0]` and looked up in `availableStorages`. When
 * that storage is governed by a vDC storage policy (Task 14 decorates the
 * storages route with `policy`), the Bandwidth tab shows the policy's own
 * caps as disabled fields and handleSave must not push any mbps_ or iops_
 * option (the server strips-and-stamps its own caps regardless of what the
 * client sends).
 */
describe('EditDiskDialog, storage policy locks QoS fields (regular disk)', () => {
  afterEach(cleanup)

  const availableStorages = [
    { storage: 'local', type: 'dir' },
    {
      storage: 'ceph-gold',
      type: 'rbd',
      policy: { name: 'Gold', iopsRd: 5000, iopsWr: 4000, mbpsRd: 300, mbpsWr: 250 },
    },
  ]

  // Carries its own (pre-policy) QoS values on the raw config, deliberately
  // DIFFERENT from the ceph-gold policy's caps (mbpsRd 300, iopsRd 5000,
  // etc. below), same as a disk that had explicit limits before a policy
  // was attached to its storage. The load-values effect (disk.mbps_rd ->
  // mbpsRd state, etc.) populates these into state, so:
  //  - the "shows the policy caps" test proves the displayed value is the
  //    policy's (300), not the disk's own raw value (111);
  //  - the "no QoS push" test is non-vacuous: with a real, non-empty state
  //    for every field, deleting the `!selectedPolicy` guard in handleSave
  //    would push mbps_rd=111 etc. and fail the assertion.
  const policiedDisk = {
    id: 'scsi0',
    size: '32G',
    storage: 'ceph-gold',
    rawValue: 'ceph-gold:vm-100-disk-0,size=32G,mbps_rd=111,mbps_wr=222,iops_rd=3333,iops_wr=4444',
    mbps_rd: 111,
    mbps_wr: 222,
    iops_rd: 3333,
    iops_wr: 4444,
  }

  const plainDisk = {
    id: 'scsi0',
    size: '32G',
    storage: 'local',
    rawValue: 'local:vm-100-disk-0,size=32G',
  }

  const bandwidthTab = () => screen.getByRole('tab', { name: 'Bandwidth' })
  const mbpsReadField = () => screen.getByLabelText('Read limit (MB/s)') as HTMLInputElement
  const saveButton = () => screen.getByRole('button', { name: 'Save' })

  it('locks the Bandwidth fields to the policy caps and shows the Alert', async () => {
    renderWithProviders(
      <EditDiskDialog {...makeProps({ disk: policiedDisk, availableStorages })} />,
    )

    await userEvent.click(bandwidthTab())

    expect(screen.getByRole('alert')).toHaveTextContent('Gold')
    expect(mbpsReadField()).toBeDisabled()
    expect(mbpsReadField().value).toBe('300')
  })

  it('does not push any QoS option on save when the disk storage is policied', async () => {
    const props = makeProps({ disk: policiedDisk, availableStorages })

    renderWithProviders(<EditDiskDialog {...props} />)

    await userEvent.click(saveButton())

    await waitFor(() => expect(props.onSave).toHaveBeenCalled())
    const saved = props.onSave.mock.calls[0][0] as string

    // Exact match, not just a substring check: the disk's own raw config
    // carried real mbps_rd=111/mbps_wr=222/iops_rd=3333/iops_wr=4444 (loaded
    // into state by the hydration effect), so this fails the moment the
    // `!selectedPolicy` guard around the QoS push in handleSave is removed.
    expect(saved).toBe('ceph-gold:vm-100-disk-0,size=32G')
    expect(saved).not.toMatch(/mbps_|iops_/)
  })

  it('keeps Bandwidth fields editable and pushes QoS keys for a non-policied storage (no regression)', async () => {
    const props = makeProps({ disk: plainDisk, availableStorages })

    renderWithProviders(<EditDiskDialog {...props} />)

    await userEvent.click(bandwidthTab())
    expect(mbpsReadField()).not.toBeDisabled()

    await userEvent.type(mbpsReadField(), '50')
    await userEvent.click(saveButton())

    await waitFor(() => expect(props.onSave).toHaveBeenCalled())
    const saved = props.onSave.mock.calls[0][0] as string

    expect(saved).toContain('mbps_rd=50')
  })
})


describe('existing CD-ROM media permission', () => {
  // No RTL auto-cleanup here (vitest runs without globals): a dialog left
  // mounted past the last case keeps scheduling React work after the jsdom
  // environment is gone, and that lands as an unhandled "window is not defined".
  afterEach(cleanup)
  const cdrom = { id: 'sata0', storage: 'local', size: '-', isCdrom: true,
    rawValue: 'local:iso/old.iso,media=cdrom,cache=none,backup=0,size=1G' }

  it('lets a media-only user eject while preserving hardware options and hiding deletion', async () => {
    const props = makeProps({ disk: cdrom, canEditHardware: false, canChangeMedia: true })
    renderWithProviders(<EditDiskDialog {...props} />)
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /physical/i })).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /do not use any media/i }))
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith('none,media=cdrom,cache=none,backup=0'))
    expect(props.onDelete).not.toHaveBeenCalled()
  })

  it('blocks saves and deletion without either right', async () => {
    const props = makeProps({ disk: { ...cdrom, storage: 'none', rawValue: 'none,media=cdrom' }, canEditHardware: false, canChangeMedia: false })
    renderWithProviders(<EditDiskDialog {...props} />)
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument()
  })

  it('retains hardware-only access to ordinary media operations and device removal', async () => {
    const props = makeProps({ disk: { ...cdrom, storage: 'none', rawValue: 'none,media=cdrom' }, canEditHardware: true, canChangeMedia: false })
    renderWithProviders(<EditDiskDialog {...props} />)
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith('none,media=cdrom'))
  })
})

describe('EditDiskDialog — unused disk volume', () => {
  afterEach(cleanup)

  it('shows the volume as a labelled line, not inside an info alert', () => {
    renderWithProviders(<EditDiskDialog {...makeProps()} />)

    const volume = screen.getByText('local:vm-100-disk-1')
    expect(screen.getByText('Volume')).toBeInTheDocument()
    expect(volume.closest('[role="alert"]')).toBeNull()
  })
})

describe('EditDiskDialog — node-backed lists', () => {
  afterEach(cleanup)

  const CONN = 'conn-1'
  const NODE = 'pve1'

  function seedNodeStorages() {
    const seen: string[] = []

    server.use(
      http.get(`*/api/v1/connections/${CONN}/nodes/${NODE}/storages`, ({ request }) => {
        const content = new URL(request.url).searchParams.get('content') || ''

        seen.push(content)
        if (content === 'iso') {
          return HttpResponse.json({ data: [
            { storage: 'local', type: 'dir', content: 'iso,vztmpl,backup' },
            { storage: 'ceph-pool', type: 'rbd', content: 'images,rootdir' },
          ] })
        }

        return HttpResponse.json({ data: [
          { storage: 'local-lvm', type: 'lvmthin', total: 100, used: 40 },
          { storage: 'ceph-pool', type: 'rbd', total: 200, used: 10 },
        ] })
      }),
      http.get(`*/api/v1/connections/${CONN}/nodes/${NODE}/storage/local/content`, () =>
        HttpResponse.json({ data: [{ volid: 'local:iso/debian-13.1.0-amd64-netinst.iso' }, { volid: 'local:iso/virtio-win.iso' }] }),
      ),
    )

    return seen
  }

  it('lists only ISO-capable storages for a CD-ROM and parses the image names from their volids', async () => {
    const seen = seedNodeStorages()
    const cdrom = { id: 'ide2', storage: 'none', size: '-', isCdrom: true, rawValue: 'none,media=cdrom' }

    renderWithProviders(<EditDiskDialog {...makeProps({ disk: cdrom, connId: CONN, node: NODE })} />)

    await waitFor(() => expect(seen).toContain('iso'))
    await userEvent.click(screen.getByRole('radio', { name: /Use CD\/DVD disc image file/i }))

    const storageLabel = screen.getAllByText('Storage').find(el => el.tagName === 'LABEL')!
    fireEvent.mouseDown(within(storageLabel.parentElement!).getByRole('combobox'))

    const listbox = await screen.findByRole('listbox')

    expect(within(listbox).getByText('local')).toBeInTheDocument()
    expect(within(listbox).queryByText('ceph-pool')).toBeNull()

    fireEvent.click(within(listbox).getByText('local'))

    const isoLabel = screen.getAllByText('ISO Image').find(el => el.tagName === 'LABEL')!
    const isoSelect = within(isoLabel.parentElement!).getByRole('combobox')

    await waitFor(() => expect(isoSelect).not.toHaveAttribute('aria-disabled', 'true'))
    fireEvent.mouseDown(isoSelect)

    const isoList = await screen.findByRole('listbox')

    await waitFor(() => expect(within(isoList).getByText('debian-13.1.0-amd64-netinst.iso')).toBeInTheDocument())
    expect(within(isoList).getByText('virtio-win.iso')).toBeInTheDocument()
  })

  it('loads the node image storages for the Move tab and hides the disk own storage', async () => {
    const seen = seedNodeStorages()
    const disk = { id: 'scsi0', size: '32G', storage: 'local-lvm', rawValue: 'local-lvm:vm-100-disk-0,size=32G' }

    renderWithProviders(
      <EditDiskDialog {...makeProps({ disk, connId: CONN, node: NODE, onResize: vi.fn().mockResolvedValue(undefined), onMoveStorage: vi.fn().mockResolvedValue(undefined) })} />,
    )

    await waitFor(() => expect(seen).toContain('images'))
    await userEvent.click(screen.getByRole('tab', { name: 'Move' }))

    const label = await waitFor(() => {
      const el = screen.getAllByText('Target storage').find(e => e.tagName === 'LABEL')

      if (!el) throw new Error('target storage select not rendered')

      return el
    })

    fireEvent.mouseDown(within(label.parentElement!).getByRole('combobox'))

    const listbox = await screen.findByRole('listbox')

    expect(within(listbox).getByText('ceph-pool')).toBeInTheDocument()
    expect(within(listbox).queryByText('local-lvm')).toBeNull()
  })

  it('suggests the first free bus slot when reassigning an unused disk', () => {
    renderWithProviders(
      <EditDiskDialog {...makeProps({ existingDisks: ['scsi0', 'scsi1', 'scsi3', 'scsihw', 'virtio2', 'ide2'] })} />,
    )

    expect(indexField().value).toBe('2')
    expect(screen.getByText(/scsi2/)).toBeInTheDocument()
  })
})

describe('EditDiskDialog — resize in the unit PVE wrote (#1036)', () => {
  afterEach(cleanup)

  const resizeProps = (disk: Record<string, unknown>) => makeProps({
    disk,
    onResize: vi.fn().mockResolvedValue(undefined),
    onMoveStorage: vi.fn().mockResolvedValue(undefined),
  })

  it('offers no Resize tab on an EFI or TPM disk and keeps Move reachable', async () => {
    const efi = { id: 'efidisk0', size: '528K', storage: 'local-lvm', isEfi: true, rawValue: 'local-lvm:vm-100-disk-1,efitype=4m,size=528K' }

    renderWithProviders(<EditDiskDialog {...resizeProps(efi)} />)

    expect(screen.queryByRole('tab', { name: 'Resize' })).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: 'Move' }))
    expect(screen.getByRole('tab', { name: 'Move' })).toHaveAttribute('aria-selected', 'true')

    cleanup()
    const tpm = { id: 'tpmstate0', size: '4M', storage: 'local-lvm', isTpm: true, rawValue: 'local-lvm:vm-100-disk-2,size=4M,version=v2.0' }

    renderWithProviders(<EditDiskDialog {...resizeProps(tpm)} />)
    expect(screen.queryByRole('tab', { name: 'Resize' })).toBeNull()
  })

  it('starts a 512M disk at 512 MB and sends the increase in megabytes', async () => {
    const props = resizeProps({ id: 'scsi1', size: '512M', storage: 'local-lvm', rawValue: 'local-lvm:vm-100-disk-3,size=512M' })

    renderWithProviders(<EditDiskDialog {...props} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Resize' }))

    const field = screen.getByRole('spinbutton') as HTMLInputElement

    expect(field.value).toBe('512')
    await userEvent.clear(field)
    await userEvent.type(field, '768')
    await userEvent.click(screen.getByRole('button', { name: /768 MB/ }))

    await waitFor(() => expect(props.onResize).toHaveBeenCalledWith('+256M'))
  })

  it('keeps a gigabyte disk in GB and sends the exact increase', async () => {
    const props = resizeProps({ id: 'scsi0', size: '32G', storage: 'local-lvm', rawValue: 'local-lvm:vm-100-disk-0,size=32G' })

    renderWithProviders(<EditDiskDialog {...props} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Resize' }))

    const field = screen.getByRole('spinbutton') as HTMLInputElement

    expect(field.value).toBe('32')
    await userEvent.clear(field)
    await userEvent.type(field, '40.5')
    await userEvent.click(screen.getByRole('button', { name: /40\.5 GB/ }))

    await waitFor(() => expect(props.onResize).toHaveBeenCalledWith('+8704M'))
  })
})
