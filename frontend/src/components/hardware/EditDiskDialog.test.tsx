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
import { cleanup } from '@testing-library/react'
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

  const policiedDisk = {
    id: 'scsi0',
    size: '32G',
    storage: 'ceph-gold',
    rawValue: 'ceph-gold:vm-100-disk-0,size=32G',
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
