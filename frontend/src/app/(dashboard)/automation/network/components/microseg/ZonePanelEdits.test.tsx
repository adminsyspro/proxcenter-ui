/**
 * Overview sub-tab: the zone panel edits the zone, its state, its members and its flows in place (UA36), with the same
 * writes, version handling and confirmations as the Policy sub-tab, and the map follows without a manual refresh.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
import type { ReactElement } from 'react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'
import type { MicrosegFlow, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { calls, mock, policy, renderTab, reply, revisionWithSnapshot, GUESTS_ROUTE, REVISION_HEAD } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import { body, db, installFreshMocks, vm, web } from './policyTestKit'
import { flowOf, node, pathOf, setup } from './zoneMapTestKit'

installFreshMocks()

const draftAfter = (over: { zones?: MicrosegZone[]; flows?: MicrosegFlow[]; pending_members?: PendingMember[]; pending_changes?: boolean } = {}) => {
  mock.routes['GET /policy'] = () => reply(200, policy({
    zones: over.zones ?? [web(), db()], flows: over.flows ?? [], pending_members: over.pending_members ?? [],
    last_revision: REVISION_HEAD, pending_changes: over.pending_changes ?? true, version: 4,
  }))
}

async function openPanel(name = 'web') {
  fireEvent.click(await node(name === 'web' ? 'zone:zw' : 'zone:zd'))
  return screen.findByRole('complementary', { name: `Zone ${name}` })
}

const button = (scope: HTMLElement, name: string) => within(scope).getByRole('button', { name }) as HTMLButtonElement

describe('zone header actions', () => {
  it('has no way to the Policy sub-tab any more, and one row of icon actions', async () => {
    setup()
    const panel = await openPanel()
    expect(within(panel).queryByRole('button', { name: 'Edit in Policy' })).toBeNull()
    for (const name of ['Edit zone', 'Change state', 'Delete zone', 'Assign guests']) expect(button(panel, name).disabled).toBe(false)
  })

  it('edits the zone in a dialog prefilled with it, then the map shows the new color without a manual refresh', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4 })
    setup()
    const panel = await openPanel()
    fireEvent.click(button(panel, 'Edit zone'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    expect((within(dialog).getByLabelText(/^Name/) as HTMLInputElement).value).toBe('web')
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'front' } })
    draftAfter({ zones: [web({ label: 'front' }), db()] })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(calls('PUT /zones/zw')).toHaveLength(1))
    expect(body(calls('PUT /zones/zw')[0][1] as RequestInit)).toMatchObject({ version: 3, name: 'web', label: 'front' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await within(screen.getByRole('complementary', { name: 'Zone web' })).findByText('front')).toBeTruthy()
  })

  it('keeps the dialog open with the message and reloads the policy on a version conflict', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    setup()
    const panel = await openPanel()
    fireEvent.click(button(panel, 'Edit zone'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    const before = calls('GET /policy').length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText(/changed elsewhere/)).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
    expect(screen.getByRole('dialog', { name: 'Edit zone' })).toBeTruthy()
  })

  it('shows the server wording of a 400', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(400, { code: 'INVALID', error: 'label too long' })
    setup()
    fireEvent.click(button(await openPanel(), 'Edit zone'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(dialog).findByText(/label too long/)).toBeTruthy()
  })

  it('changes the state through the same confirmation as the Policy sub-tab', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, { id: 'r1', status: 'running' })
    setup({ zones: [web({ state: 'disabled' }), db()] })
    fireEvent.click(button(await openPanel(), 'Change state'))
    expect((await screen.findByRole('menuitem', { name: 'Disable' })).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Observe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Observe zone web?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Observe' }))
    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'observe' })
    expect(await screen.findByText(/web: change to observation in progress/)).toBeTruthy()
  })

  it('refuses a state change while the draft has pending changes, and offers the plan', async () => {
    setup({ zones: [web({ state: 'disabled' }), db()], pending_changes: true })
    fireEvent.click(button(await openPanel(), 'Change state'))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Observe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Observe zone web?' })
    expect(button(dialog, 'Observe').disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'View plan' })).toBeTruthy()
  })

  it('deletes the zone once confirmed, closes the panel and drops its circle', async () => {
    mock.routes['DELETE /zones/zw'] = () => reply(200, { version: 4 })
    setup()
    fireEvent.click(button(await openPanel(), 'Delete zone'))
    const dialog = await screen.findByRole('dialog', { name: 'Delete zone web?' })
    expect(calls('DELETE /zones/zw')).toHaveLength(0)
    draftAfter({ zones: [db()] })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE /zones/zw')).toHaveLength(1))
    expect(body(calls('DELETE /zones/zw')[0][1] as RequestInit)).toEqual({ version: 3 })
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull())
    await waitFor(() => expect(screen.queryByTestId('node-zone:zw')).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the panel open with the error when the deletion fails', async () => {
    mock.routes['DELETE /zones/zw'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    setup()
    fireEvent.click(button(await openPanel(), 'Delete zone'))
    const dialog = await screen.findByRole('dialog', { name: 'Delete zone web?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await within(dialog).findByText(/Another operation is running/)).toBeTruthy()
    // The open dialog hides the rest of the page from the accessibility tree.
    expect(screen.getByRole('complementary', { name: 'Zone web', hidden: true })).toBeTruthy()
  })
})

describe('members', () => {
  const tagged = [vm(100, 'web-1', ['zone-web'])]

  it('queues a removal, shows it and the pending-changes bar, then undoes it', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    mock.routes['GET /revisions?limit=1'] = () => reply(200, { revisions: [revisionWithSnapshot([web(), db()], [])] })
    setup({ vms: tagged })
    const panel = await openPanel()
    const line = await within(panel).findByRole('listitem', { name: 'web-1' })
    draftAfter({ pending_members: [{ id: 'm1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 100, zone_id: '' }] })
    fireEvent.click(button(line, 'Remove from zone'))

    await waitFor(() => expect(calls('POST /members')).toHaveLength(1))
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({ version: 3, zone_id: '', guests: [{ node: 'pve1', type: 'qemu', vmid: 100 }] })
    const queued = await within(screen.getByRole('complementary', { name: 'Zone web' })).findByRole('listitem', { name: 'web-1' })
    expect(await within(queued).findByText('Pending removal')).toBeTruthy()
    expect(await screen.findByText('1 unapplied change')).toBeTruthy()

    fireEvent.click(button(queued, 'Keep in zone'))
    await waitFor(() => expect(calls('POST /members')).toHaveLength(2))
    expect(body(calls('POST /members')[1][1] as RequestInit)).toEqual({ version: 4, zone_id: 'zw', guests: [{ node: 'pve1', type: 'qemu', vmid: 100 }] })
  })

  it('says why a removal failed', async () => {
    mock.routes['POST /members'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    setup({ vms: tagged })
    const line = await within(await openPanel()).findByRole('listitem', { name: 'web-1' })
    fireEvent.click(button(line, 'Remove from zone'))
    expect(await screen.findByText(/Another operation is running/)).toBeTruthy()
  })
})

describe('flows', () => {
  const flows = [flowOf('f1', { src_zone_id: 'zd', dst_zone_id: 'zw', dport: '80' }), flowOf('f2', { dport: '5432' })]

  const sectionOf = async (title: 'Incoming flows' | 'Outgoing flows') => within(await openPanel()).getByRole('region', { name: title })

  it('edits an incoming flow in the dialog prefilled with it', async () => {
    mock.routes['PUT /flows/f1'] = () => reply(200, { version: 4 })
    setup({ flows })
    const incoming = await sectionOf('Incoming flows')
    fireEvent.click(button(incoming, 'Edit flow'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit flow' })
    expect((within(dialog).getByLabelText(/^Port/) as HTMLInputElement).value).toBe('80')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PUT /flows/f1')).toHaveLength(1))
    expect(body(calls('PUT /flows/f1')[0][1] as RequestInit)).toMatchObject({ version: 3, src_zone_id: 'zd', dst_zone_id: 'zw', dport: '80' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('deletes an outgoing flow once confirmed', async () => {
    mock.routes['DELETE /flows/f2'] = () => reply(200, { version: 4 })
    setup({ flows })
    fireEvent.click(button(await sectionOf('Outgoing flows'), 'Delete flow'))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this flow?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE /flows/f2')).toHaveLength(1))
    expect(body(calls('DELETE /flows/f2')[0][1] as RequestInit)).toEqual({ version: 3 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('creates an incoming flow with the zone as destination, then draws its edge without a manual refresh', async () => {
    mock.routes['POST /flows'] = () => reply(200, { version: 4 })
    setup()
    fireEvent.click(button(await sectionOf('Incoming flows'), 'New incoming flow'))
    const dialog = await screen.findByRole('dialog', { name: 'New flow' })
    expect(within(dialog).getByRole('combobox', { name: 'Destination zone' }).textContent).toBe('web')
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Source zone' }))
    fireEvent.click(await screen.findByRole('option', { name: 'db' }))
    draftAfter({ flows: [flowOf('f9', { src_zone_id: 'zd', dst_zone_id: 'zw' })] })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(calls('POST /flows')).toHaveLength(1))
    expect(body(calls('POST /flows')[0][1] as RequestInit)).toMatchObject({ version: 3, src_zone_id: 'zd', dst_zone_id: 'zw', proto: 'tcp' })
    expect(await pathOf('allowed:zone:zd>zone:zw')).toBeTruthy()
  })

  it('creates an outgoing flow with the zone as source', async () => {
    setup()
    fireEvent.click(button(await sectionOf('Outgoing flows'), 'New outgoing flow'))
    const dialog = await screen.findByRole('dialog', { name: 'New flow' })
    expect(within(dialog).getByRole('combobox', { name: 'Source zone' }).textContent).toBe('web')
    expect(within(dialog).getByRole('combobox', { name: 'Destination zone' }).textContent).not.toBe('web')
  })
})

describe('read-only user', () => {
  const READ_ONLY = 'Read-only: you need node management rights'
  const rbac = (): RBACContextValue => ({
    permissions: [], roles: [], isAdmin: false, scopeTypes: [], hiddenWidgets: [], loading: false,
    hasPermission: () => false, hasAnyPermission: () => false, hasAllPermissions: () => false, hasPermissionOn: vi.fn(() => false),
    refresh: () => undefined,
  })
  const renderReadOnly = (ui: ReactElement = <MicrosegTab connectionId='c1' />) => renderTab(<RBACContext.Provider value={rbac()}>{ui}</RBACContext.Provider>)

  it('disables every write control of the panel and says why', async () => {
    window.localStorage.setItem('microseg.subTab', 'overview')
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], flows: [flowOf('f1'), flowOf('f2', { src_zone_id: 'zd', dst_zone_id: 'zw' })], last_revision: REVISION_HEAD }))
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [vm(100, 'web-1', ['zone-web'])] } })
    mock.routes['GET /suggestions?status=pending&limit=200'] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    renderReadOnly()
    const panel = await openPanel()
    await within(panel).findByRole('listitem', { name: 'web-1' })
    const names = ['Edit zone', 'Change state', 'Delete zone', 'Assign guests', 'Remove from zone', 'Edit flow', 'Delete flow', 'New incoming flow', 'New outgoing flow']
    for (const name of names) {
      for (const control of within(panel).getAllByRole('button', { name }) as HTMLButtonElement[]) expect(control.disabled, name).toBe(true)
    }
    fireEvent.mouseOver(button(panel, 'Edit zone').parentElement as HTMLElement)
    expect(await screen.findByText(READ_ONLY)).toBeTruthy()
    expect(button(panel, 'Close').disabled).toBe(false)
  })
})
