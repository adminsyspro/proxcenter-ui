/**
 * Component tests for AddDiskDialog.tsx — numeric fields must be clearable.
 *
 * Focus: the two fields converted to NumericTextField (discussion #634).
 *   - "Disk size (GiB)" (fallback 1, min 1) — same defect class as the LXC
 *     root-disk field that was reported: with `parseInt(v) || 1` the field
 *     could never be emptied, so typing 20 over 32 produced 320.
 *   - the unlabeled bus-index field next to Bus/Device (fallback 0, min 0/max 30).
 *
 * The dialog fetches storages on open; MSW seeds that one endpoint, and the
 * first returned storage is auto-selected, which is what enables Add.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  userEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import { AddDiskDialog } from './AddDiskDialog'

const CONN_ID = 'conn-1'
const NODE_NAME = 'pve1'

const diskStorages = [
  {
    storage: 'local',
    content: 'rootdir,images,vztmpl',
    type: 'dir',
    avail: 50 * 1024 * 1024 * 1024,
    total: 100 * 1024 * 1024 * 1024,
  },
]

function seedHandlers() {
  server.use(
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storages`, () =>
      HttpResponse.json({ data: diskStorages }),
    ),
  )
}

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    connId: CONN_ID,
    node: NODE_NAME,
    vmid: '100',
    existingDisks: [] as string[],
    ...overrides,
  }
}

const sizeField = () => screen.getByLabelText('Disk size (GiB)') as HTMLInputElement

// The bus-index field carries no label. Both numeric inputs are type="number",
// so they expose the spinbutton role; bus index comes first in the DOM.
const busIndexField = () => screen.getAllByRole('spinbutton')[0] as HTMLInputElement

const addButton = () => screen.getByRole('button', { name: 'Add' })

describe('AddDiskDialog — clearable numeric fields', () => {
  // This suite renders repeatedly; RTL is not auto-cleaned up in this repo.
  afterEach(cleanup)

  beforeEach(() => {
    seedHandlers()
  })

  it('shows the default disk size', () => {
    renderWithProviders(<AddDiskDialog {...makeProps()} />)
    expect(sizeField().value).toBe('32')
  })

  it('replaces the disk size instead of gluing the old digits in front (discussion #634)', async () => {
    renderWithProviders(<AddDiskDialog {...makeProps()} />)

    await userEvent.clear(sizeField())
    expect(sizeField().value).toBe('')

    await userEvent.type(sizeField(), '20')
    expect(sizeField().value).toBe('20')
  })

  it('commits the fallback size when the field is left empty', async () => {
    renderWithProviders(<AddDiskDialog {...makeProps()} />)

    await userEvent.clear(sizeField())
    await userEvent.tab()
    expect(sizeField().value).toBe('1')
  })

  it('clamps a below-minimum disk size on blur', async () => {
    renderWithProviders(<AddDiskDialog {...makeProps()} />)

    await userEvent.clear(sizeField())
    await userEvent.type(sizeField(), '0')
    await userEvent.tab()
    expect(sizeField().value).toBe('1')
  })

  it('lets the bus index be emptied and falls back to 0 on blur', async () => {
    renderWithProviders(<AddDiskDialog {...makeProps()} />)

    await userEvent.clear(busIndexField())
    expect(busIndexField().value).toBe('')

    await userEvent.tab()
    expect(busIndexField().value).toBe('0')
  })

  it('saves the retyped bus index and disk size', async () => {
    const props = makeProps()

    renderWithProviders(<AddDiskDialog {...props} />)

    // Add stays disabled until the storages fetch auto-selects the first storage.
    await waitFor(() => expect(addButton()).not.toBeDisabled())

    await userEvent.clear(busIndexField())
    await userEvent.type(busIndexField(), '2')
    await userEvent.clear(sizeField())
    await userEvent.type(sizeField(), '20')

    await userEvent.click(addButton())

    await waitFor(() => expect(props.onSave).toHaveBeenCalledWith({ scsi2: 'local:20' }))
  })
})
