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
