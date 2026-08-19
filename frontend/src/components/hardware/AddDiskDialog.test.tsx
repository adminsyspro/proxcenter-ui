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
  within,
  waitFor,
  userEvent,
  fireEvent,
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

/**
 * Task 16: tenant UI honesty on QoS. When the selected storage is governed
 * by a vDC storage policy (Task 14 decorates the storages route with
 * `policy`), the Bandwidth tab must show the policy's own caps as disabled
 * fields and handleSave must not push any mbps_ or iops_ option (the server
 * strips-and-stamps its own caps regardless of what the client sends).
 */
describe('AddDiskDialog, storage policy locks QoS fields', () => {
  afterEach(cleanup)

  const policiedStorages = [
    {
      storage: 'local',
      content: 'rootdir,images,vztmpl',
      type: 'dir',
      avail: 50 * 1024 * 1024 * 1024,
      total: 100 * 1024 * 1024 * 1024,
    },
    {
      storage: 'ceph-gold',
      content: 'images',
      type: 'rbd',
      avail: 200 * 1024 * 1024 * 1024,
      total: 500 * 1024 * 1024 * 1024,
      policy: { name: 'Gold', iopsRd: 5000, iopsWr: 4000, mbpsRd: 300, mbpsWr: 250 },
    },
  ]

  function seedPolicyHandlers() {
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storages`, () =>
        HttpResponse.json({ data: policiedStorages }),
      ),
    )
  }

  // Same "find the <label>, grab the sibling combobox" helper used across
  // the repo's other MUI-Select tests (see HostRulesPanel.test.tsx).
  function storageCombobox() {
    const el = screen.queryAllByText('Storage').find(n => n.tagName === 'LABEL')

    if (!el?.parentElement) throw new Error('No Select labelled "Storage"')

    return within(el.parentElement).getByRole('combobox')
  }

  const bandwidthTab = () => screen.getByRole('tab', { name: 'Bandwidth' })
  const mbpsReadField = () => screen.getByLabelText('Read limit (MB/s)') as HTMLInputElement

  async function selectPoliciedStorage() {
    await waitFor(() => expect(addButton()).not.toBeDisabled())
    fireEvent.mouseDown(storageCombobox())
    fireEvent.click(await screen.findByRole('option', { name: /ceph-gold/ }))
  }

  it('shows the policy chip on the MenuItem', async () => {
    seedPolicyHandlers()
    renderWithProviders(<AddDiskDialog {...makeProps()} />)

    await waitFor(() => expect(addButton()).not.toBeDisabled())
    fireEvent.mouseDown(storageCombobox())

    const option = await screen.findByRole('option', { name: /ceph-gold/ })
    expect(within(option).getByText('Gold')).toBeInTheDocument()
  })

  it('locks the Bandwidth fields to the policy caps and shows the Alert', async () => {
    seedPolicyHandlers()
    renderWithProviders(<AddDiskDialog {...makeProps()} />)

    await selectPoliciedStorage()
    await userEvent.click(bandwidthTab())

    expect(screen.getByRole('alert')).toHaveTextContent('Gold')
    expect(mbpsReadField()).toBeDisabled()
    expect(mbpsReadField().value).toBe('300')
  })

  it('does not push any QoS option when the selected storage is policied', async () => {
    seedPolicyHandlers()
    const props = makeProps()

    renderWithProviders(<AddDiskDialog {...props} />)

    await selectPoliciedStorage()
    await userEvent.click(addButton())

    await waitFor(() => expect(props.onSave).toHaveBeenCalled())
    const saved = props.onSave.mock.calls[0][0] as Record<string, string>

    expect(saved.scsi0).toBe('ceph-gold:32')
    expect(saved.scsi0).not.toMatch(/mbps_|iops_/)
  })

  it('keeps Bandwidth fields editable and pushes QoS keys for a non-policied storage (no regression)', async () => {
    seedPolicyHandlers()
    const props = makeProps()

    renderWithProviders(<AddDiskDialog {...props} />)

    // Default selection is the first storage returned ('local'), which
    // carries no policy.
    await waitFor(() => expect(addButton()).not.toBeDisabled())
    await userEvent.click(bandwidthTab())
    expect(mbpsReadField()).not.toBeDisabled()

    await userEvent.type(mbpsReadField(), '50')
    await userEvent.click(addButton())

    await waitFor(() => expect(props.onSave).toHaveBeenCalled())
    const saved = props.onSave.mock.calls[0][0] as Record<string, string>

    expect(saved.scsi0).toContain('mbps_rd=50')
  })
})
