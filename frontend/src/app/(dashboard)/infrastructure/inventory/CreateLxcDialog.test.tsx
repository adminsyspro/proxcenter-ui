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

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: null, loading: false, isFullClusterView: true }),
}))

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

const CONN_ID = connections[0].id   // 'conn-1'
const NODE_NAME = nodes[0].node     // 'pve1'

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
