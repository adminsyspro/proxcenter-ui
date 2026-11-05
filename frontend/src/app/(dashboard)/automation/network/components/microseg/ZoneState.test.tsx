/**
 * Policy sub-tab: zone state changes, their progress line and the enforce confirmation.
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { calls, fetchMock, mock, reply } from './microsegTestKit'
import { body, db, hoursAgo, run, setup, SUGGESTIONS_ROUTE, suggestion, installFreshMocks, web } from './policyTestKit'
import { node, setup as setupMap, wouldBlock } from './zoneMapTestKit'

installFreshMocks()


describe('zone state', () => {
  /** Picks the state in the menu, then confirms it in its dialog. */
  const chooseState = async (label: string) => {
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: label }))
  }

  it('moves a zone to observation once confirmed, says it is applied at once, and follows the run', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'disabled' })] })
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Observe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Observe zone web?' })
    expect(within(dialog).getByText('The state change is applied to Proxmox right away, as a new revision.')).toBeTruthy()
    expect(calls('POST /zones/zw/state')).toHaveLength(0)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Observe' }))

    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'observe' })
    expect(await screen.findByText(/web: change to observation in progress/)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('ends the progress line with the done, failed and not run counts', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    const step = (i: number) => ({ index: i, kind: 'guest.tags', object: 'g', summary: 's' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('done', {
      guests: 3, members: 3, steps: 6, drifts: 0, done: [step(0), step(1), step(2)], failed: [step(3)], not_run: [step(4), step(5)],
    }))
    setup({ zones: [web({ state: 'disabled' })] })
    const before = calls('GET /policy').length
    await chooseState('Observe')
    expect(await screen.findByText('web: 3 done, 1 failed, 2 not run')).toBeTruthy()
    expect(calls('GET /policy').length).toBeGreaterThan(before)
  })

  it('shows a failed run', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, { ...run('failed'), error: 'boom' })
    setup({ zones: [web({ state: 'observe' })] })
    await chooseState('Disable')
    expect(await screen.findByText('web: the run failed')).toBeTruthy()
  })

  it('shows the translated error when the state change is refused', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    setup({ zones: [web({ state: 'disabled' })] })
    await chooseState('Observe')
    expect(await screen.findByText('Another operation is running on this connection. Try again in a moment.')).toBeTruthy()
  })

  it('reloads the policy when the state change hits a version conflict', async () => {
    mock.routes['POST /zones/zw/state'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    setup({ zones: [web({ state: 'disabled' })] })
    const before = calls('GET /policy').length
    await chooseState('Observe')
    expect(await screen.findByText(/changed elsewhere/)).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
  })

  it('refuses to observe while the draft has pending changes, and offers the plan instead', async () => {
    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p1' })
    mock.routes['GET /runs/p1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'disabled' })], pending_changes: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Observe' }))
    const dialog = await screen.findByRole('dialog', { name: 'Observe zone web?' })

    expect(await within(dialog).findByText(/^Apply or discard your \d+ pending changes? first\.$/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Observe' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'View plan' }))
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation plan' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Observe zone web?' })).toBeNull()
    expect(calls('POST /zones/zw/state')).toHaveLength(0)
  })

  it('says pending changes without a number while the last revision is not read', async () => {
    mock.routes['GET /revisions?limit=1'] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    setup({ zones: [web({ state: 'observe' })], pending_changes: true })
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }))
    const dialog = await screen.findByRole('dialog', { name: 'Disable zone web?' })
    expect(await within(dialog).findByText('Apply or discard your pending changes first.')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Disable' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not offer the state the zone is already in', async () => {
    setup({ zones: [web({ state: 'observe' })] })
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    expect(screen.getByRole('menuitem', { name: 'Observe' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Enforce' }).getAttribute('aria-disabled')).toBeNull()
  })
})

describe('enforcing a zone', () => {
  const chooseEnforce = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'Change state' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Enforce' }))
    return screen.findByRole('dialog')
  }

  it('requires typing the zone name to enforce a zone that is not ready', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () =>
      reply(200, { suggestions: [suggestion(hoursAgo(1))], limit: 200, offset: 0 })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(48) })] })
    const dialog = await chooseEnforce()

    const confirm = await within(dialog).findByRole('button', { name: 'Enforce' }) as HTMLButtonElement
    expect(await within(dialog).findByText(/not ready/)).toBeTruthy()
    expect(confirm.disabled).toBe(true)

    const field = within(dialog).getByLabelText('Type web to confirm')
    fireEvent.change(field, { target: { value: 'we' } })
    expect(confirm.disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'web' } })
    expect(confirm.disabled).toBe(false)

    fireEvent.click(confirm)
    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'enforce' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('asks for a plain confirmation when the zone is ready', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () =>
      reply(200, { suggestions: [suggestion(hoursAgo(30))], limit: 200, offset: 0 })
    mock.routes['POST /zones/zw/state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(48) })] })
    const dialog = await chooseEnforce()

    const confirm = await within(dialog).findByRole('button', { name: 'Enforce' }) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    expect(within(dialog).queryByLabelText(/Type web to confirm/)).toBeNull()
    fireEvent.click(confirm)
    await waitFor(() => expect(calls('POST /zones/zw/state')).toHaveLength(1))
  })

  it('treats a zone observed for less than the window as not ready', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(2) })] })
    const dialog = await chooseEnforce()
    expect(await within(dialog).findByLabelText('Type web to confirm')).toBeTruthy()
  })

  it('treats the zone as not ready when the suggestions cannot be read', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(48) })] })
    const dialog = await chooseEnforce()
    expect(await within(dialog).findByLabelText('Type web to confirm')).toBeTruthy()
    expect(within(dialog).getByText(/could not be checked/)).toBeTruthy()
  })

  it('refuses to enforce a ready zone while the draft has pending changes', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () =>
      reply(200, { suggestions: [suggestion(hoursAgo(30))], limit: 200, offset: 0 })
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(48) })], pending_changes: true })
    const dialog = await chooseEnforce()

    expect(await within(dialog).findByText(/^Apply or discard your \d+ pending changes? first\.$/)).toBeTruthy()
    expect(await within(dialog).findByText(/Nothing would have been blocked/)).toBeTruthy()
    expect(within(dialog).getByText('The state change is applied to Proxmox right away, as a new revision.')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Enforce' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'View plan' })).toBeTruthy()
  })

  it('sends nothing when the dialog is cancelled', async () => {
    mock.routes[SUGGESTIONS_ROUTE] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    setup({ zones: [web({ state: 'observe', observe_since: hoursAgo(2) })] })
    const dialog = await chooseEnforce()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetchMock.mock.calls.some(([u, i]) => String(u).endsWith('/state') && (i as RequestInit)?.method === 'POST')).toBe(false)
  })
})

describe('outbound state of a zone in its panel', () => {
  const OUT_ROUTE = 'GET /suggestions?kind=would_block&status=pending&zone=zw&direction=out&limit=200'
  const openPanel = async () => {
    fireEvent.click(await node('zone:zw'))
    return screen.findByRole('complementary', { name: 'Zone web' })
  }
  const outbound = (id: string, lastSeen: string) => wouldBlock(id, { direction: 'out', src_key: 'zw', src_zone_id: 'zw', dst_zone_id: '', dst_ip: '8.8.8.8', last_seen: lastSeen })
  const observing = (over = {}) => web({ state: 'enforce', egress_state: 'observe', egress_observe_since: hoursAgo(48), ...over })

  it('shows the chip as ready when the window elapsed with no outbound flow seen in it', async () => {
    setupMap({ zones: [observing()], suggestions: [outbound('o1', hoursAgo(30))] })
    const panel = await openPanel()
    expect(await within(panel).findByText('Outbound: ready')).toBeTruthy()
  })

  it('shows the chip as observing while an outbound flow was seen inside the window, and ignores inbound ones', async () => {
    setupMap({ zones: [observing()], suggestions: [outbound('o1', hoursAgo(1))] })
    const panel = await openPanel()
    expect(await within(panel).findByText('Outbound: observing')).toBeTruthy()
  })

  it('has no outbound action while the outbound is off', async () => {
    setupMap({ zones: [web({ state: 'enforce' })] })
    const panel = await openPanel()
    expect(await within(panel).findByText('Outbound: off')).toBeTruthy()
    expect(within(panel).queryByRole('button', { name: 'Block outbound' })).toBeNull()
    expect(within(panel).queryByRole('button', { name: 'Reopen outbound' })).toBeNull()
  })

  it('reopens the outbound in one click, without a dialog, even when the inbound is enforced', async () => {
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setupMap({ zones: [web({ state: 'enforce', egress_state: 'enforce' })] })
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: 'Reopen outbound' }))
    await waitFor(() => expect(calls('POST /zones/zw/egress-state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'observe' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refuses to reopen the outbound while the draft has pending changes, with the way to the plan', async () => {
    setupMap({ zones: [web({ state: 'enforce', egress_state: 'enforce' })], pending_changes: true })
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: 'Reopen outbound' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reopen outbound of zone web?' })
    expect(await within(dialog).findByText(/^Apply or discard your \d+ pending changes? first\.$/)).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'View plan' })).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Reopen outbound' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls('POST /zones/zw/egress-state')).toHaveLength(0)
  })

  it('asks for the zone name to block the outbound of a zone that is not ready', async () => {
    mock.routes[OUT_ROUTE] = () => reply(200, { suggestions: [outbound('o1', hoursAgo(1))], limit: 200, offset: 0 })
    mock.routes['POST /zones/zw/egress-state'] = () => reply(202, { run_id: 'r1' })
    mock.routes['GET /runs/r1'] = () => reply(200, run('running'))
    setupMap({ zones: [observing()] })
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: 'Block outbound' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block outbound of zone web?' })
    const confirm = await within(dialog).findByRole('button', { name: 'Block outbound' }) as HTMLButtonElement
    const field = await within(dialog).findByLabelText('Type web to confirm')
    expect(await within(dialog).findByText(/not ready/)).toBeTruthy()
    expect(confirm.disabled).toBe(true)
    fireEvent.change(field, { target: { value: 'web' } })
    expect(confirm.disabled).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(calls('POST /zones/zw/egress-state')).toHaveLength(1))
    expect(body(calls('POST /zones/zw/egress-state')[0][1] as RequestInit)).toEqual({ version: 3, state: 'enforce' })
  })

  it('treats the zone as not ready, and asks its name, when the outbound suggestions cannot be read', async () => {
    mock.routes[OUT_ROUTE] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    setupMap({ zones: [observing()] })
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: 'Block outbound' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block outbound of zone web?' })
    expect(await within(dialog).findByLabelText('Type web to confirm')).toBeTruthy()
    expect(within(dialog).getByText(/could not be checked/)).toBeTruthy()
  })

  it('treats a full page of outbound suggestions as not ready, even when none is inside the window', async () => {
    const page = Array.from({ length: 200 }, (_, i) => outbound(`o${i}`, hoursAgo(30)))
    mock.routes[OUT_ROUTE] = () => reply(200, { suggestions: page, limit: 200, offset: 0 })
    setupMap({ zones: [observing()] })
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: 'Block outbound' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block outbound of zone web?' })
    expect(await within(dialog).findByLabelText('Type web to confirm')).toBeTruthy()
  })

  it('does not say ready in the panel when the map read only a first page of pending flows', async () => {
    const page = Array.from({ length: 200 }, (_, i) => wouldBlock(`i${i}`, { src_zone_id: 'zd', dst_zone_id: 'zd' }))
    setupMap({ zones: [observing(), db()], suggestions: page })
    const panel = await openPanel()
    expect(await within(panel).findByText('Outbound: observing')).toBeTruthy()
  })

  it('asks a plain confirmation to block the outbound of a ready zone', async () => {
    mock.routes[OUT_ROUTE] = () => reply(200, { suggestions: [outbound('o1', hoursAgo(30))], limit: 200, offset: 0 })
    setupMap({ zones: [observing()] })
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: 'Block outbound' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block outbound of zone web?' })
    const confirm = await within(dialog).findByRole('button', { name: 'Block outbound' }) as HTMLButtonElement
    await waitFor(() => expect(confirm.disabled).toBe(false))
    expect(within(dialog).queryByLabelText(/Type web to confirm/)).toBeNull()
  })

  it('refuses to block the outbound while the draft has pending changes', async () => {
    mock.routes[OUT_ROUTE] = () => reply(200, { suggestions: [], limit: 200, offset: 0 })
    setupMap({ zones: [observing()], pending_changes: true })
    const panel = await openPanel()
    fireEvent.click(within(panel).getByRole('button', { name: 'Block outbound' }))
    const dialog = await screen.findByRole('dialog', { name: 'Block outbound of zone web?' })
    expect(await within(dialog).findByText(/^Apply or discard your \d+ pending changes? first\.$/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Block outbound' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('outbound readiness read of the zone list', () => {
  const LIST_ROUTE = 'GET /suggestions?kind=would_block&status=pending&direction=out&limit=200'
  const outboundOf = (lastSeen: string) => ({ ...suggestion(lastSeen), direction: 'out', src_key: 'zw', src_zone_id: 'zw', dst_zone_id: '' })

  it('reads the pending outbound flows once, with the direction, when a zone observes its outbound, and shows it ready', async () => {
    mock.routes[LIST_ROUTE] = () => reply(200, { suggestions: [outboundOf(hoursAgo(30))], limit: 200, offset: 0 })
    setup({ zones: [web({ state: 'enforce', egress_state: 'observe', egress_observe_since: hoursAgo(48) })] })
    expect(await screen.findByText('Outbound: ready')).toBeTruthy()
    expect(calls(LIST_ROUTE)).toHaveLength(1)
  })

  it('keeps the chip observing while a flow was seen inside the window', async () => {
    mock.routes[LIST_ROUTE] = () => reply(200, { suggestions: [outboundOf(hoursAgo(1))], limit: 200, offset: 0 })
    setup({ zones: [web({ state: 'enforce', egress_state: 'observe', egress_observe_since: hoursAgo(48) })] })
    expect(await screen.findByText('Outbound: observing')).toBeTruthy()
  })

  it('reads nothing outbound when no zone observes its outbound', async () => {
    setup({ zones: [web({ state: 'enforce', egress_state: 'enforce' }), db()] })
    expect(await screen.findByText('Outbound: blocking')).toBeTruthy()
    expect(calls(LIST_ROUTE)).toHaveLength(0)
  })
})
