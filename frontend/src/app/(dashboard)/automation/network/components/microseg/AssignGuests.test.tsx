/**
 * Policy sub-tab: assigning guests to a zone (dialog opened from the zone row)
 * and removing a member from its zone. Everything goes through the real client,
 * the fetch is mocked at the Next relay.
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { calls, mock, policy, reply, revisionWithSnapshot, REVISION_HEAD } from './microsegTestKit'
import { body, db, installFreshMocks, setup, vm, web } from './policyTestKit'

installFreshMocks()

const pad = (i: number) => String(i).padStart(3, '0')
const manyGuests = (n: number) => Array.from({ length: n }, (_, i) => vm(1000 + i, `guest-${pad(i)}`, []))

async function openDialog() {
  const row = await screen.findByRole('listitem', { name: 'web' })
  fireEvent.click(await within(row).findByRole('button', { name: 'Assign guests' }))
  return screen.findByRole('dialog', { name: 'Assign guests to web' })
}

/** Opens a zone card's details (members and flows, full width below the row of cards) and returns them. */
async function openDetails(name: string) {
  const card = await screen.findByRole('listitem', { name })
  fireEvent.click(await within(card).findByRole('button', { name: `Show details of ${name}` }))
  return screen.findByRole('region', { name: `Details of ${name}` })
}

const assignButton = (dialog: HTMLElement, name: RegExp | string) => within(dialog).getByRole('button', { name })
const indeterminate = (box: HTMLInputElement) => box.getAttribute('data-indeterminate') === 'true'
const selectAll = (dialog: HTMLElement) => within(dialog).getByRole('checkbox', { name: 'All matching guests' }) as HTMLInputElement

describe('assign guests dialog: list', () => {
  it('paginates 300 guests 25 per page and searches by name or vmid', async () => {
    setup({ zones: [web()], vms: [...manyGuests(300), vm(5, 'a-template', [], { template: true })] })
    const dialog = await openDialog()

    expect(await within(dialog).findByText('guest-000')).toBeTruthy()
    expect(within(dialog).getByText('guest-024')).toBeTruthy()
    expect(within(dialog).queryByText('guest-025')).toBeNull()
    expect(within(dialog).queryByText('a-template')).toBeNull()
    expect(within(dialog).getByText('1-25 of 300')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('button', { name: /next page/i }))
    expect(await within(dialog).findByText('guest-025')).toBeTruthy()
    expect(within(dialog).queryByText('guest-000')).toBeNull()

    const search = within(dialog).getByRole('textbox', { name: 'Search by name or VMID' })
    fireEvent.change(search, { target: { value: 'guest-150' } })
    expect(await within(dialog).findByText('guest-150')).toBeTruthy()
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1)

    fireEvent.change(search, { target: { value: '1207' } })
    expect(await within(dialog).findByText('guest-207')).toBeTruthy()
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(1)

    fireEvent.change(search, { target: { value: 'nothing-like-this' } })
    expect(await within(dialog).findByText('No guest matches.')).toBeTruthy()
  })

  it('shows one line per guest with its status glyph, vmid and node', async () => {
    setup({ zones: [web()], vms: [vm(100, 'web-1', []), vm(200, 'ct-1', [], { type: 'lxc', status: 'stopped', node: 'pve2' })] })
    const dialog = await openDialog()
    const row = await within(dialog).findByRole('listitem', { name: 'ct-1' })
    expect(within(row).getByText('200 · pve2')).toBeTruthy()
    expect(row.querySelector('i.ri-instance-fill')).toBeTruthy()
    expect(within(dialog).getByRole('listitem', { name: 'web-1' }).querySelector('i.ri-computer-fill')).toBeTruthy()
  })

  it('says so when the connection has no guest', async () => {
    setup({ zones: [web()], vms: [] })
    const dialog = await openDialog()
    expect(await within(dialog).findByText('No guest in this connection.')).toBeTruthy()
    expect((assignButton(dialog, 'Assign 0 guests') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a member and a pending guest as already in the zone, not selectable', async () => {
    setup({
      zones: [web()],
      vms: [vm(100, 'tagged', ['zone-web']), vm(101, 'queued', []), vm(102, 'free', [])],
      pending_members: [{ id: 'p1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 101, zone_id: 'zw' }],
    })
    const dialog = await openDialog()
    const tagged = await within(dialog).findByRole('listitem', { name: 'tagged' })
    const queued = within(dialog).getByRole('listitem', { name: 'queued' })
    expect(within(tagged).getByText('Member')).toBeTruthy()
    expect(within(queued).getByText('Pending')).toBeTruthy()
    expect((within(tagged).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
    expect((within(queued).getByRole('checkbox') as HTMLInputElement).disabled).toBe(true)
    expect((within(dialog).getByRole('checkbox', { name: 'free' }) as HTMLInputElement).disabled).toBe(false)
  })

  it('counts the tickable guests out of the paged total when members are in the list', async () => {
    setup({
      zones: [web()],
      vms: [...manyGuests(60), vm(100, 'tagged', ['zone-web']), vm(101, 'queued', [])],
      pending_members: [{ id: 'p1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 101, zone_id: 'zw' }],
    })
    const dialog = await openDialog()
    expect(await within(dialog).findByText('1-25 of 62')).toBeTruthy()
    expect(within(dialog).getByText('All matching guests (60 of 62 can be selected)')).toBeTruthy()
    fireEvent.click(selectAll(dialog))
    expect(within(dialog).getByText('Selected: 60')).toBeTruthy()
    expect(selectAll(dialog).checked).toBe(true)
  })

  it('flags a guest that carries another zone tag and says it will be moved', async () => {
    setup({
      zones: [web(), db()],
      vms: [vm(100, 'in-db', ['zone-db']), vm(101, 'in-two', ['zone-db', 'zone-web2']), vm(102, 'plain', [])],
    })
    const dialog = await openDialog()
    const row = await within(dialog).findByRole('listitem', { name: 'in-db' })
    expect(within(row).getByText('db')).toBeTruthy()
    expect(within(row).getByLabelText('Currently in db: assigning moves it to web.')).toBeTruthy()
    expect(within(dialog).getByRole('listitem', { name: 'plain' }).querySelector('[aria-label*="moves it"]')).toBeNull()
  })

  it('flags a guest queued for another zone too', async () => {
    setup({
      zones: [web(), db()],
      vms: [vm(100, 'queued-db', [])],
      pending_members: [{ id: 'p1', policy_id: 'p1', node: 'pve1', type: 'qemu', vmid: 100, zone_id: 'zd' }],
    })
    const dialog = await openDialog()
    const row = await within(dialog).findByRole('listitem', { name: 'queued-db' })
    expect(within(row).getByLabelText('Currently in db: assigning moves it to web.')).toBeTruthy()
  })
})

describe('assign guests dialog: selection', () => {
  it('selects all the filtered guests, across pages, with the three state checkbox', async () => {
    setup({ zones: [web()], vms: manyGuests(300) })
    const dialog = await openDialog()
    await within(dialog).findByText('guest-000')

    expect(selectAll(dialog).checked).toBe(false)
    expect(indeterminate(selectAll(dialog))).toBe(false)
    expect((assignButton(dialog, 'Assign 0 guests') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'guest-003' }))
    expect(indeterminate(selectAll(dialog))).toBe(true)
    expect(assignButton(dialog, 'Assign 1 guest')).toBeTruthy()

    fireEvent.click(selectAll(dialog))
    expect(selectAll(dialog).checked).toBe(true)
    expect(indeterminate(selectAll(dialog))).toBe(false)
    expect(assignButton(dialog, 'Assign 300 guests')).toBeTruthy()

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'guest-003' }))
    expect(indeterminate(selectAll(dialog))).toBe(true)
    expect(assignButton(dialog, 'Assign 299 guests')).toBeTruthy()

    fireEvent.click(selectAll(dialog))
    expect(assignButton(dialog, 'Assign 300 guests')).toBeTruthy()
    fireEvent.click(selectAll(dialog))
    expect(selectAll(dialog).checked).toBe(false)
    expect((assignButton(dialog, 'Assign 0 guests') as HTMLButtonElement).disabled).toBe(true)
  })

  it('applies the all checkbox to the filtered guests only', async () => {
    setup({ zones: [web()], vms: manyGuests(300) })
    const dialog = await openDialog()
    await within(dialog).findByText('guest-000')
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search by name or VMID' }), { target: { value: 'guest-01' } })
    await waitFor(() => expect(within(dialog).getAllByRole('listitem')).toHaveLength(10))

    fireEvent.click(selectAll(dialog))
    expect(assignButton(dialog, 'Assign 10 guests')).toBeTruthy()

    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Search by name or VMID' }), { target: { value: 'guest-0' } })
    await waitFor(() => expect(indeterminate(selectAll(dialog))).toBe(true))
    expect(assignButton(dialog, 'Assign 10 guests')).toBeTruthy()
  })

  it('refuses more than 1000 guests with a message and sends nothing', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    setup({ zones: [web()], vms: manyGuests(1200) })
    const dialog = await openDialog()
    await within(dialog).findByText('guest-000')
    fireEvent.click(selectAll(dialog))

    expect(await within(dialog).findByText('At most 1,000 guests can be assigned at once (selected: 1,200).')).toBeTruthy()
    const button = assignButton(dialog, 'Assign 1,200 guests') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(calls('POST /members')).toHaveLength(0)

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'guest-000' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'guest-001' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'guest-002' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'guest-003' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'guest-004' }))
    expect(within(dialog).getByText('At most 1,000 guests can be assigned at once (selected: 1,195).')).toBeTruthy()
  })
})

describe('assign guests dialog: save', () => {
  it('sends the selection as pending members of the zone and reloads the policy', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    setup({ zones: [web(), db()], vms: [vm(100, 'a', []), vm(101, 'b', [], { type: 'lxc', node: 'pve2' }), vm(102, 'c', ['zone-db'])] })
    const dialog = await openDialog()
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'b' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'c' }))
    const before = calls('GET /policy').length
    fireEvent.click(assignButton(dialog, 'Assign 2 guests'))

    await waitFor(() => expect(calls('POST /members')).toHaveLength(1))
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({
      version: 3,
      zone_id: 'zw',
      guests: [{ node: 'pve2', type: 'lxc', vmid: 101 }, { node: 'pve1', type: 'qemu', vmid: 102 }],
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls('GET /policy').length).toBeGreaterThan(before)
  })

  it('cancel sends nothing', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    setup({ zones: [web()], vms: [vm(100, 'a', [])] })
    const dialog = await openDialog()
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'a' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls('POST /members')).toHaveLength(0)
  })

  it('keeps the selection, reloads the policy and says so on a version conflict', async () => {
    mock.routes['POST /members'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    setup({ zones: [web()], vms: [vm(100, 'a', []), vm(101, 'b', [])] })
    const dialog = await openDialog()
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'a' }))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'b' }))
    const before = calls('GET /policy').length
    fireEvent.click(assignButton(dialog, 'Assign 2 guests'))

    expect(await within(dialog).findByText(/changed elsewhere/)).toBeTruthy()
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((within(dialog).getByRole('checkbox', { name: 'a' }) as HTMLInputElement).checked).toBe(true)
    expect(assignButton(dialog, 'Assign 2 guests')).toBeTruthy()
  })

  it('shows the translated error of any other refusal and keeps the dialog', async () => {
    mock.routes['POST /members'] = () => reply(409, { code: 'BUSY', error: 'busy' })
    setup({ zones: [web()], vms: [vm(100, 'a', [])] })
    const dialog = await openDialog()
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'a' }))
    fireEvent.click(assignButton(dialog, 'Assign 1 guest'))
    expect(await within(dialog).findByText('Another operation is running on this connection. Try again in a moment.')).toBeTruthy()
    expect(calls('GET /policy')).toHaveLength(1)
  })
})

describe('remove from zone', () => {
  it('moves a member out of its zone through members with an empty zone id', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    setup({ zones: [web()], vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'])] })
    const row = await openDetails('web')
    const member = (await within(row).findByText('web-2')).closest('div') as HTMLElement
    const before = calls('GET /policy').length
    fireEvent.click(within(member).getByRole('button', { name: 'Remove from zone' }))

    await waitFor(() => expect(calls('POST /members')).toHaveLength(1))
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({
      version: 3, zone_id: '', guests: [{ node: 'pve1', type: 'qemu', vmid: 101 }],
    })
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
  })

  it('also removes a pending member that is not tagged yet', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    setup({
      zones: [web()], vms: [],
      pending_members: [{ id: 'p1', policy_id: 'p1', node: 'pve9', type: 'lxc', vmid: 400, zone_id: 'zw' }],
    })
    const row = await openDetails('web')
    fireEvent.click(await within(row).findByRole('button', { name: 'Remove from zone' }))
    await waitFor(() => expect(calls('POST /members')).toHaveLength(1))
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({
      version: 3, zone_id: '', guests: [{ node: 'pve9', type: 'lxc', vmid: 400 }],
    })
  })

  it('shows the error and reloads the policy when the removal hits a version conflict', async () => {
    mock.routes['POST /members'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    setup({ zones: [web()], vms: [vm(100, 'web-1', ['zone-web'])] })
    const row = await openDetails('web')
    const before = calls('GET /policy').length
    fireEvent.click(await within(row).findByRole('button', { name: 'Remove from zone' }))
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
    expect(await screen.findByText(/Reload/i)).toBeTruthy()
  })
})

describe('queued removals and moves of tagged members', () => {
  const queued = (zoneId: string, node = 'pve1') => [{ id: 'p1', policy_id: 'p1', node, type: 'qemu' as const, vmid: 100, zone_id: zoneId }]

  it('shows the removal after "Remove from zone" once the policy reloads with the pending row', async () => {
    let pendingRows: ReturnType<typeof queued> = []
    mock.routes['POST /members'] = () => { pendingRows = queued(''); return reply(200, { version: 4 }) }
    setup({ zones: [web()], vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'])], pending_members: pendingRows, pending_changes: true })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web()], pending_members: pendingRows, last_revision: REVISION_HEAD, pending_changes: pendingRows.length > 0 }))
    const row = await openDetails('web')
    const member = (await within(row).findByText('web-1')).closest('div') as HTMLElement
    fireEvent.click(within(member).getByRole('button', { name: 'Remove from zone' }))

    expect(await within(member).findByText('Pending removal')).toBeTruthy()
    expect((within(member).getByRole('button', { name: 'Remove from zone' }) as HTMLButtonElement).disabled).toBe(true)
    const other = (within(row).getByText('web-2')).closest('div') as HTMLElement
    expect(within(other).queryByText('Pending removal')).toBeNull()
  })

  it('shows a tagged member queued for another zone as moving', async () => {
    setup({ zones: [web(), db()], vms: [vm(100, 'web-1', ['zone-web'])], pending_members: queued('zd') })
    const row = await openDetails('web')
    expect(await within(row).findByText('Moving to db')).toBeTruthy()
    expect(within(row).queryByText('Pending')).toBeNull()
  })

  it('matches the pending row by type and vmid, whatever the node', async () => {
    setup({ zones: [web()], vms: [vm(100, 'web-1', ['zone-web'])], pending_members: queued('', 'pve-old') })
    const row = await openDetails('web')
    expect(await within(row).findByText('Pending removal')).toBeTruthy()
    expect(within(row).getAllByText('web-1')).toHaveLength(1)
  })

  it('lets the dialog undo a queued removal: the guest is selectable and its pending row is cleared, not re-queued', async () => {
    let pendingRows = queued('')
    mock.routes['POST /members'] = () => { pendingRows = []; return reply(200, { version: 4 }) }
    mock.routes['GET /revisions?limit=1'] = () => reply(200, { revisions: [revisionWithSnapshot([web()], [])] })
    setup({ zones: [web()], vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'])], pending_members: pendingRows, pending_changes: true })
    mock.routes['GET /policy'] = () => reply(200, policy({ zones: [web()], pending_members: pendingRows, last_revision: REVISION_HEAD, pending_changes: pendingRows.length > 0 }))
    expect(await screen.findByText('What will change: 1 member change')).toBeTruthy()
    const dialog = await openDialog()
    const leaving = await within(dialog).findByRole('listitem', { name: 'web-1' })
    expect(within(leaving).getByText('Pending removal')).toBeTruthy()
    expect(within(leaving).queryByText('Member')).toBeNull()
    const box = within(leaving).getByRole('checkbox') as HTMLInputElement
    expect(box.disabled).toBe(false)
    expect(box.checked).toBe(false)
    expect((within(dialog).getByRole('checkbox', { name: 'web-2' }) as HTMLInputElement).disabled).toBe(true)

    fireEvent.click(box)
    fireEvent.click(assignButton(dialog, 'Assign 1 guest'))
    await waitFor(() => expect(calls('POST /members')).toHaveLength(1))
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({ version: 3, clear: [{ type: 'qemu', vmid: 100 }] })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.queryByText(/What will change/)).toBeNull())
  })

  it('clears a taken-back move and queues the new guests in the same request', async () => {
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    setup({ zones: [web(), db()], vms: [vm(100, 'web-1', ['zone-web']), vm(102, 'new-1', [])], pending_members: queued('zd') })
    const dialog = await openDialog()
    fireEvent.click(within(await within(dialog).findByRole('listitem', { name: 'web-1' })).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'new-1' }))
    fireEvent.click(assignButton(dialog, 'Assign 2 guests'))
    await waitFor(() => expect(calls('POST /members')).toHaveLength(1))
    expect(body(calls('POST /members')[0][1] as RequestInit)).toEqual({
      version: 3, zone_id: 'zw', guests: [{ node: 'pve1', type: 'qemu', vmid: 102 }], clear: [{ type: 'qemu', vmid: 100 }],
    })
  })

  it('keeps the dialog and reloads the policy when the clear hits a version conflict', async () => {
    mock.routes['POST /members'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    setup({ zones: [web()], vms: [vm(100, 'web-1', ['zone-web'])], pending_members: queued('') })
    const dialog = await openDialog()
    fireEvent.click(within(await within(dialog).findByRole('listitem', { name: 'web-1' })).getByRole('checkbox'))
    const before = calls('GET /policy').length
    fireEvent.click(assignButton(dialog, 'Assign 1 guest'))
    expect(await within(dialog).findByText(/The policy changed elsewhere/)).toBeTruthy()
    expect(calls('GET /policy').length).toBeGreaterThan(before)
    expect(screen.getByRole('dialog', { name: 'Assign guests to web' })).toBeTruthy()
  })

  it('lets the dialog take back a queued move too', async () => {
    setup({ zones: [web(), db()], vms: [vm(100, 'web-1', ['zone-web'])], pending_members: queued('zd') })
    const dialog = await openDialog()
    const row = await within(dialog).findByRole('listitem', { name: 'web-1' })
    expect(within(row).getByText('Moving to db')).toBeTruthy()
    expect((within(row).getByRole('checkbox') as HTMLInputElement).disabled).toBe(false)
  })

  it('disables the remove buttons while a removal is in flight', async () => {
    let release: (v: unknown) => void = () => undefined
    mock.routes['POST /members'] = () => new Promise(resolve => { release = resolve })
    setup({ zones: [web()], vms: [vm(100, 'web-1', ['zone-web']), vm(101, 'web-2', ['zone-web'])] })
    const row = await openDetails('web')
    await within(row).findByText('web-2')
    const buttons = () => within(row).getAllByRole('button', { name: 'Remove from zone' }) as HTMLButtonElement[]
    fireEvent.click(buttons()[0])
    await waitFor(() => expect(buttons().every(b => b.disabled)).toBe(true))
    fireEvent.click(buttons()[1])
    expect(calls('POST /members')).toHaveLength(1)

    release(reply(200, { version: 4 }))
    await waitFor(() => expect(buttons().every(b => !b.disabled)).toBe(true))
  })
})
