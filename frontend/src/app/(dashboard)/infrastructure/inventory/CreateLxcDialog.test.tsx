/**
 * Component tests for CreateLxcDialog.tsx
 *
 * Strategy: render the dialog with open={true}, seed every MSW endpoint the
 * dialog calls on mount, await data load, then assert visible output and
 * basic interactions. Context hooks that depend on live providers are mocked
 * at module level.
 *
 * Not covered here:
 *   - Full multi-tab navigation end-to-end (heavy form state across 8 tabs)
 *   - Recharts (SVG width unavailable under jsdom)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  userEvent,
} from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import {
  connections,
  nodes,
  pools,
  storage,
  networkChoices,
  templates,
} from '@/__tests__/fixtures/pveProvisioning'

import CreateLxcDialog from './CreateLxcDialog'

// ------------------------------------------------------------------ //
// Context mocks
// ------------------------------------------------------------------ //

vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ isAdmin: true }),
}))

const { useTenantMock } = vi.hoisted(() => ({ useTenantMock: vi.fn() }))
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => useTenantMock() }))

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

const CONN_ID = connections[0].id   // 'conn-1'
const NODE_NAME = nodes[0].node     // 'pve1'
// Default next-CTID fixture. This matches the client fallback's own result
// for every existing test's allVms EXCEPT the [100,101] one (which overrides
// this handler locally to 102) -- see "auto-sets CT ID to the next free ID".
const NEXT_CTID = 100

// ------------------------------------------------------------------ //
// MSW handler factory
// Seeds ALL endpoints the dialog fires on open (and on connection/node select).
// ------------------------------------------------------------------ //

function seedAllHandlers() {
  server.use(
    // 1. Connections list (type=pve)
    http.get('*/api/v1/connections', ({ request }) => {
      const url = new URL(request.url)
      if (url.searchParams.get('type') === 'pve') {
        return HttpResponse.json({ data: connections })
      }
      return HttpResponse.json({ data: [] })
    }),

    // 2. Nodes for the connection
    http.get(`*/api/v1/connections/${CONN_ID}/nodes`, () =>
      HttpResponse.json({ data: nodes }),
    ),

    // 3. Pools for the connection
    http.get(`*/api/v1/connections/${CONN_ID}/pools`, () =>
      HttpResponse.json({ data: pools }),
    ),

    // 4. Storage for the connection
    http.get(`*/api/v1/connections/${CONN_ID}/storage`, () =>
      HttpResponse.json({ data: storage }),
    ),

    // 5. Network choices for connection + node
    http.get(`*/api/v1/connections/${CONN_ID}/network-choices`, () =>
      HttpResponse.json({ data: networkChoices }),
    ),

    // 6. Template content from the node/storage
    http.get(
      `*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storage/local/content`,
      () => HttpResponse.json({ data: templates }),
    ),

    // 7. Next CT ID from the cluster API -- fired by the connection-change
    //    effect. Seeded so the suite runs quiet (no unhandled-request noise);
    //    see NEXT_CTID above for why this value was picked.
    http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
      HttpResponse.json({ data: NEXT_CTID }),
    ),
  )
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

function makeProps(overrides: Partial<Parameters<typeof CreateLxcDialog>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    allVms: [],
    ...overrides,
  }
}

/**
 * Wait for the dialog to finish loading. After loadAllData() resolves, the
 * component sets selectedNodeValue='pve1' and renders the form. The
 * CircularProgress disappears and the Node Select combobox appears.
 *
 * Combobox ordering (fixed for these tests -- hideNodePicker=false, isAdmin=true):
 *   comboboxes[0] = Node select      (rendered when !hideNodePicker)
 *   comboboxes[1] = Resource Pool select (rendered when isAdmin)
 *
 * MUI Select uses aria-labelledby for label association but jsdom's ARIA
 * name computation does not resolve aria-labelledby references for combobox
 * roles, so getByRole('combobox', {name: ...}) does not work here. We keep
 * index-based access and guard it with an explicit length assertion so that
 * any structural change (e.g. a new combobox added before the Node select)
 * fails loudly instead of silently asserting on the wrong element.
 */
async function waitForDataLoad() {
  await waitFor(() => {
    const comboboxes = screen.getAllByRole('combobox')
    // Guard: at least Node (index 0) and Resource Pool (index 1) must exist.
    expect(comboboxes.length).toBeGreaterThanOrEqual(2)
    // comboboxes[0] is the Node select; after load it shows 'pve1'.
    expect(comboboxes[0].textContent).toContain('pve1')
  })
}

beforeEach(() => {
  useTenantMock.mockReturnValue({ currentTenant: null, loading: false, isFullClusterView: true })
})

afterEach(() => {
  cleanup()
})

// ------------------------------------------------------------------ //
// 1. Dialog open / closed visibility
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - open/closed state', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('renders the dialog title when open=true', () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    expect(screen.getByText('Create: LXC Container')).toBeInTheDocument()
  })

  it('renders Cancel and Next buttons when open=true', () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    // The Next button has exact text "Next" (common.next translation).
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })

  it('renders all tab labels', () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Template' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Disks' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'CPU' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Memory' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Network' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'DNS' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('does not render the dialog title when open=false', () => {
    renderWithProviders(<CreateLxcDialog {...makeProps({ open: false })} />)
    expect(screen.queryByText('Create: LXC Container')).not.toBeInTheDocument()
  })

  it('Back button is disabled on the first tab', () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    const backBtn = screen.getByRole('button', { name: /back/i })
    expect(backBtn).toBeDisabled()
  })
})

// ------------------------------------------------------------------ //
// 2. Data load on open -- connections, nodes, pools load from MSW
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - data loads on open', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('auto-selects the first node after data loads and shows its name', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()
    // comboboxes[0] is the Node select (see waitForDataLoad comment for ordering guarantee).
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThanOrEqual(2)
    expect(comboboxes[0].textContent).toContain('pve1')
  })

  it('opens the Node Select listbox and lists the seeded node', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    // comboboxes[0] is the Node select (see waitForDataLoad comment for ordering guarantee).
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThanOrEqual(2)
    fireEvent.mouseDown(comboboxes[0])

    // The MenuItem for pve1 appears in the portal listbox.
    const option = await screen.findByRole('option', { name: /pve1/ })
    expect(option).toBeInTheDocument()
  })

  it('populates the Resource Pool selector with seeded pools', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    // comboboxes[0]=Node, comboboxes[1]=Resource Pool (see waitForDataLoad comment).
    // The length assertion is a structural guard: if a new combobox is inserted
    // before index 1 the test fails loudly rather than silently opening the wrong dropdown.
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThanOrEqual(2)
    fireEvent.mouseDown(comboboxes[1])

    // Pool items appear in the portal listbox.
    const poolDev = await screen.findByRole('option', { name: /pool-dev/ })
    expect(poolDev).toBeInTheDocument()
    const poolProd = screen.getByRole('option', { name: /pool-prod/ })
    expect(poolProd).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 3. Form input interaction
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - form inputs', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('typing in the Hostname field updates its value', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    const hostnameInput = screen.getByLabelText('Hostname') as HTMLInputElement
    expect(hostnameInput).toBeInTheDocument()
    fireEvent.change(hostnameInput, { target: { value: 'my-container' } })
    expect(hostnameInput.value).toBe('my-container')
  })

  it('CT ID field is present and accepts numeric input', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    const ctidInput = screen.getByLabelText('CT ID') as HTMLInputElement
    expect(ctidInput).toBeInTheDocument()
    fireEvent.change(ctidInput, { target: { value: '105' } })
    expect(ctidInput.value).toBe('105')
  })

  it('CT ID rejects non-numeric characters (filters them out)', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    const ctidInput = screen.getByLabelText('CT ID') as HTMLInputElement
    fireEvent.change(ctidInput, { target: { value: 'abc123xyz' } })
    // Non-numeric characters are stripped by handleCtidChange.
    expect(ctidInput.value).toBe('123')
  })

  it('CT ID below 100 shows a validation error', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    const ctidInput = screen.getByLabelText('CT ID') as HTMLInputElement
    fireEvent.change(ctidInput, { target: { value: '50' } })
    expect(screen.getByText('CT ID must be >= 100')).toBeInTheDocument()
  })

  it('CT ID in-use shows validation error when allVms contains the id', async () => {
    renderWithProviders(
      <CreateLxcDialog
        {...makeProps({ allVms: [{ vmid: '101', connId: CONN_ID, node: NODE_NAME } as any] })}
      />,
    )
    await waitForDataLoad()

    // CT ID auto-sets to next available (102 since 101 is used). Typing 101
    // manually should show the in-use error.
    const ctidInput = screen.getByLabelText('CT ID') as HTMLInputElement
    fireEvent.change(ctidInput, { target: { value: '101' } })
    expect(screen.getByText(/CT ID 101 is already in use/i)).toBeInTheDocument()
  })

  it('Unprivileged toggle is checked by default after data loads', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    // MUI Switch: find by label text then walk to the checkbox input.
    // The label text is "Unprivileged container" (from en.json).
    const label = screen.getByText('Unprivileged container')
    const formControlLabel = label.closest('.MuiFormControlLabel-root') as HTMLElement
    expect(formControlLabel).not.toBeNull()
    const switchInput = formControlLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(switchInput).not.toBeNull()
    expect(switchInput.checked).toBe(true)
  })

  it('toggling the Nesting switch enables it', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    const label = screen.getByText('Nesting')
    const formControlLabel = label.closest('.MuiFormControlLabel-root') as HTMLElement
    expect(formControlLabel).not.toBeNull()
    const switchInput = formControlLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(switchInput).not.toBeNull()
    expect(switchInput.checked).toBe(false)

    fireEvent.click(switchInput)
    expect(switchInput.checked).toBe(true)
  })
})

// ------------------------------------------------------------------ //
// 4. Cancel button
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - Cancel button', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<CreateLxcDialog {...makeProps({ onClose })} />)

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ------------------------------------------------------------------ //
// 5. Tab navigation
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - tab navigation', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('clicking Next advances from General to Template tab', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    // Use exact name 'Next' to avoid matching "Generate next available ID" icon button.
    const nextBtn = screen.getByRole('button', { name: 'Next' })
    fireEvent.click(nextBtn)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Template' }).getAttribute('aria-selected')).toBe('true')
    })
  })

  it('clicking the CPU tab renders cores UI', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'CPU' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'CPU' }).getAttribute('aria-selected')).toBe('true')
    })
    // Cores label is rendered on the CPU tab.
    expect(screen.getByText(/Cores: 1/i)).toBeInTheDocument()
  })

  it('clicking the Memory tab shows memory label', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }))

    await waitFor(() => {
      // The Memory tab renders "Memory (MiB): 512 MiB"
      expect(screen.getByText(/Memory \(MiB\):/i)).toBeInTheDocument()
    })
  })

  it('clicking the Network tab activates the Network tab and renders network fields', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Network' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Network' }).getAttribute('aria-selected')).toBe('true')
    })
    // Network tab renders the Name label (inventory.createLxc.networkName = "Name").
    // Use getByLabelText to specifically find the Name input field.
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('clicking the DNS tab activates the DNS tab and renders DNS fields', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'DNS' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'DNS' }).getAttribute('aria-selected')).toBe('true')
    })
    // DNS tab renders the DNS servers input (inventory.createLxc.dnsServers = "DNS servers").
    expect(screen.getByLabelText('DNS servers')).toBeInTheDocument()
  })

  it('clicking the Confirm tab shows the review summary', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Confirm' }))

    await waitFor(() => {
      expect(screen.getByText(/Review your settings/i)).toBeInTheDocument()
    })
  })

  it('clicking the Disks tab shows rootfs label', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Disks' }))

    await waitFor(() => {
      expect(screen.getByText('rootfs')).toBeInTheDocument()
    })
  })
})

// ------------------------------------------------------------------ //
// 6. Security section (collapsible)
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - Security section', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('expands the Security section and shows Password field', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByText('Security'))

    await waitFor(() => {
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
    })
  })

  it('shows a "Password set" chip when a password is entered', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByText('Security'))

    await waitFor(() => {
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } })

    expect(screen.getByText('Password set')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 7. Boot section (collapsible)
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - Boot section', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('expands the Boot section and shows the start-at-boot toggle', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    // The boot section header text comes from inventory.createVm.bootShutdown
    const bootHeader = screen.getByText(/Boot & Shutdown/i)
    fireEvent.click(bootHeader)

    // After expanding, the Start at boot FormControlLabel becomes visible.
    await waitFor(() => {
      expect(screen.getByText('Start at boot')).toBeInTheDocument()
    })
    // Verify it has a checkbox input.
    const label = screen.getByText('Start at boot')
    const formControlLabel = label.closest('.MuiFormControlLabel-root') as HTMLElement
    expect(formControlLabel).not.toBeNull()
    const switchInput = formControlLabel.querySelector('input[type="checkbox"]')
    expect(switchInput).not.toBeNull()
  })
})

// ------------------------------------------------------------------ //
// 8. Create button and submit flow
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - Create flow', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('shows Create button on the Confirm (last) tab', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Confirm' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
    })
  })

  it('fires onClose after a successful create from the Confirm tab', async () => {
    const onClose = vi.fn()
    const onCreated = vi.fn()

    server.use(
      http.post(`*/api/v1/connections/${CONN_ID}/guests/lxc/${NODE_NAME}`, () =>
        HttpResponse.json({ data: { upid: 'UPID:pve1:test' } }),
      ),
    )

    // Pass allVms with one vm so CTID auto-sets to 100 (next free).
    renderWithProviders(
      <CreateLxcDialog
        {...makeProps({
          onClose,
          onCreated,
          allVms: [{ vmid: '101', connId: CONN_ID, node: NODE_NAME } as any],
        })}
      />,
    )

    await waitForDataLoad()

    // Navigate to Confirm tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Confirm' }))

    await waitFor(() => {
      const createBtn = screen.getByRole('button', { name: /create/i })
      // ctid=100 (next after 101), resolvedNode=pve1 -- both set, button enabled.
      expect(createBtn).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    expect(onCreated).toHaveBeenCalledWith('100', CONN_ID, NODE_NAME)
  })

  it('shows an error when the POST returns a server error', async () => {
    server.use(
      http.post(`*/api/v1/connections/${CONN_ID}/guests/lxc/${NODE_NAME}`, () =>
        HttpResponse.json({ error: 'Out of resources' }, { status: 500 }),
      ),
    )

    renderWithProviders(
      <CreateLxcDialog
        {...makeProps({
          allVms: [{ vmid: '101', connId: CONN_ID, node: NODE_NAME } as any],
        })}
      />,
    )

    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Confirm' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => {
      expect(screen.getByText(/Out of resources/i)).toBeInTheDocument()
    })
  })
})

// ------------------------------------------------------------------ //
// 9. CT ID generation helper
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - CT ID generation', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('auto-sets CT ID to the next free ID when allVms is provided', async () => {
    // This allVms set uses up the default NEXT_CTID fixture (100), so the
    // nextid handler must be overridden to agree with the client-computed
    // next-free id (102) -- otherwise the connection-change effect's
    // server-backed fetch would clobber the correct value with a stale one.
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
        HttpResponse.json({ data: 102 }),
      ),
    )

    renderWithProviders(
      <CreateLxcDialog
        {...makeProps({
          allVms: [
            { vmid: '100', connId: CONN_ID, node: NODE_NAME } as any,
            { vmid: '101', connId: CONN_ID, node: NODE_NAME } as any,
          ],
        })}
      />,
    )
    await waitForDataLoad()

    // CT ID 100 and 101 are used, so the next free is 102.
    const ctidInput = screen.getByLabelText('CT ID') as HTMLInputElement
    expect(ctidInput.value).toBe('102')
  })

  it('re-fetches the next CT ID when the regenerate button is clicked with a connection selected', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
        HttpResponse.json({ data: 150 }),
      ),
    )

    const regenerateBtn = screen.getByRole('button', { name: 'Generate next available ID' })
    fireEvent.click(regenerateBtn)

    await waitFor(() => {
      const ctidInput = screen.getByLabelText('CT ID') as HTMLInputElement
      expect(ctidInput.value).toBe('150')
    })
  })

  it('regenerate button uses the client-side fallback when no connection is selected', async () => {
    // No connections at all -- selectedConnection stays '' so generateNextCtid
    // takes the fallbackNextCtid() branch instead of loadNextCtid().
    server.use(
      http.get('*/api/v1/connections', () => HttpResponse.json({ data: [] })),
    )

    renderWithProviders(
      <CreateLxcDialog {...makeProps({ allVms: [{ vmid: '100', connId: CONN_ID, node: NODE_NAME } as any] })} />,
    )

    const ctidInput = await screen.findByLabelText('CT ID') as HTMLInputElement
    const regenerateBtn = screen.getByRole('button', { name: 'Generate next available ID' })
    fireEvent.click(regenerateBtn)

    await waitFor(() => {
      expect(ctidInput.value).toBe('101')
    })
  })
})

// ------------------------------------------------------------------ //
// 9b. MSP tenant VMID range (#647)
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - MSP tenant VMID range', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('flags a CT ID outside the MSP tenant range', async () => {
    useTenantMock.mockReturnValue({
      currentTenant: { id: 't1', slug: 'acme', name: 'Acme', operatingModel: 'msp', vmidRangeStart: 200, vmidRangeEnd: 300 },
      loading: false,
      isFullClusterView: true,
    })
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
        HttpResponse.json({ data: 200 }),
      ),
    )

    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    const ctidInput = await screen.findByDisplayValue('200')
    fireEvent.change(ctidInput, { target: { value: '999' } })
    expect(await screen.findByText(/200-300/)).toBeInTheDocument()
  })

  it('falls back to the client-side range-aware id and reports exhaustion when nextid is unreachable', async () => {
    useTenantMock.mockReturnValue({
      currentTenant: { id: 't1', slug: 'acme', name: 'Acme', operatingModel: 'msp', vmidRangeStart: 200, vmidRangeEnd: 201 },
      loading: false,
      isFullClusterView: true,
    })
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () => HttpResponse.error()),
    )

    renderWithProviders(
      <CreateLxcDialog
        {...makeProps({
          allVms: [
            { vmid: '200', connId: CONN_ID, node: NODE_NAME } as any,
            { vmid: '201', connId: CONN_ID, node: NODE_NAME } as any,
          ],
        })}
      />,
    )
    await waitForDataLoad()

    expect(await screen.findByText(/200-201/)).toBeInTheDocument()
    const ctidInput = screen.getByLabelText('CT ID') as HTMLInputElement
    expect(ctidInput.value).toBe('')
  })

  it('surfaces the server error without falling back when nextid explicitly errors on a range tenant', async () => {
    useTenantMock.mockReturnValue({
      currentTenant: { id: 't1', slug: 'acme', name: 'Acme', operatingModel: 'msp', vmidRangeStart: 200, vmidRangeEnd: 300 },
      loading: false,
      isFullClusterView: true,
    })
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
        HttpResponse.json({ error: 'CT ID range exhausted (200-300)' }, { status: 409 }),
      ),
    )

    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    expect(await screen.findByText('CT ID range exhausted (200-300)')).toBeInTheDocument()
    const ctidInput = screen.getByLabelText('CT ID') as HTMLInputElement
    expect(ctidInput.value).toBe('')
  })
})

// ------------------------------------------------------------------ //
// 10. Template tab - seeded templates appear after data load
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - Template tab', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  /**
   * This test verifies the full template-load pipeline:
   *   1. loadStorages() finds 'local' has 'vztmpl' content and sets templateStorage='local'.
   *   2. The template-load effect fires, fetches content for node 'pve1' / storage 'local'.
   *   3. Navigating to the Template tab shows the Storage select pre-filled with 'local'
   *      and the Template select populated with the two seeded filenames from the fixture.
   *
   * Template filenames rendered by the component (tmpl.filename = last path segment of volid):
   *   - debian-12-standard_12.7-1_amd64.tar.zst
   *   - ubuntu-22.04-standard_22.04-1_amd64.tar.gz
   *
   * The fixture storage 'local' has content='rootdir,images,vztmpl' and node='pve1',
   * which is the only storage with 'vztmpl'; this is what triggers the template fetch.
   */
  it('shows seeded template filenames in the Template select after navigating to the Template tab', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()

    // Navigate to the Template tab (index 1).
    fireEvent.click(screen.getByRole('tab', { name: 'Template' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Template' }).getAttribute('aria-selected')).toBe('true')
    })

    // On the Template tab, two comboboxes are rendered:
    //   comboboxes[0] = Storage select
    //   comboboxes[1] = Template select
    // (The Node/Resource Pool selects from the General tab are no longer in the DOM.)
    //
    // Note: MUI Select aria-labelledby name computation does not resolve under
    // jsdom, so we use index-based access with an explicit length guard.
    //
    // The Storage select should be pre-filled with 'local' (the only fixture
    // storage that has 'vztmpl' content). This verifies the storage fetch ran
    // and filtered correctly -- 'local' is data-driven, not always-present text.
    await waitFor(() => {
      const comboboxes = screen.getAllByRole('combobox')
      // Guard: Storage (0) and Template (1) must both be present.
      expect(comboboxes.length).toBeGreaterThanOrEqual(2)
      // comboboxes[0] = Storage select; 'local' comes from the fixture.
      expect(comboboxes[0].textContent).toContain('local')
    })

    // Wait for the template-load effect to resolve, then open the Template select
    // to verify the seeded template filenames are present in the listbox.
    // The component fetches content from nodes/${NODE_NAME}/storage/local/content
    // and derives `filename` from the volid (last segment after '/').
    await waitFor(() => {
      const comboboxes = screen.getAllByRole('combobox')
      expect(comboboxes.length).toBeGreaterThanOrEqual(2)
      // comboboxes[1] = Template select; it is enabled when templates loaded.
      expect(comboboxes[1]).not.toBeDisabled()
    })

    // Open the Template select to reveal the option list.
    const comboboxes = screen.getAllByRole('combobox')
    fireEvent.mouseDown(comboboxes[1])

    // Both seeded template filenames must appear as options in the listbox.
    // These values come exclusively from the fixture MSW response -- not from
    // any static text that is always present on the page.
    const debianOption = await screen.findByRole('option', {
      name: /debian-12-standard_12\.7-1_amd64\.tar\.zst/,
    })
    expect(debianOption).toBeInTheDocument()

    const ubuntuOption = screen.getByRole('option', {
      name: /ubuntu-22\.04-standard_22\.04-1_amd64\.tar\.gz/,
    })
    expect(ubuntuOption).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 11. Numeric fields must be clearable (discussion #634)
//
// Every numeric field here used to be written as
//   value={n} onChange={e => setN(Number.parseInt(e.target.value) || fallback)}
// Deleting the last digit yields '', parseInt('') is NaN and `|| fallback`
// wrote the default straight back, so the input could never be empty and the
// next keystroke was appended to the number that had just snapped back
// (type 20 over a 1 and you get 120). They now use NumericTextField, which
// keeps its own string buffer and only ever hands the parent a finite number.
// ------------------------------------------------------------------ //

describe('CreateLxcDialog - clearable numeric fields', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  /** Switch tab and wait until it is actually the selected one. */
  async function goToTab(name: string) {
    fireEvent.click(screen.getByRole('tab', { name }))
    await waitFor(() => {
      expect(screen.getByRole('tab', { name }).getAttribute('aria-selected')).toBe('true')
    })
  }

  it('the disk size can be emptied, and a retyped size replaces it instead of gluing the old digit in front (discussion #634)', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()
    await goToTab('Disks')

    const diskSize = screen.getByLabelText('Disk size (GiB)') as HTMLInputElement
    expect(diskSize.value).toBe('8')

    await userEvent.clear(diskSize)
    // The reported symptom: with the old coercion this was already '1' again.
    expect(diskSize.value).toBe('')

    await userEvent.type(diskSize, '20')
    expect(diskSize.value).toBe('20')

    // The rootfs chip renders `${rootSize} GiB` from the committed state, so it
    // proves the parent got 20 -- not 120 (old digit glued in front) and not 820.
    expect(screen.getByText('20 GiB')).toBeInTheDocument()
    expect(screen.queryByText('120 GiB')).not.toBeInTheDocument()
    expect(screen.queryByText('820 GiB')).not.toBeInTheDocument()
  })

  it('a disk size left empty commits the fallback on blur, so the create payload can never carry an empty size', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()
    await goToTab('Disks')

    const diskSize = screen.getByLabelText('Disk size (GiB)') as HTMLInputElement

    await userEvent.clear(diskSize)
    expect(diskSize.value).toBe('')

    // Blur (tabbing out, or clicking Create) commits the fallback the old
    // `|| 1` coercion used, so `rootfs: ${rootStorage}:${rootSize}` always
    // interpolates a number.
    await userEvent.tab()
    expect(diskSize.value).toBe('1')
    expect(screen.getByText('1 GiB')).toBeInTheDocument()
  })

  // Cores / Memory / Swap carried exactly the same defect. The committed value
  // is asserted through the heading that mirrors it, so the test fails if the
  // parent state kept the old number.
  const clearableFields = [
    { tab: 'CPU', label: 'Cores', initial: '1', typed: '4', committed: /Cores: 4/ },
    { tab: 'Memory', label: 'Memory (MiB)', initial: '512', typed: '2048', committed: /Memory \(MiB\): 2 GiB/ },
    { tab: 'Memory', label: 'Swap (MiB)', initial: '512', typed: '256', committed: /Swap \(MiB\): 256 MiB/ },
  ]

  it.each(clearableFields)(
    '$label can be cleared and retyped without the old value gluing itself in front',
    async ({ tab, label, initial, typed, committed }) => {
      renderWithProviders(<CreateLxcDialog {...makeProps()} />)
      await waitForDataLoad()
      await goToTab(tab)

      const input = screen.getByLabelText(label) as HTMLInputElement
      expect(input.value).toBe(initial)

      await userEvent.clear(input)
      expect(input.value).toBe('')

      await userEvent.type(input, typed)
      expect(input.value).toBe(typed)
      expect(screen.getByText(committed)).toBeInTheDocument()
    },
  )

  it('the advanced CPU limit and CPU units fields are clearable too', async () => {
    renderWithProviders(<CreateLxcDialog {...makeProps()} />)
    await waitForDataLoad()
    await goToTab('CPU')

    // Both fields live behind the collapsed "Advanced Options" header.
    fireEvent.click(screen.getByText('Advanced Options'))

    const cpuLimit = screen.getByLabelText('CPU limit') as HTMLInputElement
    // 0 means "unlimited": format() renders it blank so the placeholder shows.
    expect(cpuLimit.value).toBe('')

    await userEvent.type(cpuLimit, '1')
    expect(cpuLimit.value).toBe('1')

    await userEvent.clear(cpuLimit)
    expect(cpuLimit.value).toBe('')
    // Blurring an empty CPU limit means unlimited again -- still blank, not '0'.
    await userEvent.tab()
    expect(cpuLimit.value).toBe('')

    const cpuUnits = screen.getByLabelText('CPU units') as HTMLInputElement
    expect(cpuUnits.value).toBe('1024')

    await userEvent.clear(cpuUnits)
    expect(cpuUnits.value).toBe('')

    await userEvent.type(cpuUnits, '2048')
    expect(cpuUnits.value).toBe('2048')
  })
})
