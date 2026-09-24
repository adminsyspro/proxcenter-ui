/**
 * #1004: a disk still referenced by snapshots cannot be moved with "delete
 * source", nor deleted once it is an unused disk. The dialogs ask
 * useDiskSnapshotRefs and warn instead of letting PVE fail with a raw 500.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

import { EditDiskDialog } from './EditDiskDialog'
import { DeleteUnusedDiskDialog } from './DeleteUnusedDiskDialog'

const refsMock = vi.fn<(...a: any[]) => string[] | null>()

vi.mock('@/hooks/useDiskSnapshotRefs', () => ({
  useDiskSnapshotRefs: (...a: any[]) => ({ snapshots: refsMock(...a), recheck: vi.fn() }),
}))

const guest = { connId: 'conn-1', node: 'pve3', guestType: 'qemu', vmid: '100', canDeleteSnapshots: true }

const disk = { id: 'scsi0', size: '32G', storage: 'local-lvm' }
const unusedDisk = { id: 'unused0', size: '32G', storage: 'local-lvm', isUnused: true, rawValue: 'local-lvm:vm-100-disk-0' }

function moveProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onMoveStorage: vi.fn().mockResolvedValue(undefined),
    canEditHardware: true,
    canChangeMedia: true,
    disk,
    initialTab: 3,
    availableStorages: [
      { storage: 'local-lvm', type: 'lvmthin' },
      { storage: 'ceph', type: 'rbd' },
    ],
    ...guest,
    ...overrides,
  }
}

const deleteSourceBox = () => screen.getByRole('checkbox', { name: /delete the source disk/i }) as HTMLInputElement

beforeEach(() => refsMock.mockReset().mockReturnValue([]))
afterEach(cleanup)

describe('EditDiskDialog — Move tab', () => {
  it('asks for the snapshots holding the moved disk', () => {
    renderWithProviders(<EditDiskDialog {...moveProps()} />)

    expect(refsMock).toHaveBeenCalledWith({ connId: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' }, 'scsi0')
  })

  it('keeps "delete source" available when no snapshot holds the disk', () => {
    renderWithProviders(<EditDiskDialog {...moveProps()} />)

    expect(deleteSourceBox().checked).toBe(true)
    expect(deleteSourceBox().disabled).toBe(false)
    expect(screen.queryByText(/still used by the snapshots/i)).toBeNull()
  })

  it('turns "delete source" off and names the snapshots that block it', () => {
    refsMock.mockReturnValue(['before-upgrade', 'clean'])

    renderWithProviders(<EditDiskDialog {...moveProps()} />)

    expect(deleteSourceBox().checked).toBe(false)
    expect(deleteSourceBox().disabled).toBe(true)
    expect(screen.getByText(/still used by the snapshots: before-upgrade, clean/i)).toBeTruthy()
  })

  it('moves without deleting the source when snapshots hold it', async () => {
    refsMock.mockReturnValue(['before-upgrade'])
    const props = moveProps()

    renderWithProviders(<EditDiskDialog {...props} />)
    await userEvent.click(screen.getAllByRole('combobox')[0])
    await userEvent.click(within(screen.getByRole('listbox')).getByText('ceph'))
    await userEvent.click(screen.getByRole('button', { name: /ceph/i }))

    await waitFor(() => expect(props.onMoveStorage).toHaveBeenCalledWith('ceph', false, undefined))
  })
})

describe('EditDiskDialog — unused disk', () => {
  it('disables Delete and names the snapshots that still use the volume', () => {
    refsMock.mockReturnValue(['before-upgrade'])

    renderWithProviders(<EditDiskDialog {...moveProps({ disk: unusedDisk, initialTab: 0 })} />)

    expect(refsMock).toHaveBeenCalledWith(expect.objectContaining({ vmid: '100' }), 'unused0')
    expect((screen.getByRole('button', { name: /^delete$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/still used by the snapshots: before-upgrade/i)).toBeTruthy()
  })

  it('offers to delete the blocking snapshots only with the snapshot permission', () => {
    refsMock.mockReturnValue(['before-upgrade'])

    renderWithProviders(<EditDiskDialog {...moveProps({ disk: unusedDisk, initialTab: 0 })} />)
    expect(screen.getByRole('button', { name: /delete these snapshots/i })).toBeTruthy()
    cleanup()

    renderWithProviders(<EditDiskDialog {...moveProps({ disk: unusedDisk, initialTab: 0, canDeleteSnapshots: false })} />)
    expect(screen.queryByRole('button', { name: /delete these snapshots/i })).toBeNull()
  })

  it('leaves Delete enabled when nothing references the volume', () => {
    renderWithProviders(<EditDiskDialog {...moveProps({ disk: unusedDisk, initialTab: 0 })} />)

    expect((screen.getByRole('button', { name: /^delete$/i }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('DeleteUnusedDiskDialog', () => {
  const props = (overrides: Record<string, unknown> = {}) => ({
    open: true,
    diskId: 'unused0',
    volume: 'local-lvm:vm-100-disk-0',
    onClose: vi.fn(),
    onConfirm: vi.fn().mockResolvedValue(undefined),
    guest: { connId: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' },
    canDeleteSnapshots: true,
    ...overrides,
  })

  it('disables Delete and names the snapshots that still use the volume', () => {
    refsMock.mockReturnValue(['s1'])

    renderWithProviders(<DeleteUnusedDiskDialog {...props()} />)

    expect(refsMock).toHaveBeenCalledWith({ connId: 'conn-1', type: 'qemu', node: 'pve3', vmid: '100' }, 'unused0')
    expect((screen.getByRole('button', { name: /^delete$/i }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/still used by the snapshots: s1/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /delete these snapshots/i })).toBeTruthy()
  })

  it('still lets the delete go through while the check has not answered', async () => {
    refsMock.mockReturnValue(null)
    const p = props()

    renderWithProviders(<DeleteUnusedDiskDialog {...p} />)
    await userEvent.click(screen.getByRole('button', { name: /^delete$/i }))

    expect(p.onConfirm).toHaveBeenCalled()
  })
})
