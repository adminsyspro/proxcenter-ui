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

// Provider path (default, reset in the top-level beforeEach below):
// currentTenant=null means isVdcTenant=false, full surface shown. Individual
// describe blocks (Task 8) override this to exercise the vDC-tenant path.
const { useTenantMock } = vi.hoisted(() => ({ useTenantMock: vi.fn() }))
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => useTenantMock(),
}))

beforeEach(() => {
  useTenantMock.mockReturnValue({ currentTenant: null, loading: false })
})

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

// ------------------------------------------------------------------ //
// 7. vDC context (Task 8): the header switcher's pc_vdc_context cookie
// wins the default target and hides the selector when it does.
//
// Strategy: an isVdcTenant + multi-vDC fixture (two vDCs, each on its own
// connection/node so we can tell which one the auto-resolve effect picked)
// with connectionId/node left unlocked (undefined) so the effect's
// "cross-PVE caller" branch runs and the selector can render. Which vDC
// got applied is observed via the connection/node the dialog fetches
// storages/resources for afterwards -- isVdcTenant mode hides every other
// infra picker, so that's the only DOM-adjacent signal available. The
// submit button only enables once connectionId+node are known, which we
// use as the "effect has resolved" wait condition.
//
// getByLabelText is unreliable for MUI Select in jsdom (see file header
// gotcha), so selector presence/absence is asserted via the InputLabel's
// rendered text ("Select vDC" -- myVdc.selectVdc in en.json) instead.
// ------------------------------------------------------------------ //

describe('RestoreVmDialog - vDC context (Task 8)', () => {
  const VDC_A_ID = 'vdc-a'
  const VDC_B_ID = 'vdc-b'
  const VDC_A_CONN = 'conn-vdc-a'
  const VDC_B_CONN = 'conn-vdc-b'
  const VDC_A_NODE = 'pve-vdc-a'
  const VDC_B_NODE = 'pve-vdc-b'

  const vdcA = {
    id: VDC_A_ID,
    name: 'vDC Paris',
    connectionId: VDC_A_CONN,
    enabled: true,
    nodes: [VDC_A_NODE],
    pbsBindings: [
      { id: 'bind-a', vdcId: VDC_A_ID, pbsConnectionId: 'pbs-a', pbsConnectionName: 'PBS A', datastore: 'ds-a', namespace: '', mode: 'auto', createdAt: '2025-01-01T00:00:00Z' },
    ],
  }
  const vdcB = {
    id: VDC_B_ID,
    name: 'vDC Frankfurt',
    connectionId: VDC_B_CONN,
    enabled: true,
    nodes: [VDC_B_NODE],
    pbsBindings: [
      { id: 'bind-b', vdcId: VDC_B_ID, pbsConnectionId: 'pbs-b', pbsConnectionName: 'PBS B', datastore: 'ds-b', namespace: '', mode: 'auto', createdAt: '2025-01-01T00:00:00Z' },
    ],
  }

  // PBS tuple matches vdc-a's binding only -- the binding heuristic (P1
  // default) would pick vdc-a. The context-cookie test sets the cookie to
  // vdc-b to prove the context overrides that heuristic.
  const backupMatchingVdcA = {
    ...backupRef,
    pbsId: 'pbs-a',
    datastore: 'ds-a',
  }

  let storagesRequests: string[] = []
  let resourcesRequests: string[] = []

  function seedVdcTenantHandlers() {
    storagesRequests = []
    resourcesRequests = []
    server.use(
      http.get('*/api/v1/vdcs', () => HttpResponse.json({ data: [vdcA, vdcB] })),
      http.get('*/api/v1/connections', ({ request }) => {
        const url = new URL(request.url)
        if (url.searchParams.get('type') === 'pve') return HttpResponse.json({ data: connections })
        return HttpResponse.json({ data: [] })
      }),
      http.get('*/api/v1/connections/:connId/nodes', () =>
        HttpResponse.json({ data: nodes }),
      ),
      http.get('*/api/v1/connections/:connId/nodes/:node/storages', ({ params }) => {
        storagesRequests.push(`${params.connId}/${params.node}`)
        return HttpResponse.json({ data: storage })
      }),
      http.get('*/api/v1/connections/:connId/resources', ({ params }) => {
        resourcesRequests.push(String(params.connId))
        return HttpResponse.json({ data: resources })
      }),
    )
  }

  function makeVdcProps(overrides: Partial<DialogProps> = {}): DialogProps {
    return {
      open: true,
      onClose: vi.fn(),
      onStarted: vi.fn(),
      // Unlocked so the "cross-PVE caller" branch of the auto-resolve
      // effect runs and the multi-vDC selector can render.
      connectionId: undefined,
      node: undefined,
      type: 'qemu',
      backup: backupMatchingVdcA,
      sourceVmid: SOURCE_VMID,
      ...overrides,
    }
  }

  function findSubmitButton() {
    return screen.getAllByRole('button').find(
      (b) => b.textContent?.trim() === 'Restore VM',
    )
  }

  beforeEach(() => {
    seedVdcTenantHandlers()
    useTenantMock.mockReturnValue({
      currentTenant: { id: 'tenant-1', slug: 'acme', name: 'Acme', operatingModel: 'iaas' },
      loading: false,
    })
  })

  afterEach(() => {
    // jsdom's document persists across tests in this file -- always clear.
    document.cookie = 'pc_vdc_context=; max-age=0'
  })

  it('defaults to the context vDC and hides the selector when pc_vdc_context is set', async () => {
    document.cookie = 'pc_vdc_context=vdc-b; path=/'

    renderWithProviders(<RestoreVmDialog {...makeVdcProps()} />)

    // Wait for the auto-resolve effect to land: canSubmit requires
    // connectionId+node, which only become non-empty once applyVdc runs.
    await waitFor(() => {
      const btn = findSubmitButton()
      expect(btn).not.toBeUndefined()
      expect(btn).not.toBeDisabled()
    })

    // 2 vDCs loaded (tenantVdcs.length > 1) yet the selector stays hidden
    // because pickedVdcId === the active context. (MUI renders the
    // InputLabel text twice -- visible label + fieldset legend -- hence
    // queryAllByText over queryByText.)
    expect(screen.queryAllByText('Select vDC')).toHaveLength(0)

    // The applied target is vdc-b (the context), not vdc-a (the binding
    // match) -- proven by which connection/node storages+resources were
    // fetched for.
    await waitFor(() => {
      expect(storagesRequests).toContain(`${VDC_B_CONN}/${VDC_B_NODE}`)
    })
    expect(storagesRequests).not.toContain(`${VDC_A_CONN}/${VDC_A_NODE}`)
    expect(resourcesRequests).toContain(VDC_B_CONN)
    expect(resourcesRequests).not.toContain(VDC_A_CONN)
  })

  it('keeps the P1 behavior (selector + binding default) without a context cookie', async () => {
    renderWithProviders(<RestoreVmDialog {...makeVdcProps()} />)

    await waitFor(() => {
      const btn = findSubmitButton()
      expect(btn).not.toBeUndefined()
      expect(btn).not.toBeDisabled()
    })

    // No context cookie: 2 vDCs loaded => the selector must render. (MUI
    // renders the InputLabel text twice -- visible label + fieldset legend.)
    expect(screen.getAllByText('Select vDC').length).toBeGreaterThan(0)

    // Default target = the PBS-binding match (vdc-a), not vdc-b.
    await waitFor(() => {
      expect(storagesRequests).toContain(`${VDC_A_CONN}/${VDC_A_NODE}`)
    })
    expect(storagesRequests).not.toContain(`${VDC_B_CONN}/${VDC_B_NODE}`)
    expect(resourcesRequests).toContain(VDC_A_CONN)
    expect(resourcesRequests).not.toContain(VDC_B_CONN)
  })
})
