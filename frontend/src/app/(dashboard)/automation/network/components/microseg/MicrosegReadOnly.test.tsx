/**
 * A user without node.manage on the connection reads the tab but every write control is disabled, with the reason;
 * with the right (or while the rights load) everything is enabled.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
import type { ReactElement } from 'react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'

// The kit first: it stands in for the canvas library before the tab imports it.
import { REVISION_HEAD, mock, policy, renderTab, reply, status, zone } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { installFreshMocks, suggestion, vm } from './policyTestKit'

installFreshMocks()

const READ_ONLY = 'Read-only: you need node management rights'

function rbac(grant: boolean, loading = false): RBACContextValue {
  return {
    permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading,
    hasPermission: () => grant, hasAnyPermission: () => grant, hasAllPermissions: () => grant,
    hasPermissionOn: vi.fn((permission: string, type: string, id: string) => grant && permission === 'node.manage' && type === 'connection' && id === 'c1'),
    refresh: () => undefined,
  }
}

function renderAs(value: RBACContextValue, ui: ReactElement = <MicrosegTab connectionId='c1' connectionName='prod' />) {
  return renderTab(<RBACContext.Provider value={value}>{ui}</RBACContext.Provider>)
}

function setupPolicy() {
  window.localStorage.setItem('microseg.subTab', 'policy')
  mock.routes['GET /policy'] = () => reply(200, policy({
    zones: [zone('zw', { name: 'web' })],
    flows: [{ id: 'f1', policy_id: 'p1', src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zw', dst_cidr: '', proto: 'tcp', dport: '443', comment: '', origin: 'manual', created_by: 'me' }],
    last_revision: REVISION_HEAD,
    pending_changes: true,
  }))
  mock.routes['GET /api/v1/vms?connId=c1'] = () => reply(200, { data: { vms: [vm(100, 'web-1', ['zone-web'])] } })
}

const WRITE_BUTTONS = ['New zone', 'Change state', 'Assign guests', 'Edit zone', 'Delete zone', 'New flow', 'New flow into web', 'Edit flow', 'Delete flow', 'Emergency stop', 'View plan']

describe('read-only user', () => {
  it('disables every write control of the Policy sub-tab and says why', async () => {
    setupPolicy()
    const value = rbac(false)
    renderAs(value)
    const zoneRow = await screen.findByRole('listitem', { name: 'web' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'View plan' })).toBeTruthy())

    for (const name of WRITE_BUTTONS) {
      const button = within(name.includes('zone') && name !== 'New zone' ? zoneRow : document.body).getAllByRole('button', { name })[0] as HTMLButtonElement
      expect(button.disabled, name).toBe(true)
    }
    expect(screen.getAllByLabelText(READ_ONLY).length).toBeGreaterThanOrEqual(WRITE_BUTTONS.length)
    expect(value.hasPermissionOn).toHaveBeenCalledWith('node.manage', 'connection', 'c1')
  })

  it('keeps reading: the sub-tabs and the settings still open, with Save and Remove disabled', async () => {
    setupPolicy()
    renderAs(rbac(false))
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Micro-segmentation settings' })
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: 'Remove…' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-selected')).toBe('true')
  })

  it('disables Resume and the confirmation of held writes in the banner', async () => {
    setupPolicy()
    mock.routes['GET /status'] = () => reply(200, status({ emergency_stop: true, engine: { paused_until: null, held: true, last_runs: {}, last_log: null } }))
    renderAs(rbac(false))
    expect((await screen.findByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByRole('button', { name: 'Confirm writes' })[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('disables Accept, As CIDR and Dismiss of an observed flow, and Restore of a revision', async () => {
    window.localStorage.setItem('microseg.subTab', 'observation')
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone('zw', { name: 'web' })], last_revision: REVISION_HEAD }))
    mock.routes['GET /suggestions?limit=26&status=pending'] = () => reply(200, { suggestions: [suggestion(new Date().toISOString())], limit: 26, offset: 0 })
    renderAs(rbac(false))
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' }) as HTMLButtonElement
    expect(dismiss.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'As CIDR' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true)

    mock.routes['GET /revisions?limit=100'] = () => reply(200, { revisions: [{ ...REVISION_HEAD, snapshot: { tag_prefix: 'zone-', zones: [], flows: [] } }] })
    mock.routes['GET /runs?limit=100'] = () => reply(200, { runs: [], limit: 100, offset: 0 })
    fireEvent.click(screen.getByRole('tab', { name: 'History' }))
    const line = await screen.findByRole('row', { name: 'Version 2' })
    expect((within(line).getByRole('button', { name: 'Restore' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('user with node.manage', () => {
  it('has every write control enabled', async () => {
    setupPolicy()
    renderAs(rbac(true))
    const zoneRow = await screen.findByRole('listitem', { name: 'web' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'View plan' })).toBeTruthy())
    for (const name of WRITE_BUTTONS) {
      const button = within(name.includes('zone') && name !== 'New zone' ? zoneRow : document.body).getAllByRole('button', { name })[0] as HTMLButtonElement
      expect(button.disabled, name).toBe(false)
    }
    expect(screen.queryByLabelText(READ_ONLY)).toBeNull()
  })

  it('leaves the controls enabled while the rights are still loading', async () => {
    setupPolicy()
    renderAs(rbac(false, true))
    expect(((await screen.findAllByRole('button', { name: 'New zone' }))[0] as HTMLButtonElement).disabled).toBe(false)
  })
})
