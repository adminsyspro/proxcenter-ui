/**
 * The expand dialog offers the add action of each sub-tab on the tab row: members, incoming and outgoing flows of a
 * zone, declared flows of a pair; none on the suggestions; disabled without the write right.
 */

import { describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'

import { renderTab } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { installFreshMocks } from './policyTestKit'
import { flowOf, node, setup } from './zoneMapTestKit'

installFreshMocks()

async function openZoneDialog() {
  fireEvent.click(await node('zone:zd'))
  const panel = await screen.findByRole('complementary', { name: 'Zone db' })
  fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }))
  const dialog = await screen.findByRole('dialog', { name: 'Zone details · db' })
  fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }))
  return dialog
}

const subTab = (dialog: HTMLElement, name: RegExp) => fireEvent.click(within(dialog).getByRole('tab', { name }))
const combo = (name: string) => screen.getByRole('combobox', { name }).textContent

describe('expand dialog: add actions', () => {
  it('adds members from the Members sub-tab, on this zone', async () => {
    setup()
    const dialog = await openZoneDialog()
    subTab(dialog, /^Members/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add members' }))
    expect(await screen.findByRole('dialog', { name: 'Assign guests to db' })).toBeTruthy()
  })

  it('creates an incoming flow towards this zone', async () => {
    setup()
    const dialog = await openZoneDialog()
    subTab(dialog, /^Incoming flows/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'New flow' }))
    await screen.findByRole('dialog', { name: 'New flow' })
    expect(combo('Destination zone')).toBe('db')
    expect(combo('Source zone')).not.toBe('db')
  })

  it('creates an outgoing flow from this zone', async () => {
    setup()
    const dialog = await openZoneDialog()
    subTab(dialog, /^Outgoing flows/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'New flow' }))
    await screen.findByRole('dialog', { name: 'New flow' })
    expect(combo('Source zone')).toBe('db')
  })

  it('has no add button on the pending suggestions', async () => {
    setup()
    const dialog = await openZoneDialog()
    subTab(dialog, /^Pending suggestions/)
    expect(within(dialog).queryByRole('button', { name: /^(New flow|Add members)$/ })).toBeNull()
  })

  it('creates a declared flow of a pair with both ends prefilled', async () => {
    window.localStorage.setItem('microseg.map.view', 'matrix')
    setup({ flows: [flowOf('f1')] })
    await screen.findByRole('grid')
    await waitFor(() => expect(screen.getByRole('gridcell', { name: /^web to db:/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('gridcell', { name: /^web to db:/ }))
    const panel = await screen.findByRole('complementary', { name: 'Flow web to db' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Expand' }))
    const dialog = await screen.findByRole('dialog', { name: 'Flow details · web → db' })
    fireEvent.click(within(dialog).getByRole('tab', { name: 'Data' }))
    subTab(dialog, /^Declared flows/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'New flow' }))
    await screen.findByRole('dialog', { name: 'New flow' })
    expect(combo('Source zone')).toBe('web')
    expect(combo('Destination zone')).toBe('db')
  })
})

describe('expand dialog: read-only user', () => {
  const rbac = (): RBACContextValue => ({
    permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading: false,
    hasPermission: () => false, hasAnyPermission: () => false, hasAllPermissions: () => false, hasPermissionOn: vi.fn(() => false),
    refresh: () => undefined,
  })

  it('disables the add button of every sub-tab', async () => {
    setup()
    cleanup()
    renderTab(<RBACContext.Provider value={rbac()}><MicrosegTab connectionId='c1' /></RBACContext.Provider>)
    const dialog = await openZoneDialog()
    for (const [tab, name] of [[/^Members/, 'Add members'], [/^Incoming flows/, 'New flow'], [/^Outgoing flows/, 'New flow']] as const) {
      subTab(dialog, tab)
      expect((within(dialog).getByRole('button', { name }) as HTMLButtonElement).disabled, name).toBe(true)
    }
  })
})
