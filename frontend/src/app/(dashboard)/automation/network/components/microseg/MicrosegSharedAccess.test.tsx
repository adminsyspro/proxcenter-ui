/**
 * The write rights of the tab on a shared policy: a write on the whole policy (zones, flows, states, plan and apply,
 * emergency stop, settings...) needs node.manage on every linked cluster, as the relay checks; a write on one cluster's
 * own data (members, exceptions, check, held writes) needs it on that cluster only. While the rights load, nothing of a
 * shared policy is writable (fail closed). A single cluster keeps its rules (MicrosegReadOnly.test.tsx).
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'

// The kit first: it stands in for the canvas library before the tab imports it.
import { REVISION_HEAD, mock, policy, renderTab, reply, status, zone } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { installFreshMocks, vm } from './policyTestKit'

installFreshMocks()

const EVERY_CLUSTER = 'You need node management rights on every cluster of this policy'
const READ_ONLY = 'Read-only: you need node management rights'
const C2 = '/api/v1/firewall/microseg/c2'
const CONNECTIONS = [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }]
const link = (connection_id: string) => ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null })

/** node.manage on the connections listed. */
function rbac(manage: string[], loading = false): RBACContextValue {
  return {
    permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading,
    hasPermission: () => true, hasAnyPermission: () => true, hasAllPermissions: () => true,
    hasPermissionOn: vi.fn((permission: string, type: string, id: string) => permission === 'node.manage' && type === 'connection' && manage.includes(id)),
    refresh: () => undefined,
  }
}

function setupShared(statusOver: Parameters<typeof status>[0] = {}) {
  window.localStorage.setItem('microseg.subTab', 'policy')
  mock.routes['GET /clusters'] = () => reply(200, { clusters: [link('c1'), link('c2')], max: 8 })
  mock.routes['GET /policy'] = () => reply(200, policy({
    zones: [zone('zw', { name: 'web' })],
    flows: [{ id: 'f1', policy_id: 'p1', src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zw', dst_cidr: '', proto: 'tcp', dport: '443', comment: '', origin: 'manual', created_by: 'me' }],
    last_revision: REVISION_HEAD,
    pending_changes: true,
    clusters: [link('c1'), link('c2')],
  }))
  mock.routes['GET /status'] = () => reply(200, status(statusOver))
  mock.routes[`GET ${C2}/status`] = () => reply(200, status())
  mock.routes['GET /api/v1/vms?connId=c1'] = () => reply(200, { data: { vms: [vm(100, 'web-1', ['zone-web'])] } })
  mock.routes['GET /api/v1/vms?connId=c2'] = () => reply(200, { data: { vms: [] } })
}

const renderAs = (value: RBACContextValue) =>
  renderTab(<RBACContext.Provider value={value}><MicrosegTab connectionId='c1' connectionName='PVE-PROD' connections={CONNECTIONS} /></RBACContext.Provider>)

/** The controls of the Policy sub-tab that write the whole policy. */
const POLICY_WRITES = ['New zone', 'Change state', 'Edit zone', 'Delete zone', 'New flow', 'New flow into web', 'Edit flow', 'Delete flow', 'Emergency stop', 'Review and apply']

async function policyControls() {
  const zoneRow = await screen.findByRole('listitem', { name: 'web' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review and apply' })).toBeTruthy())
  const button = (name: string) => within(name.includes('zone') && name !== 'New zone' ? zoneRow : document.body).getAllByRole('button', { name })[0] as HTMLButtonElement
  return { zoneRow, button }
}

describe('a user with node.manage on one of two linked clusters', () => {
  it('sees every write of the whole policy disabled with the generic reason, and the members of his own cluster writable', async () => {
    setupShared()
    renderAs(rbac(['c1']))
    const { zoneRow, button } = await policyControls()

    for (const name of POLICY_WRITES) expect(button(name).disabled, name).toBe(true)
    expect(screen.getAllByLabelText(EVERY_CLUSTER).length).toBeGreaterThanOrEqual(POLICY_WRITES.length)
    expect(screen.queryByLabelText(READ_ONLY)).toBeNull()
    // Assigning guests writes the members of the cluster of each guest: allowed on his own cluster.
    expect((within(zoneRow).getAllByRole('button', { name: 'Assign guests' })[0] as HTMLButtonElement).disabled).toBe(false)
  })

  it('cannot open the settings writes: Save, Remove and the association are disabled', async () => {
    setupShared()
    renderAs(rbac(['c1']))
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Micro-segmentation settings' })
    expect((within(dialog).getByRole('button', { name: 'Remove…' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('may confirm the held writes of his own cluster, not lift the emergency stop of the policy', async () => {
    setupShared({ emergency_stop: true, engine: { paused_until: null, held: true, last_runs: {}, last_log: null } })
    renderAs(rbac(['c1']))
    expect((await screen.findByRole('button', { name: 'Resume' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByRole('button', { name: 'Confirm writes' })[0] as HTMLButtonElement).disabled).toBe(false)
  })

  it('may not confirm the held writes when his right is on the other cluster only', async () => {
    setupShared({ emergency_stop: true, engine: { paused_until: null, held: true, last_runs: {}, last_log: null } })
    renderAs(rbac(['c2']))
    await screen.findByRole('button', { name: 'Resume' })
    expect((screen.getAllByRole('button', { name: 'Confirm writes' })[0] as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('a user with node.manage on every linked cluster', () => {
  it('has every write control enabled', async () => {
    setupShared()
    renderAs(rbac(['c1', 'c2']))
    const { zoneRow, button } = await policyControls()
    for (const name of POLICY_WRITES) expect(button(name).disabled, name).toBe(false)
    expect((within(zoneRow).getAllByRole('button', { name: 'Assign guests' })[0] as HTMLButtonElement).disabled).toBe(false)
    expect(screen.queryByLabelText(EVERY_CLUSTER)).toBeNull()
  })
})

describe('a shared policy while the rights load', () => {
  it('keeps every write control disabled (fail closed), never enabled first', async () => {
    setupShared()
    renderAs(rbac(['c1', 'c2'], true))
    const { zoneRow, button } = await policyControls()
    for (const name of POLICY_WRITES) expect(button(name).disabled, name).toBe(true)
    expect((within(zoneRow).getAllByRole('button', { name: 'Assign guests' })[0] as HTMLButtonElement).disabled).toBe(true)
  })
})
