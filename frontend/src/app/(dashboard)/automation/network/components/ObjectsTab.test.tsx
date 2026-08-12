/**
 * Component tests for ObjectsTab.tsx — the firewall Aliases and IP Sets tab.
 *
 * The tab is prop-driven (the objects come from the page above) and every
 * write goes through the firewall API module, which is stubbed. What matters
 * here is the round trip an operator does: read the objects, open a create
 * or edit dialog, and have the values reach PVE under the right names.
 *
 * The edit dialogs are worth their own assertions because they are seeded
 * from the row that was clicked and read back with `editingAlias?.cidr || ''`
 * — a form that renders empty on a real object, or leaks a stale one after
 * cancel, is the failure mode.
 *
 * `view` narrows the tab to one of the two sections; the network page uses it
 * to show Aliases and IP Sets under separate menu entries, so both the
 * narrowed and the combined rendering are covered.
 *
 * `window.confirm` gates the deletions and jsdom does not implement it, so it
 * is stubbed per test rather than globally.
 *
 * No automatic RTL cleanup is configured in this repo, hence afterEach.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
} from '@/__tests__/setup/renderWithProviders'
import type * as firewallAPIType from '@/lib/api/firewall'

vi.mock('@/lib/api/firewall', () => ({
  createAlias: vi.fn(),
  updateAlias: vi.fn(),
  deleteAlias: vi.fn(),
  createIPSet: vi.fn(),
  deleteIPSet: vi.fn(),
  addIPSetEntry: vi.fn(),
  deleteIPSetEntry: vi.fn(),
}))

vi.mock('@/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: vi.fn(), success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
}))

import * as firewallAPI from '@/lib/api/firewall'

import ObjectsTab from './ObjectsTab'

const api = firewallAPI as unknown as Record<string, ReturnType<typeof vi.fn>>

const CONN = 'conn-1'

const ALIASES: firewallAPIType.Alias[] = [
  { name: 'net-mgmt', cidr: '10.99.99.0/24', comment: 'management' },
  { name: 'net-dmz', cidr: '10.98.0.0/16' },
]

const IPSETS: firewallAPIType.IPSet[] = [
  { name: 'trusted', comment: 'jump hosts', members: [{ cidr: '1.2.3.4' }, { cidr: '5.6.7.8' }] },
  { name: 'blocklist', members: [] },
]

function props(overrides: Partial<React.ComponentProps<typeof ObjectsTab>> = {}) {
  return {
    aliases: ALIASES,
    ipsets: IPSETS,
    selectedConnection: CONN,
    loading: false,
    reload: vi.fn(),
    ...overrides,
  }
}

function renderTab(overrides: Parameters<typeof props>[0] = {}) {
  const p = props(overrides)

  renderWithProviders(<ObjectsTab {...p} />)

  return p
}

const rowOf = (text: string) => screen.getAllByRole('row').find(r => within(r).queryByText(text))!

const dialog = () => within(screen.getByRole('dialog'))

describe('ObjectsTab', () => {
  afterEach(cleanup)

  beforeEach(() => {
    vi.clearAllMocks()
    for (const fn of Object.values(api)) fn.mockResolvedValue?.(undefined)
  })

  it('lists the aliases with their CIDR and comment', () => {
    renderTab()

    expect(screen.getByText('2 aliases')).toBeInTheDocument()
    expect(screen.getByText('net-mgmt')).toBeInTheDocument()
    expect(screen.getByText('10.99.99.0/24')).toBeInTheDocument()
    expect(screen.getByText('management')).toBeInTheDocument()

    // An alias without a comment reads as a dash, not as blank.
    expect(within(rowOf('net-dmz')).getByText('-')).toBeInTheDocument()
  })

  it('lists the IP sets with their entries and entry count', () => {
    renderTab()

    expect(screen.getByText('2 sets • 2 entries')).toBeInTheDocument()
    expect(screen.getByText('trusted')).toBeInTheDocument()
    expect(screen.getByText('jump hosts')).toBeInTheDocument()
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument()
    expect(screen.getByText('5.6.7.8')).toBeInTheDocument()

    // A set with no comment falls back to a placeholder.
    expect(screen.getByText('No description')).toBeInTheDocument()
  })

  it('narrows to one section when the page asks for a single view', () => {
    renderTab({ view: 'aliases' })

    expect(screen.getByText('Aliases')).toBeInTheDocument()
    expect(screen.queryByText('IP Sets')).not.toBeInTheDocument()

    cleanup()

    renderTab({ view: 'ipsets' })
    expect(screen.getByText('IP Sets')).toBeInTheDocument()
    expect(screen.queryByText('Aliases')).not.toBeInTheDocument()
  })

  it('creates an alias from the New dialog', async () => {
    const p = renderTab({ view: 'aliases' })

    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    await waitFor(() => expect(screen.getByText('Create Alias')).toBeInTheDocument())

    // Create stays disabled until both the name and the CIDR are given.
    expect(dialog().getByRole('button', { name: 'Create' })).toBeDisabled()

    fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'net-new' } })
    expect(dialog().getByRole('button', { name: 'Create' })).toBeDisabled()

    fireEvent.change(dialog().getByLabelText('CIDR'), { target: { value: '10.1.0.0/24' } })
    fireEvent.change(dialog().getByLabelText('Description'), { target: { value: 'from test' } })

    fireEvent.click(dialog().getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.createAlias).toHaveBeenCalledWith(CONN, {
      name: 'net-new', cidr: '10.1.0.0/24', comment: 'from test',
    }))
    expect(p.reload).toHaveBeenCalled()
  })

  it('edits an alias CIDR, keeping its name read-only', async () => {
    renderTab({ view: 'aliases' })

    fireEvent.click(within(rowOf('net-mgmt')).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByText('Edit Alias')).toBeInTheDocument())

    // PVE identifies an alias by its name, so the form seeds it and locks it.
    expect(dialog().getByLabelText('Name')).toHaveValue('net-mgmt')
    expect(dialog().getByLabelText('Name')).toBeDisabled()
    expect(dialog().getByLabelText('CIDR')).toHaveValue('10.99.99.0/24')

    fireEvent.change(dialog().getByLabelText('CIDR'), { target: { value: '10.99.0.0/16' } })
    fireEvent.change(dialog().getByLabelText('Description'), { target: { value: 'widened' } })

    fireEvent.click(dialog().getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(api.updateAlias).toHaveBeenCalledWith(CONN, 'net-mgmt', {
      cidr: '10.99.0.0/16', comment: 'widened',
    }))
  })

  it('seeds the edit form from an alias that carries no comment', async () => {
    renderTab({ view: 'aliases' })

    fireEvent.click(within(rowOf('net-dmz')).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByText('Edit Alias')).toBeInTheDocument())

    expect(dialog().getByLabelText('CIDR')).toHaveValue('10.98.0.0/16')
    expect(dialog().getByLabelText('Description')).toHaveValue('')
  })

  it('asks the browser to confirm before deleting an alias', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    renderTab({ view: 'aliases' })

    fireEvent.click(within(rowOf('net-mgmt')).getByRole('button', { name: 'Delete' }))

    expect(confirmSpy).toHaveBeenCalledWith('Delete alias "net-mgmt"?')
    expect(api.deleteAlias).not.toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    fireEvent.click(within(rowOf('net-mgmt')).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.deleteAlias).toHaveBeenCalledWith(CONN, 'net-mgmt'))
    confirmSpy.mockRestore()
  })

  it('creates an IP set from the New dialog', async () => {
    renderTab({ view: 'ipsets' })

    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    await waitFor(() => expect(screen.getByText('Create IP Set')).toBeInTheDocument())

    expect(dialog().getByRole('button', { name: 'Create' })).toBeDisabled()

    fireEvent.change(dialog().getByLabelText('Name'), { target: { value: 'jump-hosts' } })
    fireEvent.change(dialog().getByLabelText('Description'), { target: { value: 'bastions' } })

    fireEvent.click(dialog().getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.createIPSet).toHaveBeenCalledWith(CONN, { name: 'jump-hosts', comment: 'bastions' }))
  })

  it('edits an IP set description, keeping its name read-only', async () => {
    renderTab({ view: 'ipsets' })

    const card = screen.getByText('trusted').closest('div')!

    fireEvent.click(within(card.parentElement!.parentElement!).getByRole('button', { name: 'Edit' }))
    await waitFor(() => expect(screen.getByText('Edit IP Set')).toBeInTheDocument())

    expect(dialog().getByLabelText('Name')).toHaveValue('trusted')
    expect(dialog().getByLabelText('Name')).toBeDisabled()
    expect(dialog().getByLabelText('Description')).toHaveValue('jump hosts')

    fireEvent.change(dialog().getByLabelText('Description'), { target: { value: 'renamed' } })
    expect(dialog().getByLabelText('Description')).toHaveValue('renamed')
  })

  it('adds an entry to an IP set', async () => {
    renderTab({ view: 'ipsets' })

    // Each set card carries its own Add button.
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    await waitFor(() => expect(screen.getByText('Add to trusted')).toBeInTheDocument())

    expect(dialog().getByRole('button', { name: 'Add' })).toBeDisabled()

    fireEvent.change(dialog().getByLabelText('CIDR'), { target: { value: '9.9.9.9' } })
    fireEvent.change(dialog().getByLabelText('Comment'), { target: { value: 'new bastion' } })

    fireEvent.click(dialog().getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.addIPSetEntry).toHaveBeenCalledWith(CONN, 'trusted', {
      cidr: '9.9.9.9', comment: 'new bastion',
    }))
  })

  it('deletes an IP set entry from its chip', async () => {
    renderTab({ view: 'ipsets' })

    // The chip's delete affordance is a sibling of its label.
    const chip = screen.getByText('1.2.3.4').closest('.MuiChip-root')!

    fireEvent.click(chip.querySelector('.MuiChip-deleteIcon')!)

    await waitFor(() => expect(api.deleteIPSetEntry).toHaveBeenCalledWith(CONN, 'trusted', '1.2.3.4'))
  })

  it('asks the browser to confirm before deleting an IP set', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)

    renderTab({ view: 'ipsets' })

    const card = screen.getByText('blocklist').closest('div')!

    fireEvent.click(within(card.parentElement!.parentElement!).getByRole('button', { name: 'Delete' }))

    expect(confirmSpy).toHaveBeenCalledWith('Delete IP Set "blocklist"?')
    await waitFor(() => expect(api.deleteIPSet).toHaveBeenCalledWith(CONN, 'blocklist'))
    confirmSpy.mockRestore()
  })

  it('says so when the connection has no alias and no IP set', () => {
    renderTab({ aliases: [], ipsets: [] })

    expect(screen.getByText('No alias configured')).toBeInTheDocument()
    expect(screen.getByText('No IP Set configured')).toBeInTheDocument()
  })

  it('disables creation when no connection is selected', () => {
    renderTab({ selectedConnection: '' })

    for (const button of screen.getAllByRole('button', { name: 'New' })) expect(button).toBeDisabled()
  })
})
