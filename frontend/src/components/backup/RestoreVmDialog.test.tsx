/**
 * Component tests for RestoreVmDialog.tsx
 *
 * Strategy: render the dialog with open={true}, pass connectionId+node as
 * props so the pickers are locked and we only need to seed the endpoints
 * that actually fire. MSW is wired globally with onUnhandledRequest:'error'
 * so every on-open endpoint must be seeded in beforeEach.
 *
 * Gotchas carried over from the CreateLxc/CreateVm templates:
 *   - Dialog renders in a MUI portal: use screen.* (not container.*)
 *   - MUI Select combobox aria-labelledby not resolved by jsdom: use index
 *     access + length guard, not getByRole('combobox', {name:...}) or
 *     getByLabelText for Select elements.
 *   - Select via fireEvent.mouseDown then getByRole('option')
 *   - Await fetched content with findBy*
 *   - "Restore VM" text appears in BOTH the title div AND the submit button;
 *     use getAllByText or scope to a specific element role when asserting presence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import {
  connections,
  nodes,
  storage,
  vdcs,
  resources,
  backupRef,
} from '@/__tests__/fixtures/pveProvisioning'

import RestoreVmDialog from './RestoreVmDialog'

// ------------------------------------------------------------------ //
// Context mocks
// ------------------------------------------------------------------ //

// Provider path: currentTenant=null means isVdcTenant=false, full surface shown.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: null, loading: false }),
}))

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

const CONN_ID = connections[0].id  // 'conn-1'
const NODE_NAME = nodes[0].node    // 'pve1'
const SOURCE_VMID = 100
const UPID = 'UPID:pve1:00001234:5678ABCD:restore:100:root@pam:'

// ------------------------------------------------------------------ //
// MSW handler factory
// Seeds ALL endpoints the dialog fires on open when connectionId+node are locked.
//
// With both props locked:
//   - callerLocksConn=true => connections list fetch is skipped
//   - callerLocksNode=true => nodes list fetch is skipped
//   - isVdcTenant=false    => vdcs fetch is skipped (guard: if (!open || !isVdcTenant) return)
//   - storages + resources always fire when connectionId+node are known
//   - nextid only fires during tenant restoreAsNew submit (not seeded per-test here)
//
// We seed connections, nodes, and vdcs anyway for safety so that if the
// component renders in a path that fires them we don't get an unhandled-
// request error that masks the real failure.
// ------------------------------------------------------------------ //

function seedBaseHandlers() {
  server.use(
    // 1. vdcs -- provider path: empty list
    http.get('*/api/v1/vdcs', () =>
      HttpResponse.json({ data: vdcs }),
    ),

    // 2. connections (type=pve) -- seeded even when locked (harmless)
    http.get('*/api/v1/connections', ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.get('type') === 'pve') {
        return HttpResponse.json({ data: connections })
      }
      return HttpResponse.json({ data: [] })
    }),

    // 3. nodes for the connection (seeded even when locked, harmless)
    http.get(`*/api/v1/connections/${CONN_ID}/nodes`, () =>
      HttpResponse.json({ data: nodes }),
    ),

    // 4. storages for the node -- content param added by component (images or rootdir)
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storages`, () =>
      HttpResponse.json({ data: storage }),
    ),

    // 5. resources -- used to build the set of existing VMIDs
    http.get(`*/api/v1/connections/${CONN_ID}/resources`, () =>
      HttpResponse.json({ data: resources }),
    ),

    // 6. cluster/nextid -- only called in tenant restoreAsNew submit path
    http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
      HttpResponse.json({ data: 101 }),
    ),
  )
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

type DialogProps = Parameters<typeof RestoreVmDialog>[0]

function makeProps(overrides: Partial<DialogProps> = {}): DialogProps {
  return {
    open: true,
    onClose: vi.fn(),
    onStarted: vi.fn(),
    connectionId: CONN_ID,
    node: NODE_NAME,
    type: 'qemu',
    backup: backupRef,
    sourceVmid: SOURCE_VMID,
    ...overrides,
  }
}

/**
 * Wait for the dialog data loads to complete.
 *
 * In the provider (non-vdcTenant) path the VMID TextField is always rendered
 * with label "VMID" (common.vmId). MUI TextField emits a proper `for`
 * attribute so getByLabelText works here. Once we can find the VMID input
 * we know the component has mounted and set its initial state.
 */
async function waitForDataLoad() {
  await screen.findByLabelText('VMID')
}

afterEach(() => {
  cleanup()
})

// ------------------------------------------------------------------ //
// 1. Dialog open / closed visibility
// ------------------------------------------------------------------ //

describe('RestoreVmDialog - open/closed state', () => {
  beforeEach(() => {
    seedBaseHandlers()
  })

  it('does not render dialog content when open=false', () => {
    renderWithProviders(<RestoreVmDialog {...makeProps({ open: false })} />)
    // Dialog title div is gone; note the submit button shares the same text
    // so we scope to the dialog role which should not exist.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the dialog when open=true (qemu type)', async () => {
    renderWithProviders(<RestoreVmDialog {...makeProps({ type: 'qemu' })} />)
    // The dialog element itself must be present
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Title text is inside a heading; "Restore VM" appears in h2 (title) + button.
    // Assert the heading contains it.
    const heading = screen.getByRole('heading')
    expect(heading).toHaveTextContent('Restore VM')
  })

  it('renders Cancel and the submit button when open=true', async () => {
    renderWithProviders(<RestoreVmDialog {...makeProps()} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    // Submit button: text is "Restore VM" (inventory.pbsRestoreVm). There is
    // also a heading with that text so we target the button role specifically.
    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.trim() === 'Restore VM',
    )
    expect(submitBtn).not.toBeUndefined()
  })
})

// ------------------------------------------------------------------ //
// 2. Data load -- storages populate, VMID pre-filled
// ------------------------------------------------------------------ //

describe('RestoreVmDialog - data load on open', () => {
  beforeEach(() => {
    seedBaseHandlers()
  })

  it('pre-fills the VMID field with sourceVmid after open', async () => {
    renderWithProviders(<RestoreVmDialog {...makeProps({ sourceVmid: 100 })} />)
    await waitForDataLoad()

    // MUI TextField for VMID has a proper `for` attribute so getByLabelText works.
    const vmidInput = screen.getByLabelText('VMID') as HTMLInputElement
    expect(vmidInput.value).toBe('100')
  })

  it('opens the Target Storage select and shows a seeded storage option', async () => {
    renderWithProviders(<RestoreVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // Storage Select is rendered as a combobox. jsdom does not resolve
    // aria-labelledby so we use index access. In the provider path with
    // connectionId+node locked, the comboboxes are: [storage].
    // (connection + node pickers are hidden when callerLocksConn/Node=true)
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThanOrEqual(1)

    // The storage select is the last (and only) combobox in this configuration.
    fireEvent.mouseDown(comboboxes[comboboxes.length - 1])

    // 'local' is the first storage entry in the fixture.
    const localOption = await screen.findByRole('option', { name: /^local$/ })
    expect(localOption).toBeInTheDocument()
  })

  it('shows the backup summary info alert with source VMID', async () => {
    renderWithProviders(<RestoreVmDialog {...makeProps({ sourceVmid: 100 })} />)
    // The info Alert always renders: "VM 100 · <datetime>"
    // We can assert "VM 100" is in the document right away (no fetch needed).
    expect(screen.getByText(/VM 100/)).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 3. type branch: qemu vs lxc
// ------------------------------------------------------------------ //

describe('RestoreVmDialog - type branch', () => {
  beforeEach(() => {
    seedBaseHandlers()
  })

  it('shows "Restore VM" in the heading for type=qemu', () => {
    renderWithProviders(<RestoreVmDialog {...makeProps({ type: 'qemu' })} />)
    const heading = screen.getByRole('heading')
    expect(heading).toHaveTextContent('Restore VM')
    expect(heading).not.toHaveTextContent('Restore CT')
  })

  it('shows "Restore CT" in the heading for type=lxc', () => {
    renderWithProviders(<RestoreVmDialog {...makeProps({ type: 'lxc' })} />)
    const heading = screen.getByRole('heading')
    expect(heading).toHaveTextContent('Restore CT')
    expect(heading).not.toHaveTextContent('Restore VM')
  })

  it('renders the Live restore toggle for type=qemu but not for type=lxc', async () => {
    // qemu path -- Live restore switch is type-guarded in JSX
    const { unmount } = renderWithProviders(<RestoreVmDialog {...makeProps({ type: 'qemu' })} />)
    await waitForDataLoad()
    expect(screen.getByText('Live restore')).toBeInTheDocument()
    unmount()
    cleanup()

    // Re-seed for the second render.
    seedBaseHandlers()

    // lxc path -- Live restore switch must be absent
    renderWithProviders(<RestoreVmDialog {...makeProps({ type: 'lxc' })} />)
    await waitForDataLoad()
    expect(screen.queryByText('Live restore')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 4. Restore success: POST fires, onStarted(upid) + onClose called
// ------------------------------------------------------------------ //

describe('RestoreVmDialog - restore success', () => {
  beforeEach(() => {
    seedBaseHandlers()
  })

  it('fires the restore POST and calls onStarted(upid) + onClose on success', async () => {
    const onClose = vi.fn()
    const onStarted = vi.fn()

    // Seed the restore POST to return a UPID string under `data`.
    // Component line ~372: if (typeof j?.data === 'string') onStarted?.(j.data)
    server.use(
      http.post(
        `*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/restore`,
        async () => HttpResponse.json({ data: UPID }),
      ),
    )

    renderWithProviders(
      <RestoreVmDialog {...makeProps({ onClose, onStarted })} />,
    )

    // Wait for the VMID field to confirm the dialog is ready.
    await waitForDataLoad()

    // canSubmit = !submitting && !!connectionId && !!node && vmidValid.
    // sourceVmid=100, which is a valid VMID (100..999999999).
    // The submit button text is "Restore VM" (shared with heading); target by role.
    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.trim() === 'Restore VM',
    )
    expect(submitBtn).not.toBeUndefined()
    expect(submitBtn).not.toBeDisabled()

    fireEvent.click(submitBtn!)

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledWith(UPID)
    })
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})

// ------------------------------------------------------------------ //
// 5. Restore error: 500 POST => error shown, no onClose/onStarted
// ------------------------------------------------------------------ //

describe('RestoreVmDialog - restore error', () => {
  beforeEach(() => {
    seedBaseHandlers()
  })

  it('shows the server error text and does not call onClose/onStarted on 500', async () => {
    const onClose = vi.fn()
    const onStarted = vi.fn()

    // Seed the restore POST to fail with a 500 + error message.
    server.use(
      http.post(
        `*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/restore`,
        async () => HttpResponse.json({ error: 'no space left' }, { status: 500 }),
      ),
    )

    renderWithProviders(
      <RestoreVmDialog {...makeProps({ onClose, onStarted })} />,
    )

    await waitForDataLoad()

    const submitBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.trim() === 'Restore VM',
    )
    expect(submitBtn).not.toBeUndefined()
    expect(submitBtn).not.toBeDisabled()

    fireEvent.click(submitBtn!)

    // Error message from the server response appears in the MUI Alert.
    await waitFor(() => {
      expect(screen.getByText(/no space left/i)).toBeInTheDocument()
    })

    // onClose and onStarted must NOT have been called.
    expect(onClose).not.toHaveBeenCalled()
    expect(onStarted).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ //
// 6. Cancel button calls onClose
// ------------------------------------------------------------------ //

describe('RestoreVmDialog - Cancel button', () => {
  beforeEach(() => {
    seedBaseHandlers()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<RestoreVmDialog {...makeProps({ onClose })} />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
