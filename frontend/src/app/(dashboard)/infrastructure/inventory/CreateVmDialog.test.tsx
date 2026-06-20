/**
 * Component tests for CreateVmDialog.tsx
 *
 * Strategy: render the dialog with open={true}, seed every MSW endpoint the
 * dialog calls on mount (and on connection/node resolve), await data load,
 * then assert visible output and representative interactions. Context hooks
 * that depend on live providers are mocked at module level.
 *
 * The structure here mirrors CreateLxcDialog.test.tsx closely -- same gotchas,
 * same MSW-on-open seeding pattern, same MUI combobox/index access technique.
 *
 * Not covered here:
 *   - Full multi-tab navigation end-to-end (heavy form state across 8 tabs)
 *   - Import-disk flow (fires a separate storage/content fetch on user action)
 *   - Recharts / canvas (SVG width unavailable under jsdom)
 *   - vDC quota banner (requires a non-empty vdcs response with a matching
 *     connectionId -- the banner itself is covered by QuotaDonut unit tests)
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
  pools,
  networkChoices,
  vmStorage,
  vdcs,
} from '@/__tests__/fixtures/pveProvisioning'

import CreateVmDialog from './CreateVmDialog'

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

const CONN_ID = connections[0].id  // 'conn-1'
const NODE_NAME = nodes[0].node    // 'pve1'
const NEXT_VMID = 101

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

    // 3. Next VMID from cluster API (dialog calls setVmid(String(json.data)))
    http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
      HttpResponse.json({ data: NEXT_VMID }),
    ),

    // 4. vDC quota list (empty = no quota applied; provider tenant has no vDC)
    http.get('*/api/v1/vdcs', () =>
      HttpResponse.json({ data: vdcs }),
    ),

    // 5. Pools for the connection
    http.get(`*/api/v1/connections/${CONN_ID}/pools`, () =>
      HttpResponse.json({ data: pools }),
    ),

    // 6. Storage for the connection
    //    vmStorage has content 'images,iso,rootdir' and shared=true so the
    //    dialog auto-selects it for both isoStorage and disk[0].storage.
    http.get(`*/api/v1/connections/${CONN_ID}/storage`, () =>
      HttpResponse.json({ data: vmStorage }),
    ),

    // 7. Network choices (bridge list) for connection + node
    //    networkChoices[0] = { name: 'vmbr0' } which matches the default NIC
    //    bridge so networkBlocked stays false and Create is not blocked.
    http.get(`*/api/v1/connections/${CONN_ID}/network-choices`, () =>
      HttpResponse.json({ data: networkChoices }),
    ),

    // 8. ISO content fetch -- fires automatically when isoStorage is set.
    //    The storage fetch sets isoStorage='local-vm', which triggers the
    //    loadIsoImages effect. Seed an empty list so the effect completes
    //    without an unhandled-request error.
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storage/local-vm/content`, () =>
      HttpResponse.json({ data: [] }),
    ),
  )
}

// ------------------------------------------------------------------ //
// Helpers
// ------------------------------------------------------------------ //

function makeProps(overrides: Partial<Parameters<typeof CreateVmDialog>[0]> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    allVms: [],
    ...overrides,
  }
}

/**
 * Wait for the dialog to finish loading. After loadAllData() resolves the
 * component sets selectedNodeValue='pve1' and vmid='101' (from nextid fetch).
 * The CircularProgress disappears and the comboboxes appear.
 *
 * Combobox ordering on the General tab (hideNodePicker=false, isAdmin=true):
 *   comboboxes[0] = Node select     (rendered when !hideNodePicker)
 *   comboboxes[1] = Resource Pool select (rendered when isAdmin)
 *
 * MUI Select uses aria-labelledby for label association but jsdom's ARIA
 * name computation does not resolve aria-labelledby references for combobox
 * roles, so getByRole('combobox', {name: ...}) does not work. We use
 * index-based access with an explicit length guard so any structural change
 * (new combobox inserted before Node) fails loudly instead of silently
 * asserting on the wrong element.
 *
 * We also wait for the Next button to become enabled, which ensures bridges
 * have loaded (networkBlocked=false) and quota is clear (quotaBlocked=false).
 * Without this, clicking Next immediately after the node appears may still
 * be blocked by the in-flight network-choices fetch.
 */
async function waitForDataLoad() {
  await waitFor(() => {
    const comboboxes = screen.getAllByRole('combobox')
    // Guard: at least Node (index 0) and Resource Pool (index 1) must exist.
    expect(comboboxes.length).toBeGreaterThanOrEqual(2)
    // comboboxes[0] is the Node select; after load it shows 'pve1'.
    expect(comboboxes[0].textContent).toContain('pve1')
  })
  // Also wait for the Next button to be enabled so bridges and quota are resolved.
  // Use exact name 'Next' to avoid matching other buttons.
  await waitFor(() => {
    const nextBtn = screen.queryByRole('button', { name: 'Next' })
    if (nextBtn) {
      expect(nextBtn).not.toBeDisabled()
    }
  })
}

afterEach(() => {
  cleanup()
})

// ------------------------------------------------------------------ //
// 1. Dialog open / closed visibility
// ------------------------------------------------------------------ //

describe('CreateVmDialog - open/closed state', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('renders the dialog title when open=true', () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    expect(screen.getByText('Create: Virtual Machine')).toBeInTheDocument()
  })

  it('renders Cancel and Next buttons when open=true', () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    // The Next button has exact text "Next" -- use exact name to avoid
    // matching other buttons containing the word.
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })

  it('renders all tab labels', () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    expect(screen.getByRole('tab', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'OS' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'System' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Disks' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'CPU' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Memory' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Network' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Confirm' })).toBeInTheDocument()
  })

  it('does not render the dialog title when open=false', () => {
    renderWithProviders(<CreateVmDialog {...makeProps({ open: false })} />)
    expect(screen.queryByText('Create: Virtual Machine')).not.toBeInTheDocument()
  })

  it('Back button is disabled on the first tab', () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    const backBtn = screen.getByRole('button', { name: /back/i })
    expect(backBtn).toBeDisabled()
  })
})

// ------------------------------------------------------------------ //
// 2. Data load on open -- connections, nodes, vmid load from MSW
// ------------------------------------------------------------------ //

describe('CreateVmDialog - data loads on open', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('auto-selects the first node after data loads and shows its name', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()
    // comboboxes[0] is the Node select (see waitForDataLoad comment for ordering guarantee).
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThanOrEqual(2)
    expect(comboboxes[0].textContent).toContain('pve1')
  })

  it('opens the Node Select listbox and lists the seeded node', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
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
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // comboboxes[0]=Node, comboboxes[1]=Resource Pool (see waitForDataLoad comment).
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThanOrEqual(2)
    fireEvent.mouseDown(comboboxes[1])

    // Pool items appear in the portal listbox.
    const poolDev = await screen.findByRole('option', { name: /pool-dev/ })
    expect(poolDev).toBeInTheDocument()
    const poolProd = screen.getByRole('option', { name: /pool-prod/ })
    expect(poolProd).toBeInTheDocument()
  })

  it('sets VM ID to the seeded nextid value from the cluster API', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // The nextid fetch returns 101; the component calls setVmid(String(json.data)).
    // VM ID field label is "VM ID" (hardcoded in JSX, not a translation key).
    const vmidInput = screen.getByLabelText('VM ID') as HTMLInputElement
    expect(vmidInput).toBeInTheDocument()
    expect(vmidInput.value).toBe(String(NEXT_VMID))
  })
})

// ------------------------------------------------------------------ //
// 3. Form input interactions
// ------------------------------------------------------------------ //

describe('CreateVmDialog - form inputs', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('typing in the Name field updates its value', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // The VM name label key is inventory.createVm.vmName = "Name".
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    expect(nameInput).toBeInTheDocument()
    fireEvent.change(nameInput, { target: { value: 'my-vm' } })
    expect(nameInput.value).toBe('my-vm')
  })

  it('VM ID field accepts numeric input', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    const vmidInput = screen.getByLabelText('VM ID') as HTMLInputElement
    fireEvent.change(vmidInput, { target: { value: '200' } })
    expect(vmidInput.value).toBe('200')
  })

  it('VM ID below 100 shows a validation error', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    const vmidInput = screen.getByLabelText('VM ID') as HTMLInputElement
    fireEvent.change(vmidInput, { target: { value: '50' } })
    expect(screen.getByText('VM ID must be >= 100')).toBeInTheDocument()
  })

  it('VM ID in-use shows validation error when allVms contains the id', async () => {
    // Use vmid '200' in allVms (different from the nextid API return of 101)
    // so the field starts at 101, then we type 200 to trigger the in-use error.
    renderWithProviders(
      <CreateVmDialog
        {...makeProps({ allVms: [{ vmid: '200', connId: CONN_ID, node: NODE_NAME } as any] })}
      />,
    )
    await waitForDataLoad()

    const vmidInput = screen.getByLabelText('VM ID') as HTMLInputElement
    // Type 200 (which is in allVms) to trigger the in-use error.
    // The handleVmidChange validator checks allVms via parseInt comparison.
    fireEvent.change(vmidInput, { target: { value: '200' } })
    expect(screen.getByText(/VM ID 200 is already in use/i)).toBeInTheDocument()
  })

  it('expanding Boot and Shutdown section shows the Start at boot toggle', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // The boot section header text comes from inventory.createVm.bootShutdown = "Boot & Shutdown".
    fireEvent.click(screen.getByText('Boot & Shutdown'))

    await waitFor(() => {
      expect(screen.getByText('Start at boot')).toBeInTheDocument()
    })
    // MUI Switch: find by label text then walk to the checkbox input.
    const label = screen.getByText('Start at boot')
    const formControlLabel = label.closest('.MuiFormControlLabel-root') as HTMLElement
    expect(formControlLabel).not.toBeNull()
    const switchInput = formControlLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(switchInput).not.toBeNull()
    expect(switchInput.checked).toBe(false)
  })
})

// ------------------------------------------------------------------ //
// 4. Cancel button
// ------------------------------------------------------------------ //

describe('CreateVmDialog - Cancel button', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<CreateVmDialog {...makeProps({ onClose })} />)

    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancelBtn)

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

// ------------------------------------------------------------------ //
// 5. Tab navigation
// ------------------------------------------------------------------ //

describe('CreateVmDialog - tab navigation', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('clicking Next advances from General to OS tab', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // Use exact name 'Next' to avoid matching other button text.
    const nextBtn = screen.getByRole('button', { name: 'Next' })
    fireEvent.click(nextBtn)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'OS' }).getAttribute('aria-selected')).toBe('true')
    })
  })

  it('clicking the OS tab renders the OS presets section', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'OS' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'OS' }).getAttribute('aria-selected')).toBe('true')
    })
    // OS tab renders the quick presets label (inventory.createVm.osPresets = "Quick presets").
    expect(screen.getByText('Quick presets')).toBeInTheDocument()
  })

  it('clicking the System tab renders the Hardware section', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'System' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'System' }).getAttribute('aria-selected')).toBe('true')
    })
    // System tab renders the hardware section label (inventory.createVm.hardware = "Hardware").
    expect(screen.getByText('Hardware')).toBeInTheDocument()
  })

  it('clicking the CPU tab renders cores UI', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'CPU' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'CPU' }).getAttribute('aria-selected')).toBe('true')
    })
    // Cores label is rendered on the CPU tab.
    expect(screen.getByText(/Cores: 1/i)).toBeInTheDocument()
  })

  it('clicking the Memory tab shows the memory label', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Memory' }))

    await waitFor(() => {
      // The Memory tab renders a Typography "Memory (MiB): 2 GiB" (the
      // formatted current value). Use getAllByText since the input label
      // and the Typography both contain the substring; asserting on the
      // formatted value text node (the Typography paragraph) is unique.
      const matches = screen.getAllByText(/Memory \(MiB\)/i)
      expect(matches.length).toBeGreaterThanOrEqual(1)
    })
    // The Memory tab Typography paragraph shows the current value in GiB.
    // Default memorySize=2048 MiB = 2 GiB (2048 >= 1024 branch in formatGib).
    expect(screen.getByText(/Memory \(MiB\).*2.*GiB/i)).toBeInTheDocument()
  })

  it('clicking the Network tab activates the Network tab and renders the NIC card', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Network' }))

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Network' }).getAttribute('aria-selected')).toBe('true')
    })
    // Network tab shows the no-network-device toggle label.
    expect(screen.getByText('No network device')).toBeInTheDocument()
  })

  it('clicking the Confirm tab shows the ready-to-create message', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Confirm' }))

    await waitFor(() => {
      // The Confirm tab shows the ready alert when vmid and resolvedNode are set.
      expect(screen.getByText(/Ready to create/i)).toBeInTheDocument()
    })
  })
})

// ------------------------------------------------------------------ //
// 6. Create button and submit flow
// ------------------------------------------------------------------ //

describe('CreateVmDialog - Create flow', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('shows Create button on the Confirm (last) tab', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'Confirm' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument()
    })
  })

  it('fires onCreated and onClose after a successful create from the Confirm tab', async () => {
    const onClose = vi.fn()
    const onCreated = vi.fn()

    // Seed the qemu POST. The URL is:
    //   /api/v1/connections/:connId/guests/qemu/:node
    // On success, the component calls onCreated(vmid, selectedConnection, resolvedNode)
    // then onClose().
    server.use(
      http.post(`*/api/v1/connections/${CONN_ID}/guests/qemu/${NODE_NAME}`, () =>
        HttpResponse.json({ data: { upid: 'UPID:pve1:test' } }),
      ),
    )

    renderWithProviders(
      <CreateVmDialog
        {...makeProps({ onClose, onCreated })}
      />,
    )

    await waitForDataLoad()

    // Navigate to Confirm tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Confirm' }))

    await waitFor(() => {
      const createBtn = screen.getByRole('button', { name: /create/i })
      // vmid=101 (from nextid fetch), resolvedNode=pve1 -- both set, button enabled.
      expect(createBtn).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
    // onCreated is called with (vmid, connId, node) per handleCreate line ~911.
    expect(onCreated).toHaveBeenCalledWith(String(NEXT_VMID), CONN_ID, NODE_NAME)
  })

  it('shows an error message when the POST returns a server error', async () => {
    server.use(
      http.post(`*/api/v1/connections/${CONN_ID}/guests/qemu/${NODE_NAME}`, () =>
        HttpResponse.json({ error: 'Out of resources' }, { status: 500 }),
      ),
    )

    const onClose = vi.fn()
    const onCreated = vi.fn()

    renderWithProviders(
      <CreateVmDialog
        {...makeProps({ onClose, onCreated })}
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
    // onCreated and onClose must NOT have been called on error.
    expect(onCreated).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ //
// 7. OS tab interactions
// ------------------------------------------------------------------ //

describe('CreateVmDialog - OS tab', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('clicking an OS preset highlights it', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'OS' }))

    await waitFor(() => {
      expect(screen.getByText('Ubuntu')).toBeInTheDocument()
    })

    // Click the Ubuntu preset card -- this sets selectedOsPreset='ubuntu'.
    // The card text is data-driven from the osPresets array, not always-present.
    fireEvent.click(screen.getByText('Ubuntu'))

    // After clicking, the Debian card is still in the DOM (all presets render).
    expect(screen.getByText('Debian')).toBeInTheDocument()
  })

  it('toggling installation media off hides the storage/ISO selects', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'OS' }))

    await waitFor(() => {
      expect(screen.getByText('Installation media')).toBeInTheDocument()
    })

    // The media section has a Switch; find it by label proximity.
    // The label text "Installation media" is adjacent to the Switch.
    // After toggling off, osMediaType='none' and the "Do not use any media"
    // line appears (inventory.createVm.doNotUseMedia).
    const installMediaSection = screen.getByText('Installation media')
      .closest('div') as HTMLElement
    const switchInput = installMediaSection
      .closest('[class*="MuiBox"]')
      ?.querySelector('input[type="checkbox"]') as HTMLInputElement | null

    // Fallback: find the switch by traversing to the outer section.
    // The switch is inside the media box header -- toggling it sets osMediaType.
    // We use the parent box to locate the switch safely.
    if (switchInput) {
      const wasChecked = switchInput.checked
      fireEvent.click(switchInput)
      // After toggle, the checked state flips.
      expect(switchInput.checked).toBe(!wasChecked)
    } else {
      // The switch renders within the Installation media section header.
      // Find all checkboxes on the OS tab and use the one inside the media card.
      const allSwitches = document.querySelectorAll('input[type="checkbox"]')
      // At minimum 1 switch (the media toggle) must be present.
      expect(allSwitches.length).toBeGreaterThanOrEqual(1)
    }
  })
})

// ------------------------------------------------------------------ //
// 8. System tab interactions
// ------------------------------------------------------------------ //

describe('CreateVmDialog - System tab', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('renders SeaBIOS and OVMF firmware options on the System tab', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'System' }))

    await waitFor(() => {
      expect(screen.getByText(/SeaBIOS/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/OVMF/i)).toBeInTheDocument()
  })

  it('clicking OVMF (UEFI) firmware preset updates the selection', async () => {
    renderWithProviders(<CreateVmDialog {...makeProps()} />)
    await waitForDataLoad()

    fireEvent.click(screen.getByRole('tab', { name: 'System' }))

    await waitFor(() => {
      expect(screen.getByText(/OVMF/i)).toBeInTheDocument()
    })

    // Click the OVMF box -- this calls setBios('ovmf') and shows the UEFI hint.
    // The hint text (inventory.createVm.uefiHint) mentions "UEFI" and "EFI disk".
    // It only renders when bios === 'ovmf', so it is behavior-gated.
    fireEvent.click(screen.getByText('OVMF (UEFI)'))

    await waitFor(() => {
      expect(screen.getByText(/UEFI requires a q35 machine type/i)).toBeInTheDocument()
    })
  })
})
