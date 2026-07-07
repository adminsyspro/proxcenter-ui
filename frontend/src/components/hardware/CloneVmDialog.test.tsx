/**
 * Component tests for CloneVmDialog.tsx
 *
 * Strategy: render the dialog with open={true}, seed every MSW endpoint the
 * dialog calls on open (nodes, pools, storages, snapshots, nextid), await
 * data load, then assert visible output and representative interactions.
 * Context hooks that depend on live providers are mocked at module level.
 *
 * Provider view (isFullClusterView=true, our default mock):
 *   isProviderTenant=true => full grid form (node/storage/VMID/pool).
 *   The VMID field is pre-filled with the cluster's next free id on open
 *   (/cluster/nextid, mirroring the "New VM" screen — see #543); a "next id"
 *   button re-fetches it. A manual edit sets a flag so the async prefill never
 *   clobbers what the user typed.
 *
 * Not covered here:
 *   - Clone-from-snapshot Select (snapshot endpoint returns empty list so the
 *     picker stays hidden; the rendering branch is still executed for coverage)
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

import { nodes, pools } from '@/__tests__/fixtures/pveProvisioning'
import { CloneVmDialog } from './CloneVmDialog'

// ------------------------------------------------------------------ //
// Context mocks
// ------------------------------------------------------------------ //

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ currentTenant: null, loading: false, isFullClusterView: true }),
}))

// ------------------------------------------------------------------ //
// Constants
// ------------------------------------------------------------------ //

const CONN_ID = 'conn-1'
const NODE_NAME = 'pve1'
const NEXT_VMID = 101
const VM_ID = '100'
const VM_NAME = 'web'
const VM_TYPE = 'qemu'

// Encode the vmKey the component constructs: connId:vmType:currentNode:vmid
const VM_KEY = encodeURIComponent(`${CONN_ID}:${VM_TYPE}:${NODE_NAME}:${VM_ID}`)

// Storage fixtures: the component filters by content.includes('images') or
// specific types. 'local' has 'images' so it passes the filter.
const cloneStorage = [
  {
    storage: 'local',
    content: 'rootdir,images,vztmpl',
    type: 'dir',
    avail: 50 * 1024 * 1024 * 1024,
    total: 100 * 1024 * 1024 * 1024,
  },
  {
    storage: 'local-zfs',
    content: 'images',
    type: 'zfspool',
    avail: 200 * 1024 * 1024 * 1024,
    total: 400 * 1024 * 1024 * 1024,
  },
]

// ------------------------------------------------------------------ //
// MSW handler factory
// Seeds ALL 5 endpoints the dialog fires on open.
// ------------------------------------------------------------------ //

function seedAllHandlers() {
  server.use(
    // 1. Nodes for the connection
    http.get(`*/api/v1/connections/${CONN_ID}/nodes`, () =>
      HttpResponse.json({ data: nodes }),
    ),

    // 2. Pools for the connection
    http.get(`*/api/v1/connections/${CONN_ID}/pools`, () =>
      HttpResponse.json({ data: pools }),
    ),

    // 3. Storages for the target node
    http.get(`*/api/v1/connections/${CONN_ID}/nodes/${NODE_NAME}/storages`, () =>
      HttpResponse.json({ data: cloneStorage }),
    ),

    // 4. Snapshots for the source VM (empty list => snapshot picker stays hidden)
    http.get(`*/api/v1/guests/${VM_KEY}/snapshots`, () =>
      HttpResponse.json({ data: { snapshots: [] } }),
    ),

    // 5. Cluster next available VMID (fetched on open in both views to prefill
    //    the field, and again when the "next id" button is clicked)
    http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
      HttpResponse.json({ data: NEXT_VMID }),
    ),
  )
}

// ------------------------------------------------------------------ //
// Default props factory
// ------------------------------------------------------------------ //

function makeProps(overrides: Partial<{
  open: boolean
  onClose: ReturnType<typeof vi.fn>
  onClone: ReturnType<typeof vi.fn>
  connId: string
  currentNode: string
  vmName: string
  vmid: string
  vmType: string
  nextVmid: number
  pools: string[]
  existingVmids: number[]
}> = {}) {
  return {
    open: true,
    onClose: vi.fn(),
    onClone: vi.fn().mockResolvedValue(undefined),
    connId: CONN_ID,
    currentNode: NODE_NAME,
    vmName: VM_NAME,
    vmid: VM_ID,
    vmType: VM_TYPE,
    nextVmid: NEXT_VMID,
    pools: [],
    existingVmids: [],
    ...overrides,
  }
}

/**
 * Wait for the nodes fetch to complete so the Target node combobox shows pve1.
 *
 * In provider view (isProviderTenant=true) the component loads nodes on open
 * and populates the Target node Select. We wait until the first combobox (the
 * Target node Select) shows the seeded node name (pve1).
 *
 * MUI Select aria-labelledby name computation does not resolve under jsdom,
 * so getByRole('combobox', {name: ...}) does not work here; use index access.
 */
async function waitForDataLoad() {
  await waitFor(() => {
    const comboboxes = screen.getAllByRole('combobox')
    // In provider view there are at least: Target node (0), Target Storage (1),
    // Format (2), Resource Pool (3) comboboxes.
    expect(comboboxes.length).toBeGreaterThanOrEqual(1)
    // comboboxes[0] is the Target node select; after load it shows 'pve1'.
    expect(comboboxes[0].textContent).toContain(NODE_NAME)
  })
}

/**
 * Set the VM ID spinbutton to a given value.
 * The VM ID TextField is type="number" so its ARIA role is "spinbutton".
 * There is only one spinbutton in the provider form.
 */
function setVmid(value: string) {
  const inputs = screen.getAllByRole('spinbutton')
  expect(inputs.length).toBeGreaterThanOrEqual(1)
  fireEvent.change(inputs[0], { target: { value } })
}

afterEach(() => {
  cleanup()
})

// ------------------------------------------------------------------ //
// 1. Dialog open / closed state
// ------------------------------------------------------------------ //

describe('CloneVmDialog - open/closed state', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('renders the dialog title when open=true', () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    // Translation: hardware.cloneTitle => "Clone VM {vmName} ({vmid})"
    expect(screen.getByText(`Clone VM ${VM_NAME} (${VM_ID})`)).toBeInTheDocument()
  })

  it('renders Cancel and Clone buttons when open=true', () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^clone$/i })).toBeInTheDocument()
  })

  it('does not render dialog content when open=false', () => {
    renderWithProviders(<CloneVmDialog {...makeProps({ open: false })} />)
    expect(screen.queryByText(`Clone VM ${VM_NAME} (${VM_ID})`)).not.toBeInTheDocument()
  })

  it('prefills the VMID with the cluster next id on open and enables Clone', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // Provider view now prefills the VMID field from /cluster/nextid (#543),
    // instead of leaving it empty for a random dice pick.
    await waitFor(() => {
      const input = screen.getAllByRole('spinbutton')[0] as HTMLInputElement
      expect(input.value).toBe(String(NEXT_VMID))
    })

    // A valid prefilled id (not in existingVmids) means Clone is enabled.
    expect(screen.getByRole('button', { name: /^clone$/i })).not.toBeDisabled()
  })
})

// ------------------------------------------------------------------ //
// 2. Data load on open -- nodes load and appear in Target node Select
// ------------------------------------------------------------------ //

describe('CloneVmDialog - data loads on open', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('shows the seeded target node in the Target node Select after load', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // comboboxes[0] is the Target node select; after nodes load it contains NODE_NAME
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes[0].textContent).toContain(NODE_NAME)
  })

  it('opens Target node Select and shows seeded node as option', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThanOrEqual(1)
    fireEvent.mouseDown(comboboxes[0])

    const option = await screen.findByRole('option', { name: /pve1/ })
    expect(option).toBeInTheDocument()
  })

  it('opens Resource Pool Select and shows seeded pools as options', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // comboboxes order in provider form (4 selects visible):
    //   0: Target node, 1: Target Storage, 2: Format, 3: Resource Pool
    await waitFor(() => {
      expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(4)
    })

    const comboboxes = screen.getAllByRole('combobox')
    // Resource Pool is the 4th combobox (index 3)
    fireEvent.mouseDown(comboboxes[3])

    const poolDev = await screen.findByRole('option', { name: /pool-dev/ })
    expect(poolDev).toBeInTheDocument()
  })

  it('opens Target Storage Select and shows seeded storages as options', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    await waitFor(() => {
      expect(screen.getAllByRole('combobox').length).toBeGreaterThanOrEqual(2)
    })

    const comboboxes = screen.getAllByRole('combobox')
    // comboboxes[1] is the Target Storage select
    fireEvent.mouseDown(comboboxes[1])

    // "Same as source" is the sentinel option always at the top of the storage list
    const sameAsSource = await screen.findByRole('option', { name: /same as source/i })
    expect(sameAsSource).toBeInTheDocument()

    // The storage options from the seeded MSW response appear after the sentinel.
    // MUI renders each MenuItem text; the storage name 'local' appears inside an option.
    const options = screen.getAllByRole('option')
    const optionTexts = options.map((o) => o.textContent)
    expect(optionTexts.some((t) => t?.includes('local'))).toBe(true)
  })
})

// ------------------------------------------------------------------ //
// 3. VMID validation
// ------------------------------------------------------------------ //

describe('CloneVmDialog - VMID validation', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('shows an error and blocks Clone when VMID is in existingVmids', async () => {
    renderWithProviders(
      <CloneVmDialog {...makeProps({ existingVmids: [200] })} />,
    )
    await waitForDataLoad()

    // Enter a VMID that collides with existingVmids
    setVmid('200')

    await waitFor(() => {
      expect(screen.getByText(/VM ID 200 already in use/i)).toBeInTheDocument()
    })

    // Clone button must be disabled when vmidError is set
    const cloneBtn = screen.getByRole('button', { name: /^clone$/i })
    expect(cloneBtn).toBeDisabled()
  })

  it('Clone button is enabled when VMID is free', async () => {
    renderWithProviders(
      <CloneVmDialog {...makeProps({ existingVmids: [999] })} />,
    )
    await waitForDataLoad()

    // Set a valid VMID not in existingVmids
    setVmid('200')

    await waitFor(() => {
      const cloneBtn = screen.getByRole('button', { name: /^clone$/i })
      expect(cloneBtn).not.toBeDisabled()
    })
  })

  it('changing VMID to a value below 100 shows minimum error', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    setVmid('50')

    await waitFor(() => {
      expect(screen.getByText(/VM ID must be >= 100/i)).toBeInTheDocument()
    })

    // Clone button must be disabled when vmidError is set
    expect(screen.getByRole('button', { name: /^clone$/i })).toBeDisabled()
  })

  it('entering a valid free VMID shows no error', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    setVmid('150')

    await waitFor(() => {
      const cloneBtn = screen.getByRole('button', { name: /^clone$/i })
      expect(cloneBtn).not.toBeDisabled()
    })

    expect(screen.queryByText(/VM ID must be/i)).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 3b. Next-available VMID button (#543)
// ------------------------------------------------------------------ //

describe('CloneVmDialog - next-available VMID button', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('re-fetches /cluster/nextid on click and does not clobber a manual edit', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // User types their own id; the async open-prefill must leave it alone.
    setVmid('200')
    await waitFor(() => {
      expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('200')
    })

    // Cluster now reports a different next id; the button pulls the fresh value.
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
        HttpResponse.json({ data: 555 }),
      ),
    )

    const refreshIcon = document.querySelector('.ri-refresh-line')
    expect(refreshIcon).not.toBeNull()
    fireEvent.click(refreshIcon!.closest('button') as HTMLButtonElement)

    await waitFor(() => {
      expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('555')
    })
  })

  it('falls back to the nextVmid prop when /cluster/nextid fails on open', async () => {
    server.use(
      http.get(`*/api/v1/connections/${CONN_ID}/cluster/nextid`, () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    )

    renderWithProviders(<CloneVmDialog {...makeProps({ nextVmid: 321 })} />)
    await waitForDataLoad()

    // Endpoint down => the field degrades to the caller's estimate, never blank.
    await waitFor(() => {
      expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('321')
    })
  })
})

// ------------------------------------------------------------------ //
// 4. Full Clone toggle (provider-only)
// ------------------------------------------------------------------ //

describe('CloneVmDialog - Full Clone toggle', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('Full Clone checkbox is checked by default', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    // The "Full Clone" label walks to the nearest MuiFormControlLabel root
    const label = screen.getByText('Full Clone')
    const formControlLabel = label.closest('.MuiFormControlLabel-root') as HTMLElement
    expect(formControlLabel).not.toBeNull()
    const checkbox = formControlLabel.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox).not.toBeNull()
    expect(checkbox.checked).toBe(true)
  })

  it('unchecking Full Clone toggles to linked clone description', async () => {
    renderWithProviders(<CloneVmDialog {...makeProps()} />)
    await waitForDataLoad()

    const label = screen.getByText('Full Clone')
    const formControlLabel = label.closest('.MuiFormControlLabel-root') as HTMLElement
    const checkbox = formControlLabel.querySelector('input[type="checkbox"]') as HTMLInputElement

    // Default: full clone description visible
    expect(screen.getByText(/Creates a complete and independent copy/i)).toBeInTheDocument()

    // Uncheck -- should show the linked clone description text
    fireEvent.click(checkbox)

    await waitFor(() => {
      expect(screen.getByText(/Linked Clone:/i)).toBeInTheDocument()
    })
    expect(checkbox.checked).toBe(false)
  })
})

// ------------------------------------------------------------------ //
// 5. Clone success path
// ------------------------------------------------------------------ //

describe('CloneVmDialog - Clone success', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('calls onClone with expected params and then calls onClose on success', async () => {
    const onClone = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()

    renderWithProviders(
      <CloneVmDialog {...makeProps({ onClone, onClose })} />,
    )
    await waitForDataLoad()

    // Set a valid VMID to enable the Clone button
    setVmid('150')

    // Set a name to verify it flows through to onClone
    const nameInput = screen.getByLabelText('Name') as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'web-clone' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^clone$/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /^clone$/i }))

    await waitFor(() => {
      expect(onClone).toHaveBeenCalledTimes(1)
    })

    // Verify the key params passed to onClone
    const cloneArgs = onClone.mock.calls[0][0]
    expect(cloneArgs.targetNode).toBe(NODE_NAME)
    expect(cloneArgs.newVmid).toBe(150)
    expect(cloneArgs.name).toBe('web-clone')
    expect(cloneArgs.full).toBe(true)

    // onClose must fire after onClone resolves
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})

// ------------------------------------------------------------------ //
// 6. Clone error path
// ------------------------------------------------------------------ //

describe('CloneVmDialog - Clone error', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('shows error message and does NOT call onClose when onClone rejects', async () => {
    const onClone = vi.fn().mockRejectedValue(new Error('boom'))
    const onClose = vi.fn()

    renderWithProviders(
      <CloneVmDialog {...makeProps({ onClone, onClose })} />,
    )
    await waitForDataLoad()

    // Set a valid VMID to enable the Clone button
    setVmid('150')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^clone$/i })).not.toBeDisabled()
    })

    fireEvent.click(screen.getByRole('button', { name: /^clone$/i }))

    await waitFor(() => {
      expect(onClone).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument()
    })

    // onClose must NOT have been called after an error
    expect(onClose).not.toHaveBeenCalled()
  })
})

// ------------------------------------------------------------------ //
// 7. Cancel button
// ------------------------------------------------------------------ //

describe('CloneVmDialog - Cancel button', () => {
  beforeEach(() => {
    seedAllHandlers()
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    renderWithProviders(<CloneVmDialog {...makeProps({ onClose })} />)

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
