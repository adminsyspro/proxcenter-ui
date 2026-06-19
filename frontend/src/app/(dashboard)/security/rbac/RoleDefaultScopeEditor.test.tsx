import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import { inventoryFixture } from '@/__tests__/fixtures/inventory'
import RoleDefaultScopeEditor, { type RoleScopeEntry } from './RoleDefaultScopeEditor'

// Translate stub: return the key unchanged. The component receives `t` as a prop
// (not the next-intl hook) so no module mock is required.
const t = (k: string) => k

// Seed the inventory endpoint used by every test.
function seedInventory() {
  server.use(
    http.get('/api/v1/inventory', () => HttpResponse.json(inventoryFixture)),
  )
}

// ------------------------------------------------------------------ //
// 1. Renders existing scope entries as chips and remove deletes them
// ------------------------------------------------------------------ //
describe('RoleDefaultScopeEditor - chip rendering and removal', () => {
  beforeEach(() => {
    cleanup()
    seedInventory()
  })

  it('renders a chip for each entry in value', async () => {
    const value: RoleScopeEntry[] = [{ scopeType: 'tag', scopeTarget: 'prod' }]
    renderWithProviders(
      <RoleDefaultScopeEditor value={value} onChange={vi.fn()} t={t} />,
    )

    // After the inventory fetch resolves the chip label uses resolveScopeTargetLabel.
    // For a 'tag' type, the label is: "rbac.scopes.tag: prod" (t returns the key).
    // The chip should at minimum contain the target text.
    expect(await screen.findByText(/prod/)).toBeInTheDocument()
  })

  it('calls onChange with the entry removed when the chip delete icon is clicked', async () => {
    const onChange = vi.fn()
    const value: RoleScopeEntry[] = [{ scopeType: 'tag', scopeTarget: 'prod' }]
    const { container } = renderWithProviders(
      <RoleDefaultScopeEditor value={value} onChange={onChange} t={t} />,
    )

    // Wait for chip to appear (inventory fetch must complete first)
    await screen.findByText(/prod/)

    const chip = container.querySelector('.MuiChip-root') as HTMLElement
    expect(chip).not.toBeNull()

    const deleteBtn = chip.querySelector('.MuiChip-deleteIcon') as HTMLElement
    expect(deleteBtn).not.toBeNull()

    fireEvent.click(deleteBtn)

    expect(onChange).toHaveBeenCalledWith([])
  })

  it('shows "no scopes" caption when value is empty', () => {
    renderWithProviders(
      <RoleDefaultScopeEditor value={[]} onChange={vi.fn()} t={t} />,
    )
    // The caption uses the translation key directly via our stub.
    expect(screen.getByText('rbacPage.defaultScope.none')).toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 2. Adding a new entry: open target Select, pick option, click Add
// ------------------------------------------------------------------ //
describe('RoleDefaultScopeEditor - adding a new scope entry', () => {
  beforeEach(() => {
    cleanup()
    seedInventory()
  })

  it('calls onChange with the new entry after selecting a target and clicking Add', async () => {
    const onChange = vi.fn()
    const { container } = renderWithProviders(
      <RoleDefaultScopeEditor value={[]} onChange={onChange} t={t} />,
    )

    // The target Select is disabled={!inventory} until the inventory fetch resolves.
    // MUI adds Mui-disabled class to the Select root div when disabled.
    // Wait until that class disappears, signalling the inventory fetch is done.
    await waitFor(() => {
      const selectRoots = container.querySelectorAll('.MuiSelect-root')
      expect(selectRoots.length).toBeGreaterThanOrEqual(2)
      expect(selectRoots[1].classList.contains('Mui-disabled')).toBe(false)
    })

    // Open the target Select (second combobox).
    // MUI Select under jsdom requires fireEvent.mouseDown to open the dropdown.
    // Note: userEvent.click does not open MUI Select reliably under jsdom.
    const comboboxes = screen.getAllByRole('combobox')
    const targetCombobox = comboboxes[1]
    fireEvent.mouseDown(targetCombobox)

    // Options render in a MUI portal appended to document.body; findByRole waits.
    const option = await screen.findByRole('option', { name: /web/ })
    fireEvent.click(option)

    // Click the Add button (enabled after a target is selected).
    const addBtn = screen.getByRole('button', { name: 'common.add' })
    await waitFor(() => expect(addBtn).not.toBeDisabled())
    fireEvent.click(addBtn)

    expect(onChange).toHaveBeenCalledWith([{ scopeType: 'tag', scopeTarget: 'web' }])
  })
})

// ------------------------------------------------------------------ //
// 3. Guard: clicking Add with no target selected does not call onChange
// ------------------------------------------------------------------ //
describe('RoleDefaultScopeEditor - Add guard (no target selected)', () => {
  beforeEach(() => {
    cleanup()
    seedInventory()
  })

  it('does not call onChange when Add is clicked with no target selected', async () => {
    const onChange = vi.fn()
    renderWithProviders(
      <RoleDefaultScopeEditor value={[]} onChange={onChange} t={t} />,
    )

    // The Add button is disabled when target='', so it cannot be clicked directly.
    // Verify it is disabled - this is the guard the component enforces.
    const addBtn = screen.getByRole('button', { name: 'common.add' })
    expect(addBtn).toBeDisabled()

    expect(onChange).not.toHaveBeenCalled()
  })
})
