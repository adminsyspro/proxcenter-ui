/**
 * Overview sub-tab: the zone panel edits the zone, its state, its members and its flows in place (UA36), with the same
 * writes, version handling and confirmations as the Policy sub-tab, and the map follows without a manual refresh.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
import type { ReactElement } from 'react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import RBACContext, { type RBACContextValue } from '@/contexts/RBACContext'
import frMessages from '@/messages/fr.json'
import type { MicrosegFlow, MicrosegZone, PendingMember } from '@/lib/microseg/types'

import { calls, fetchMock, mock, policy, renderTab, reply, revisionWithSnapshot, BASE, GUESTS_ROUTE, REVISION_HEAD } from './microsegTestKit'
import MicrosegTab from './MicrosegTab'
import ZoneDialog from './ZoneDialog'
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

  it('shows the zone icon and name in the dialog header, the icon following the selected color', async () => {
    setup()
    fireEvent.click(button(await openPanel(), 'Edit zone'))
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    expect(within(dialog).getByTestId('zone-dialog-name').textContent).toContain('web')
    const icon = within(dialog).getByTestId('zone-dialog-icon')
    expect(icon.className).toContain('ri-shield-fill')
    const swatch = within(dialog).getAllByRole('button').find(b => /^#[0-9a-f]{6}$/i.test(b.getAttribute('aria-label') ?? '') && b.getAttribute('aria-pressed') !== 'true') as HTMLElement
    fireEvent.click(swatch)
    const probe = document.createElement('i')
    probe.style.color = swatch.getAttribute('aria-label') as string
    expect(icon.style.color).toBe(probe.style.color)
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

describe('zone dialog, state rows and Outbound section', () => {
  const IN_ROUTE = 'GET /suggestions?kind=would_block&status=pending&zone=zw&direction=in&limit=200'
  const OUT_ROUTE = 'GET /suggestions?kind=would_block&status=pending&zone=zw&direction=out&limit=200'

  const openEdit = async (zone: MicrosegZone = web(), pending = false) => {
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [zone, db()], last_revision: REVISION_HEAD, version: 3 }))
    setup({ zones: [zone, db()], pending_changes: pending })
    fireEvent.click(button(await openPanel(), 'Edit zone'))
    return screen.findByRole('dialog', { name: 'Edit zone' })
  }
  const group = (dialog: HTMLElement, name: 'Inbound' | 'Outbound') => within(dialog).getByRole('group', { name })
  const pick = (dialog: HTMLElement, name: 'Inbound' | 'Outbound', option: string) => fireEvent.click(within(group(dialog, name)).getByRole('button', { name: option }))
  const pressed = (dialog: HTMLElement, name: 'Inbound' | 'Outbound') =>
    within(group(dialog, name)).getAllByRole('button').filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
  const order = (...keys: string[]) => keys.map(key => fetchMock.mock.calls.findIndex(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${(u as string).replace(BASE, '')}` === key))

  it('shows the inbound and outbound states of the zone, the outbound filter disabled while the outbound is not controlled', async () => {
    const dialog = await openEdit()
    expect(pressed(dialog, 'Inbound')).toEqual(['Observing'])
    expect(pressed(dialog, 'Outbound')).toEqual(['Not controlled'])
    expect(within(group(dialog, 'Inbound')).getAllByRole('button').map(b => b.textContent)).toEqual(['Disabled', 'Observing', 'Blocking'])
    expect(within(group(dialog, 'Outbound')).getAllByRole('button').map(b => b.textContent)).toEqual(['Not controlled', 'Observing', 'Blocking'])
    expect(within(dialog).queryByRole('checkbox', { name: 'Control outbound traffic' })).toBeNull()
    expect((within(dialog).getByRole('radio', { name: 'Local network' }) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByRole('radio', { name: 'Local network and Internet' }) as HTMLInputElement).disabled).toBe(true)
    // The long help moved into the tooltips.
    expect(within(dialog).queryByText(/^Local network = the subnets/)).toBeNull()
    pick(dialog, 'Outbound', 'Observing')
    expect((within(dialog).getByRole('radio', { name: 'Local network and Internet' }) as HTMLInputElement).disabled).toBe(false)
  })

  it('disables the outbound of a disabled zone, says why, and shows Not controlled once the inbound is set Disabled', async () => {
    const dialog = await openEdit(web({ state: 'disabled' }))
    for (const b of within(group(dialog, 'Outbound')).getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByText('The zone must be in observation or blocking')).toBeTruthy()
    pick(dialog, 'Inbound', 'Observing')
    expect((within(group(dialog, 'Outbound')).getByRole('button', { name: 'Observing' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows Not controlled and disables the filter once the inbound of an observed zone is set Disabled', async () => {
    const observed = await openEdit(web({ egress_state: 'observe' }))
    expect(pressed(observed, 'Outbound')).toEqual(['Observing'])
    pick(observed, 'Inbound', 'Disabled')
    expect(pressed(observed, 'Outbound')).toEqual(['Not controlled'])
    expect((within(observed).getByRole('radio', { name: 'Local network' }) as HTMLInputElement).disabled).toBe(true)
  })

  it('hides the state rows of a new zone', async () => {
    renderWithProviders(<ZoneDialog zone={null} connectionId='c1' readyAfterHours={24} onSave={vi.fn()} onClose={vi.fn()} />)
    const dialog = await screen.findByRole('dialog', { name: 'New zone' })
    expect(within(dialog).queryByRole('group', { name: 'Inbound' })).toBeNull()
    expect(within(dialog).queryByRole('group', { name: 'Outbound' })).toBeNull()
  })

  it('explains each option in a tooltip: the toggles, and an info icon after the isolation and filter labels', async () => {
    const dialog = await openEdit()
    expect(within(dialog).getAllByTestId('zone-dialog-tip')).toHaveLength(3)
    fireEvent.mouseOver(within(group(dialog, 'Inbound')).getByRole('button', { name: 'Blocking' }))
    expect(await screen.findByText('Only the flows of the policy come in; the rest is blocked and visible in Blocked.')).toBeTruthy()
    fireEvent.mouseOver(within(group(dialog, 'Outbound')).getByRole('button', { name: 'Not controlled' }))
    expect(await screen.findByText('The VMs of the zone go out freely, nothing is logged.')).toBeTruthy()
    fireEvent.mouseOver(within(dialog).getAllByTestId('zone-dialog-tip')[0])
    expect(await screen.findByText(/^The VMs of this zone reach each other only through a declared flow/)).toBeTruthy()
    fireEvent.mouseOver(within(dialog).getAllByTestId('zone-dialog-tip')[2])
    expect(await screen.findByText('Filters all outbound traffic, Internet included: only the flows of the policy go through.')).toBeTruthy()
  })

  it('says the rows and the tooltips in French', async () => {
    renderWithProviders(
      <ZoneDialog zone={web({ egress_state: 'observe' })} connectionId='c1' readyAfterHours={24} onSave={vi.fn()} onClose={vi.fn()} />,
      { locale: 'fr', messages: frMessages as Record<string, unknown> },
    )
    const dialog = await screen.findByRole('dialog', { name: 'Modifier la zone' })
    expect(within(within(dialog).getByRole('group', { name: 'Entrée' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Désactivée', 'Observation', 'Blocage'])
    expect(within(within(dialog).getByRole('group', { name: 'Sortie' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Non contrôlée', 'Observation', 'Blocage'])
    fireEvent.mouseOver(within(within(dialog).getByRole('group', { name: 'Sortie' })).getByRole('button', { name: 'Blocage' }))
    expect(await screen.findByText('Seules les sorties autorisées par un flux passent ; le reste est bloqué et visible dans Bloqués.')).toBeTruthy()
    fireEvent.mouseOver(within(dialog).getAllByTestId('zone-dialog-tip')[1])
    expect(await screen.findByText('Filtre les sorties vers les sous-réseaux des VM en zone, VM sans zone comprises. Internet reste ouvert.')).toBeTruthy()
  })

  it('warns about IP filtering when Local network and Internet is chosen', async () => {
    const dialog = await openEdit(web({ egress_state: 'observe' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Local network and Internet' }))
    expect(within(dialog).getByText('IP filtering only: a service behind a domain name can change address.')).toBeTruthy()
  })

  it('asks the zone name before an inbound move to Blocking when the zone is not ready, then writes the zone and enforces it', async () => {
    mock.routes[IN_ROUTE] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, { id: 'r1', status: 'running' })
    const dialog = await openEdit(web({ observe_since: null }))
    pick(dialog, 'Inbound', 'Blocking')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Enforce zone web?' })
    expect(await within(confirm).findByText(/This zone is not ready/)).toBeTruthy()
    const go = within(confirm).getByRole('button', { name: 'Enforce' }) as HTMLButtonElement
    expect(go.disabled).toBe(true)
    fireEvent.change(within(confirm).getByLabelText('Type web to confirm'), { target: { value: 'web' } })
    expect(go.disabled).toBe(false)
    expect(calls('PUT /zones/zw')).toHaveLength(0)
    fireEvent.click(go)
    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 4, state: 'enforce' })
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
  })

  it('asks the zone name before an outbound move to Blocking when the outbound is not ready', async () => {
    mock.routes[OUT_ROUTE] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    const dialog = await openEdit(web({ egress_state: 'observe', egress_observe_since: null }))
    pick(dialog, 'Outbound', 'Blocking')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Block outbound of zone web?' })
    expect(await within(confirm).findByText(/needs 24 hours of outbound observation/)).toBeTruthy()
    expect(within(confirm).getByLabelText('Type web to confirm')).toBeTruthy()
  })

  it('reopens a blocked outbound in one click when the draft is clean', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r2' })
    mock.routes['GET /runs/r2'] = () => reply(200, { id: 'r2', status: 'running' })
    const dialog = await openEdit(web({ state: 'enforce', egress_state: 'enforce' }))
    pick(dialog, 'Outbound', 'Observing')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('POST /zones/zw/egress-state')).toHaveLength(1))
    expect(screen.queryByRole('dialog', { name: 'Reopen outbound of zone web?' })).toBeNull()
    expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 4, state: 'observe' })
    expect(await screen.findByText(/web: outbound reopening in progress/)).toBeTruthy()
  })

  it('refuses a state change while the draft was dirty before the dialog, with View plan and Discard, and writes nothing', async () => {
    const dialog = await openEdit(web({ state: 'enforce', egress_state: 'enforce' }), true)
    pick(dialog, 'Outbound', 'Observing')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const reopen = await screen.findByRole('dialog', { name: 'Reopen outbound of zone web?' })
    expect((within(reopen).getByRole('button', { name: 'Reopen outbound' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(reopen).getByRole('button', { name: 'View plan' })).toBeTruthy()
    expect(within(reopen).getByRole('button', { name: 'Discard changes' })).toBeTruthy()
    fireEvent.click(within(reopen).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Reopen outbound of zone web?' })).toBeNull())

    pick(dialog, 'Inbound', 'Disabled')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const disable = await screen.findByRole('dialog', { name: 'Disable zone web?' })
    expect((within(disable).getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(disable).getByRole('button', { name: 'View plan' })).toBeTruthy()
    expect(calls('PUT /zones/zw')).toHaveLength(0)
    expect(calls('POST /zones/zw/state')).toHaveLength(0)
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
  })

  it('applies both states in order: the inbound first, then the outbound with the version read once its run is done', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, { id: 'r1', status: 'done' })
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r2' })
    mock.routes['GET /runs/r2'] = () => reply(200, { id: 'r2', status: 'running' })
    const dialog = await openEdit(web({ state: 'disabled' }))
    pick(dialog, 'Inbound', 'Observing')
    pick(dialog, 'Outbound', 'Observing')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Change the states of zone web?' })
    expect(within(confirm).getByText('Nothing is blocked: the traffic the zone would block is logged.')).toBeTruthy()
    expect(within(confirm).getByText('The outbound traffic of the zone goes to observation.')).toBeTruthy()
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], last_revision: REVISION_HEAD, version: 5 }))
    fireEvent.click(within(confirm).getByRole('button', { name: 'Apply the states' }))
    await waitFor(() => expect(calls('POST /zones/zw/egress-state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 4, state: 'observe' })
    expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 5, state: 'observe' })
    const [put, state, run, egress] = order('PUT /zones/zw', 'POST /zones/zw/state', 'GET /runs/r1', 'POST /zones/zw/egress-state')
    expect(put).toBeLessThan(state)
    expect(state).toBeLessThan(run)
    expect(run).toBeLessThan(egress)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit zone' })).toBeNull())
  })

  it('does not send the outbound change when the inbound run fails, and says so in the dialog', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, { id: 'r1', status: 'failed', error: 'pve unreachable' })
    const dialog = await openEdit(web({ state: 'disabled' }))
    pick(dialog, 'Inbound', 'Observing')
    pick(dialog, 'Outbound', 'Observing')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Change the states of zone web?' })).getByRole('button', { name: 'Apply the states' }))
    expect(await within(dialog).findByText('The inbound state change failed: the outbound was not changed. pve unreachable')).toBeTruthy()
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
    expect(screen.getByRole('dialog', { name: 'Edit zone' })).toBeTruthy()
  })

  it('sends only the inbound change when the zone is set Disabled', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, { id: 'r1', status: 'running' })
    const dialog = await openEdit(web({ egress_state: 'observe' }))
    pick(dialog, 'Inbound', 'Disabled')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Disable zone web?' })).getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 4, state: 'disabled' })
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
  })

  it('asks first, then saves the mode and starts the outbound observation with the new version', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r2' })
    mock.routes['GET /runs/r2'] = () => reply(200, { id: 'r2', status: 'running' })
    const dialog = await openEdit()
    pick(dialog, 'Outbound', 'Observing')
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Local network and Internet' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Control outbound traffic of zone web?' })
    expect(calls('PUT /zones/zw')).toHaveLength(0)
    // The immediate-revision sentence is said once (by the gate), not again by the body.
    expect(confirm.textContent?.match(/right away/g) ?? []).toHaveLength(1)
    expect(within(confirm).getByText('The outbound traffic of the zone goes to observation.')).toBeTruthy()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Control' }))

    await waitFor(() => expect(calls('POST /zones/zw/egress-state')).toHaveLength(1))
    expect(body(calls('PUT /zones/zw')[0][1] as RequestInit)).toMatchObject({ egress_mode: 'all' })
    expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 4, state: 'observe' })
    expect(await screen.findByText(/web: outbound control in progress/)).toBeTruthy()
  })

  it('keeps the dialog usable with the error when the outbound change fails after the zone was written', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    mock.routes['POST /zones/zw/egress-state'] = () => reply(400, { code: 'INVALID', error: 'zone is disabled' })
    const dialog = await openEdit()
    pick(dialog, 'Outbound', 'Observing')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Control outbound traffic of zone web?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Control' }))
    expect(await within(dialog).findByText(/zone is disabled/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Control outbound traffic of zone web?' })).toBeNull())
    expect((within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends off once a blocked outbound is set Not controlled and confirmed', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r2' })
    mock.routes['GET /runs/r2'] = () => reply(200, { id: 'r2', status: 'running' })
    const dialog = await openEdit(web({ state: 'enforce', egress_state: 'enforce' }))
    pick(dialog, 'Outbound', 'Not controlled')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Stop controlling outbound traffic of zone web?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop controlling' }))
    await waitFor(() => expect(calls('POST /zones/zw/egress-state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 4, state: 'off' })
  })

  it('says in the confirmation that the isolation change is applied with the state change, and stays silent for the label, colour and mode', async () => {
    const dialog = await openEdit()
    pick(dialog, 'Outbound', 'Observing')
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'front' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Local network and Internet' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const quiet = await screen.findByRole('dialog', { name: 'Control outbound traffic of zone web?' })
    expect(within(quiet).queryByText('The isolation change is applied with it.')).toBeNull()
    fireEvent.click(within(quiet).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Control outbound traffic of zone web?' })).toBeNull())

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Isolate members from each other' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const confirm = await screen.findByRole('dialog', { name: 'Control outbound traffic of zone web?' })
    expect(within(confirm).getByText('The isolation change is applied with it.')).toBeTruthy()
  })

  it('gates a retry again after a version conflict, even when the draft became dirty meanwhile', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    const dialog = await openEdit()
    pick(dialog, 'Outbound', 'Observing')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const first = await screen.findByRole('dialog', { name: 'Control outbound traffic of zone web?' })
    expect((within(first).getByRole('button', { name: 'Control' }) as HTMLButtonElement).disabled).toBe(false)
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web(), db()], last_revision: REVISION_HEAD, pending_changes: true, version: 4 }))
    fireEvent.click(within(first).getByRole('button', { name: 'Control' }))
    expect(await within(dialog).findByText(/changed elsewhere and was reloaded/)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Control outbound traffic of zone web?' })).toBeNull())

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    const retry = await screen.findByRole('dialog', { name: 'Control outbound traffic of zone web?' })
    await waitFor(() => expect((within(retry).getByRole('button', { name: 'Control' }) as HTMLButtonElement).disabled).toBe(true))
    expect(calls('PUT /zones/zw')).toHaveLength(1)
  })

  it('saves without a question or a state call when only the mode changes', async () => {
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: 4, zone: web() })
    const dialog = await openEdit(web({ egress_state: 'observe' }))
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Local network and Internet' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PUT /zones/zw')).toHaveLength(1))
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
    expect(calls('POST /zones/zw/state')).toHaveLength(0)
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
    expect(await screen.findByText(/^What will change: .*1 member change$/)).toBeTruthy()

    draftAfter({ pending_members: [], pending_changes: false })
    fireEvent.click(button(queued, 'Keep in zone'))
    await waitFor(() => expect(calls('POST /members')).toHaveLength(2))
    expect(body(calls('POST /members')[1][1] as RequestInit)).toEqual({ version: 4, clear: [{ type: 'qemu', vmid: 100 }] })
    await waitFor(() => expect(screen.queryByText(/What will change/)).toBeNull())
    const kept = within(screen.getByRole('complementary', { name: 'Zone web' })).getByRole('listitem', { name: 'web-1' })
    expect(within(kept).queryByText('Pending removal')).toBeNull()
    expect(button(kept, 'Remove from zone')).toBeTruthy()
  })

  it('says why keeping a member failed on a version conflict and reads the draft again', async () => {
    mock.routes['GET /revisions?limit=1'] = () => reply(200, { revisions: [revisionWithSnapshot([web(), db()], [])] })
    setup({ vms: tagged, pending_members: [{ id: 'm1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 100, zone_id: '' }], pending_changes: true })
    mock.routes['POST /members'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    const line = await within(await openPanel()).findByRole('listitem', { name: 'web-1' })
    const before = calls('GET /policy').length
    fireEvent.click(button(line, 'Keep in zone'))
    expect(await screen.findByText(/The policy changed elsewhere/)).toBeTruthy()
    expect(calls('GET /policy').length).toBeGreaterThan(before)
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({ version: 3, clear: [{ type: 'qemu', vmid: 100 }] })
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
